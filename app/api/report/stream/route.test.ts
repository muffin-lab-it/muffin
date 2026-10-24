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
vi.mock("@/src/lib/log", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/log")>(),
  newRunId: () => "test-request-id",
  logRun: vi.fn(),
}));

const fixture: ResearchResult = {
  report: reportSchema.parse(sample.report),
  steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 12 }],
  rewrites: 0,
  model: "fixture-model",
  usage: { requests: 1, inputTokens: 10, outputTokens: 20 },
};
const validInput = { question: "환율이 왜 올랐나요?", depth: "standard", area: "fx" };
const request = (body: unknown = validInput, signal?: AbortSignal) => new Request("http://localhost/api/report/stream", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
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

  it("does not start research when the request is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await events(await POST(request(validInput, abort.signal)))).toEqual([]);
    expect(research).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledTimes(1);
  });
});
