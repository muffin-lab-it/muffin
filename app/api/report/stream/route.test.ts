import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import type { MuffinEvent } from "@/src/agent/events";
import { isMockMode, mockResearch } from "@/src/agent/mock";
import { research, type ResearchOptions, type ResearchResult } from "@/src/agent/muffin";
import { reportSchema } from "@/src/agent/schema";
import { logRun } from "@/src/lib/log";
import { maxDuration, POST } from "./route";

vi.mock("@/src/agent/muffin", () => ({ research: vi.fn() }));
vi.mock("@/src/agent/mock", () => ({ isMockMode: vi.fn(), mockResearch: vi.fn() }));
vi.mock("@/src/replays", () => ({
  replays: {
    "fixture-replay": {
      version: 1,
      id: "fixture-replay",
      recordedAt: "2026-11-04T12:30:00.000Z",
      question: "녹화된 질문",
      depth: "easy",
      area: "etf",
      model: "gpt-6-luna",
      ms: 3_000,
      events: [
        { t: 0, type: "stage", stage: "plan", status: "start" },
        { t: 5, type: "step", step: { tool: "get_etf_kr_price", status: "error", ms: 3, error: "데이터를 확인하지 못했습니다." } },
        { t: 10, type: "stage", stage: "verify", status: "done" },
      ],
      report: sample.report,
      steps: [{ tool: "get_etf_kr_price", status: "ok", ms: 3 }],
      rewrites: 0,
    },
  },
}));
vi.mock("@/src/lib/log", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/log")>(),
  newRunId: () => "test-request-id",
  logRun: vi.fn(),
}));

const fixture: ResearchResult = {
  report: reportSchema.parse(sample.report),
  steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 12 }],
  rewrites: 0,
  plan: { intent: "cause", mode: "research", tools: ["get_fx_krw_rate"], reason: "fixture" },
  facts: null,
  model: "fixture-model",
  usage: { requests: 1, inputTokens: 10, outputTokens: 20 },
};
const validInput = { question: "환율이 왜 올랐나요?", depth: "standard", area: "fx" };
const request = (body: unknown = validInput, signal?: AbortSignal, extraHeaders: Record<string, string> = {}) => new Request("http://localhost/api/report/stream", {
  method: "POST", headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body), signal,
});
const events = async (response: Response): Promise<MuffinEvent[]> => (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const stage: MuffinEvent = { type: "stage", stage: "research", status: "start" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "fixture-placeholder-key");
  vi.mocked(isMockMode).mockReturnValue(false);
  vi.mocked(research).mockResolvedValue(fixture);
  vi.mocked(mockResearch).mockResolvedValue(fixture);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/report/stream · 출처 검사 · 바디 크기 (src/lib/guard.ts)", () => {
  it("허용 목록 밖의 Origin 은 바디를 읽기 전에 403 JSON 으로 끝나고 research 를 부르지 않는다", async () => {
    const response = await POST(request(validInput, undefined, { Origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Request-Id")).toBe("test-request-id");
    expect(await response.json()).toEqual({ error: "허용되지 않은 출처입니다.", id: "test-request-id" });
    expect(research).not.toHaveBeenCalled();
    expect(logRun).not.toHaveBeenCalled();
  });

  it("배포 주소 · 미리보기 주소 Origin 은 통과한다", async () => {
    for (const origin of ["https://muffin-kappa.vercel.app", "https://muffin-git-feat-x-thdude37-2971s-projects.vercel.app"]) {
      const response = await POST(request(validInput, undefined, { Origin: origin }));
      expect(response.status).toBe(200);
    }
    expect(research).toHaveBeenCalledTimes(2);
  });

  it("16KB 를 넘는 바디는 413 으로 끝나고 research 를 부르지 않는다", async () => {
    const response = await POST(request({ ...validInput, question: "가".repeat(6_000) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "요청이 너무 큽니다.", id: "test-request-id" });
    expect(research).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ ok: false, stage: "input", error: "body too large" }));
  });
});

describe("POST /api/report/stream", () => {
  it.each([{}, { question: "   " }, { question: "a".repeat(501) }, { ...validInput, depth: "invalid" }, { ...validInput, area: "invalid" }])("rejects invalid input before research: %j", async (input) => {
    const response = await POST(request(input));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ id: "test-request-id" });
    expect(research).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ stage: "input", ok: false }));
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/report/stream", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(research).not.toHaveBeenCalled();
  });

  it("returns a JSON configuration error before opening a stream", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ id: "test-request-id" });
    expect(research).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ stage: "config" }));
  });

  it("streams progress before research completes, then exactly one terminal report", async () => {
    let resolve!: (result: ResearchResult) => void;
    vi.mocked(research).mockImplementation((_input, options) => {
      options?.onEvent?.(stage);
      return new Promise((done) => { resolve = done; });
    });
    const response = await POST(request({ question: "  환율 질문  " }));
    expect(maxDuration).toBe(60);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("test-request-id");
    const reader = response.body!.getReader();
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toEqual(stage);
    expect(research).toHaveBeenCalledWith({ question: "환율 질문", depth: "standard" }, expect.anything());
    resolve(fixture);
    const terminal = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(terminal).toMatchObject({ type: "report", id: "test-request-id", report: fixture.report });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(logRun).toHaveBeenCalledTimes(1);
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ ok: true, stage: "ok", usage: fixture.usage }));
  });

  it("uses the mock branch without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.mocked(isMockMode).mockReturnValue(true);
    const received = await events(await POST(request()));
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("report");
    expect(mockResearch).toHaveBeenCalledWith(validInput, expect.objectContaining({ onEvent: expect.any(Function) }));
    expect(research).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ mock: true }));
  });

  it("hides upstream errors in the stream and retains redacted server diagnostics", async () => {
    const privateError = "provider 429: quota exceeded key=fixture-placeholder-key";
    vi.mocked(research).mockImplementation(async (_input, options) => {
      options?.onEvent?.(stage);
      throw new Error(privateError);
    });
    const received = await events(await POST(request()));
    expect(received.map((event) => event.type)).toEqual(["stage", "error"]);
    expect(received[1]).toMatchObject({ id: "test-request-id" });
    expect(JSON.stringify(received)).not.toContain(privateError);
    expect(JSON.stringify(vi.mocked(logRun).mock.calls)).not.toContain(privateError);
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ error: "provider 429: quota exceeded key=[REDACTED]" }));
    expect(logRun).toHaveBeenCalledTimes(1);
  });

  it("sanitizes tool errors and ignores terminal events from the research callback", async () => {
    const step = { tool: "get_fx_krw_rate", status: "error" as const, ms: 1, error: "upstream timeout key=fixture-placeholder-key" };
    vi.mocked(research).mockImplementation(async (_input, options) => {
      options?.onEvent?.({ type: "step", step });
      options?.onEvent?.({ type: "error", message: "private-token" });
      options?.onEvent?.({ type: "report", ...fixture, id: "wrong-id" });
      return { ...fixture, steps: [step] };
    });
    const received = await events(await POST(request()));
    expect(received.map((event) => event.type)).toEqual(["step", "report"]);
    expect(JSON.stringify(received)).not.toContain("private-token");
    expect(JSON.stringify(vi.mocked(logRun).mock.calls)).toContain("upstream timeout key=[REDACTED]");
    expect(JSON.stringify(vi.mocked(logRun).mock.calls)).not.toContain("fixture-placeholder-key");
  });

  it("closes at the deadline and ignores late completion", async () => {
    vi.useFakeTimers();
    let resolve!: (result: ResearchResult) => void;
    let callbacks: ResearchOptions | undefined;
    vi.mocked(research).mockImplementation((_input, options) => {
      callbacks = options;
      return new Promise((done) => { resolve = done; });
    });
    const response = await POST(request());
    const reading = events(response);
    await vi.advanceTimersByTimeAsync(55_000);
    const received = await reading;
    expect(received.map((event) => event.type)).toEqual(["error"]);
    expect(received[0]).toMatchObject({ id: "test-request-id" });
    callbacks?.onEvent?.(stage);
    resolve(fixture);
    await Promise.resolve();
    expect(logRun).toHaveBeenCalledTimes(1);
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ error: "stream deadline exceeded" }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["signal", "reader"] as const)("handles %s cancellation without late writes or duplicate logs", async (mode) => {
    vi.useFakeTimers();
    const abort = new AbortController();
    let reject!: (error: Error) => void;
    let callbacks: ResearchOptions | undefined;
    vi.mocked(research).mockImplementation((_input, options) => {
      callbacks = options;
      return new Promise((_resolve, fail) => { reject = fail; });
    });
    const response = await POST(request(validInput, abort.signal));
    const reader = response.body!.getReader();
    if (mode === "signal") abort.abort();
    else await reader.cancel();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(() => callbacks?.onEvent?.(stage)).not.toThrow();
    reject(new Error("late-private-error"));
    await Promise.resolve();
    expect(logRun).toHaveBeenCalledTimes(1);
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ error: "client disconnected", ok: false }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("리플레이: 녹화된 이벤트를 보내고 안내가 붙은 리포트 하나로 끝난다. 키가 없어도 되고, 로그는 mock 이며 모델을 부르지 않는다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request({ replay: "fixture-replay", speed: 10 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const seen = await events(response);
    expect(seen.map((e) => e.type)).toEqual(["stage", "step", "stage", "report"]);
    const report = seen.at(-1) as Extract<MuffinEvent, { type: "report" }>;
    expect(report.id).toBe("test-request-id");
    expect(report.report.notice).toContain("저장된 실행 다시 보기 · 11/4 21:30");
    expect(report.steps).toEqual([{ tool: "get_etf_kr_price", status: "ok", ms: 3 }]);
    expect(research).not.toHaveBeenCalled();
    expect(mockResearch).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ ok: true, stage: "ok", mock: true, model: "replay:fixture-replay", input: { question: "녹화된 질문", depth: "easy", area: "etf" } }));
  });

  it("리플레이: 55초 안에 못 끝나는 느린 속도는 끝날 만큼 올려서 report 로 끝낸다", async () => {
    const response = await POST(request({ replay: "fixture-replay", speed: 0.25 }));
    const seen = await events(response);
    expect(seen.at(-1)?.type).toBe("report");
  });

  it("리플레이: 없는 녹화는 404, 속도 범위 밖은 400 (스트림을 열지 않음)", async () => {
    const missing = await POST(request({ replay: "nope-nope" }));
    expect(missing.status).toBe(404);
    expect((await POST(request({ replay: "constructor" }))).status).toBe(404);
    expect(await missing.json()).toEqual({ error: "저장된 실행을 찾을 수 없어요.", id: "test-request-id" });
    const bad = await POST(request({ replay: "fixture-replay", speed: 99 }));
    expect(bad.status).toBe(400);
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ ok: false, stage: "input", mock: true }));
  });

  it("does not start research when the request is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await events(await POST(request(validInput, abort.signal)))).toEqual([]);
    expect(research).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/report/stream · 토큰 · 비용", () => {
  it("report 이벤트에 usage 와 단가로 센 cost 를 함께 보낸다 (모델별 기록이 없으면 cost 없음)", async () => {
    vi.mocked(research).mockResolvedValue({
      ...fixture,
      usage: {
        requests: 4,
        inputTokens: 11_000,
        outputTokens: 1_100,
        byModel: {
          "gpt-5.4-mini": { requests: 2, inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 },
          "gpt-6-luna": { requests: 2, inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 1_000 },
        },
      },
    });
    const list = await events(await POST(request()));
    const last = list.at(-1)!;
    expect(last.type).toBe("report");
    if (last.type !== "report") return;
    expect(last.usage?.byModel?.["gpt-6-luna"]?.inputTokens).toBe(10_000);
    // mini: 1000×0.75 + 100×4.5 = 1200, luna: 10000×0.1 + 1000×0.5 = 1500 → 2700 / 1e6
    expect(last.cost).toEqual({ usd: 0.0027, krw: expect.any(Number), partial: false });

    vi.mocked(research).mockResolvedValue(fixture);
    const plain = (await events(await POST(request()))).at(-1)!;
    expect(plain.type === "report" && plain.cost).toBeFalsy();
    expect(plain.type === "report" && plain.usage).toEqual(fixture.usage);
  });
});
