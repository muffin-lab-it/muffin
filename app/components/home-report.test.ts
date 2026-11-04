import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ReportRequest, type ReportResponse, streamReport } from "@/src/lib/api";
import type { MuffinEvent } from "@/src/agent/events";
import { reportSchema } from "@/src/agent/schema";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import type { ReportRecord } from "@/src/lib/history";
import { createHomeReport } from "./home-report";

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
