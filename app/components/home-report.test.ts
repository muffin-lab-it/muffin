import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ReportRequest, type ReportResponse, streamReport } from "@/src/lib/api";
import type { MuffinEvent } from "@/src/agent/events";
import { reportSchema } from "@/src/agent/schema";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import type { ReportRecord } from "@/src/lib/history";
import { createHomeReport, showsHomeProgress } from "./home-report";

const input: ReportRequest = { question: "물가는 왜 올랐어?", depth: "standard", area: "macro" };
const result: ReportResponse = { report: reportSchema.parse(sample.report), steps: [], rewrites: 0, id: "request-1" };
const record: ReportRecord = { id: result.id!, input, report: result.report, steps: [], createdAt: "2026-11-05" };
const reportEvent: MuffinEvent = { type: "report", ...result, id: result.id! };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const deps = {
    streamReport: vi.fn<typeof streamReport>().mockImplementation(async (_, emit) => { emit(reportEvent); return result; }),
    saveReport: vi.fn().mockResolvedValue(record),
    getReport: vi.fn().mockResolvedValue(record),
  };
  const navigate = vi.fn();
  return { deps, navigate, request: createHomeReport(deps, navigate) };
}
afterEach(() => vi.useRealTimers());

describe("홈 스트림 연결", () => {
  it("실제 이벤트를 표시하고 요청 id로 저장한 뒤 저장 확인이 끝나야 이동한다", async () => {
    const { deps, navigate, request } = setup();
    const saved = deferred<ReportRecord>();
    deps.saveReport.mockReturnValue(saved.promise);
    const pending = request.start(input);
    await vi.waitFor(() => expect(deps.saveReport).toHaveBeenCalled());
    expect(request.getSnapshot().events).toEqual([reportEvent]);
    expect(request.getSnapshot().phase).toBe("saving");
    expect(deps.saveReport).toHaveBeenCalledWith(input, result.report, result.steps, result.id);
    expect(navigate).not.toHaveBeenCalled();
    saved.resolve(record);
    await pending;
    expect(deps.getReport).toHaveBeenCalledWith(record.id);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/report/request-1");
  });

  it("빠른 중복 제출은 한 요청만 만들고 제출 당시 입력을 보존한다", async () => {
    const { deps, request } = setup();
    const response = deferred<ReportResponse>();
    deps.streamReport.mockReturnValue(response.promise);
    const submitted = { ...input };
    const pending = request.start(submitted);
    submitted.question = "수정한 질문";
    await request.start(input);
    expect(deps.streamReport).toHaveBeenCalledOnce();
    expect(request.getSnapshot().input?.question).toBe(input.question);
    response.resolve(result);
    await pending;
  });

  it("시간 초과 이벤트의 문장과 요청 id를 유지하고 조사 재시도는 이벤트를 비운다", async () => {
    const { deps, request } = setup();
    deps.streamReport.mockImplementationOnce(async (_, emit) => {
      emit({ type: "stage", stage: "research", status: "start" });
      emit({ type: "error", message: "조사 시간이 초과되었습니다.", id: "timeout-1" });
      throw new ApiError("오류", 200, "timeout-1");
    });
    await request.start(input);
    expect(request.getSnapshot().error).toEqual({ message: "조사 시간이 초과되었습니다.", id: "timeout-1" });
    deps.streamReport.mockImplementationOnce(async () => {
      expect(request.getSnapshot().events).toEqual([]);
      return result;
    });
    await request.retry();
    expect(deps.streamReport).toHaveBeenCalledTimes(2);
  });

  it.each([400, 403, 413, 503])("HTTP %s는 그대로 전달하고 자동 재조사를 막는다", async status => {
    const { deps, request } = setup();
    deps.streamReport.mockRejectedValue(new ApiError("서버 안내", status, "http-1"));
    await request.start(input);
    expect(request.getSnapshot().error).toEqual({ message: "서버 안내", status, id: "http-1" });
    await request.retry();
    expect(deps.streamReport).toHaveBeenCalledOnce();
    request.edit();
    expect(request.getSnapshot().phase).toBe("idle");
  });

  it("429 대기는 질문 수정 후에도 유지하고 실제 시각으로 해제한다", async () => {
    vi.useFakeTimers();
    const { deps, request } = setup();
    deps.streamReport.mockRejectedValueOnce(new ApiError("요청이 많아요", 429, "limit", 3));
    await request.start(input);
    request.edit();
    await request.start(input);
    expect(deps.streamReport).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2100);
    request.tick();
    expect(request.getSnapshot().retrySeconds).toBe(1);
    vi.advanceTimersByTime(900);
    request.tick();
    await request.start(input);
    expect(deps.streamReport).toHaveBeenCalledTimes(2);
  });

  it.each([new TypeError("Failed to fetch"), new Error("스트림이 리포트 없이 끝났습니다.")])("연결 또는 결과 없는 종료는 저장하지 않는다", async error => {
    const { deps, request } = setup();
    deps.streamReport.mockRejectedValue(error);
    await request.start(input);
    expect(request.getSnapshot().error?.kind).toBe("network");
    expect(deps.saveReport).not.toHaveBeenCalled();
  });

  it.each(["throw", "missing"])("저장 실패(%s) 시 완성 결과를 유지하고 저장만 재시도한다", async mode => {
    const { deps, navigate, request } = setup();
    if (mode === "throw") deps.saveReport.mockRejectedValueOnce(new Error("quota"));
    else deps.getReport.mockResolvedValueOnce(null);
    await request.start(input);
    expect(request.getSnapshot().error?.kind).toBe("save");
    expect(request.getSnapshot().result).toEqual(result);
    expect(navigate).not.toHaveBeenCalled();
    await request.retry();
    expect(deps.streamReport).toHaveBeenCalledOnce();
    expect(deps.saveReport).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("페이지 이탈 후 도착한 이벤트와 결과는 저장하거나 이동하지 않는다", async () => {
    const { deps, navigate, request } = setup();
    const response = deferred<ReportResponse>();
    let emit!: (event: MuffinEvent) => void;
    deps.streamReport.mockImplementation((_, onEvent) => { emit = onEvent; return response.promise; });
    const pending = request.start(input);
    request.detach();
    emit(reportEvent);
    response.resolve(result);
    await pending;
    expect(request.getSnapshot().events).toEqual([]);
    expect(deps.saveReport).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("저장 중 페이지 이탈 뒤에는 뒤늦게 상세로 이동하지 않는다", async () => {
    const { deps, navigate, request } = setup();
    const saved = deferred<ReportRecord>();
    deps.saveReport.mockReturnValue(saved.promise);
    const pending = request.start(input);
    await vi.waitFor(() => expect(deps.saveReport).toHaveBeenCalled());
    request.detach();
    saved.resolve(record);
    await pending;
    expect(navigate).not.toHaveBeenCalled();
  });
});


describe("홈에서 분류 후 진행 화면으로 전환", () => {
  it("분류 중에는 폼을 유지하고 실제 자료 찾기 시작에 진행 화면을 표시한다", async () => {
    const { deps, request } = setup();
    const response = deferred<ReportResponse>();
    let emit!: (event: MuffinEvent) => void;
    deps.streamReport.mockImplementation((_, callback) => { emit = callback; return response.promise; });
    const pending = request.start(input);
    expect(request.getSnapshot().phase).toBe("checking");
    expect(showsHomeProgress(request.getSnapshot())).toBe(false);
    emit({ type: "stage", stage: "plan", status: "start" });
    emit({ type: "plan", mode: "research", intent: "cause", tools: ["get_macro_indicators"] });
    expect(showsHomeProgress(request.getSnapshot())).toBe(false);
    emit({ type: "stage", stage: "research", status: "start" });
    expect(request.getSnapshot().phase).toBe("research");
    expect(showsHomeProgress(request.getSnapshot())).toBe(true);
    response.resolve(result); await pending;
  });

  it("범위 밖 plan은 홈에서 안내하고 최종 report가 와도 저장하거나 이동하지 않는다", async () => {
    const { deps, navigate, request } = setup();
    const response = deferred<ReportResponse>();
    let emit!: (event: MuffinEvent) => void;
    deps.streamReport.mockImplementation((_, callback) => { emit = callback; return response.promise; });
    const original = { ...input, question: "비트코인 현재 가격은?" };
    const pending = request.start(original);
    emit({ type: "plan", mode: "out_of_scope", intent: "out_of_scope", tools: [] });
    expect(request.getSnapshot().phase).toBe("unsupported");
    expect(request.getSnapshot().input).toEqual(original);
    expect(showsHomeProgress(request.getSnapshot())).toBe(false);
    emit(reportEvent); response.resolve(result); await pending;
    expect(deps.saveReport).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
    expect(request.getSnapshot().phase).toBe("unsupported");
  });

  it("비트코인이 들어 있어도 서버가 지원하면 정상 저장한다", async () => {
    const { deps, navigate, request } = setup();
    const mixed = { ...input, question: "금리 변화가 비트코인 같은 위험자산에 어떤 영향을 줘?" };
    deps.streamReport.mockImplementation(async (_, emit) => {
      emit({ type: "plan", mode: "research", intent: "cause", tools: ["get_rate_data"] });
      emit({ type: "stage", stage: "research", status: "start" }); return result;
    });
    await request.start(mixed);
    expect(deps.saveReport).toHaveBeenCalledWith(mixed, result.report, result.steps, result.id);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("plan을 받지 못해도 최종 범위 밖 결과는 저장하지 않는다", async () => {
    const { deps, navigate, request } = setup();
    deps.streamReport.mockImplementation(async () => ({ ...result, report: { ...result.report, mode: "out_of_scope" } }));
    await request.start(input);
    expect(request.getSnapshot().phase).toBe("unsupported");
    expect(deps.saveReport).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });

  it("이전 범위 밖 요청의 늦은 종료가 다음 요청을 덮어쓰지 않는다", async () => {
    const { deps, navigate, request } = setup();
    const first = deferred<ReportResponse>();
    let emit!: (event: MuffinEvent) => void;
    deps.streamReport.mockImplementationOnce((_, callback) => { emit = callback; return first.promise; });
    const previous = request.start(input);
    emit({ type: "plan", mode: "out_of_scope", intent: "out_of_scope", tools: [] });
    await request.start({ ...input, question: "새로운 물가 질문" });
    emit(reportEvent); first.resolve(result); await previous;
    expect(deps.saveReport).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledOnce();
    expect(request.getSnapshot().input?.question).toBe("새로운 물가 질문");
  });

  it("분류 중 오류와 호출 제한은 진행 화면 대신 홈에서 표시한다", async () => {
    const { deps, request } = setup();
    deps.streamReport.mockRejectedValue(new ApiError("요청이 많아요", 429, "limit", 10));
    await request.start(input);
    expect(request.getSnapshot().phase).toBe("error");
    expect(showsHomeProgress(request.getSnapshot())).toBe(false);
    expect(request.getSnapshot().retrySeconds).toBe(10);
  });
});


describe("답변 미완료의 홈 복귀", () => {
  it("자료 찾기 이후 실패해도 별도 중단 화면이 아니라 홈에서 안내한다", async () => {
    const { deps, request } = setup();
    deps.streamReport.mockImplementation(async (_, emit) => {
      emit({ type: "plan", mode: "research", intent: "status", tools: [] });
      emit({ type: "stage", stage: "research", status: "start" });
      emit({ type: "error", message: "이번 답변을 완성하지 못했어요.", id: "incomplete" });
      throw new ApiError("이번 답변을 완성하지 못했어요.", 200, "incomplete");
    });
    await request.start({ ...input, question: "오늘 점심은 뭐먹을까?" });
    expect(request.getSnapshot().phase).toBe("error");
    expect(showsHomeProgress(request.getSnapshot())).toBe(false);
    expect(request.getSnapshot().input?.question).toBe("오늘 점심은 뭐먹을까?");
    expect(deps.saveReport).not.toHaveBeenCalled();
  });
  it("생성 완료 후 저장 실패는 완성된 결과를 숨기지 않는다", async () => {
    const { deps, request } = setup();
    deps.saveReport.mockRejectedValue(new Error("저장 실패"));
    await request.start(input);
    expect(showsHomeProgress(request.getSnapshot())).toBe(true);
    expect(request.getSnapshot().result).toEqual(result);
  });
});


describe("진행 화면 진입 조건", () => {
  it("지원 분류 전 또는 자료 찾기 시작 전에는 제작 중 화면을 보여주지 않는다", async () => {
    const { deps, request } = setup();
    const response = deferred<ReportResponse>();
    let emit!: (event: MuffinEvent) => void;
    deps.streamReport.mockImplementation((_, callback) => { emit = callback; return response.promise; });
    const pending = request.start(input);
    emit({ type: "stage", stage: "plan", status: "start" });
    emit({ type: "stage", stage: "verify", status: "start" });
    expect(request.getSnapshot().phase).toBe("checking");
    expect(showsHomeProgress(request.getSnapshot())).toBe(false);
    emit({ type: "plan", mode: "research", intent: "cause", tools: ["get_macro_indicators"] });
    emit({ type: "stage", stage: "plan", status: "done" });
    expect(showsHomeProgress(request.getSnapshot())).toBe(false);
    emit({ type: "stage", stage: "research", status: "start" });
    expect(showsHomeProgress(request.getSnapshot())).toBe(true);
    response.resolve(result); await pending;
  });
});
