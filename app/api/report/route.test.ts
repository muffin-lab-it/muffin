import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import { isMockMode, mockResearch } from "@/src/agent/mock";
import { research, type ResearchResult } from "@/src/agent/muffin";
import { reportSchema } from "@/src/agent/schema";
import { logRun } from "@/src/lib/log";
import { POST } from "./route";

vi.mock("@/src/agent/muffin", () => ({ research: vi.fn() }));
vi.mock("@/src/agent/mock", () => ({ isMockMode: vi.fn(), mockResearch: vi.fn() }));
vi.mock("@/src/lib/log", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/log")>(),
  newRunId: () => "json-test-id",
  logRun: vi.fn(),
}));
const fixture: ResearchResult = {
  report: reportSchema.parse(sample.report), steps: [], rewrites: 0,
  plan: { intent: "cause", mode: "research", tools: ["get_fx_krw_rate"], reason: "fixture" }, facts: null,
  model: "fixture-model", usage: { requests: 1, inputTokens: 10, outputTokens: 20 },
};
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/report", {
  method: "POST", headers, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "fixture-placeholder-key");
  vi.mocked(isMockMode).mockReturnValue(false);
  vi.mocked(research).mockResolvedValue(fixture);
  vi.mocked(mockResearch).mockResolvedValue(fixture);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/report · 출처 검사 · 바디 크기 (src/lib/guard.ts)", () => {
  it("허용 목록 밖의 Origin 은 바디를 읽기 전에 403 이고 research 를 부르지 않는다", async () => {
    const response = await POST(request({ question: "환율 알려줘" }, { Origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "허용되지 않은 출처입니다.", id: "json-test-id" });
    expect(research).not.toHaveBeenCalled();
    expect(logRun).not.toHaveBeenCalled();
  });

  it("배포 주소 Origin 은 통과한다", async () => {
    const response = await POST(request({ question: "환율 알려줘" }, { Origin: "https://muffin-kappa.vercel.app" }));
    expect(response.status).toBe(200);
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("16KB 를 넘는 바디는 413 이고 research 를 부르지 않는다", async () => {
    const response = await POST(request({ question: "가".repeat(6_000) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "요청이 너무 큽니다.", id: "json-test-id" });
    expect(research).not.toHaveBeenCalled();
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ ok: false, stage: "input", error: "body too large" }));
  });
});

describe("POST /api/report", () => {
  it("returns 429 and Retry-After before reading a second rate-limited request", async () => {
    vi.stubEnv("RATE_LIMIT_IP_10M", "1");
    const headers = { "X-Forwarded-For": "203.0.113.200" };
    expect((await POST(request({ question: "첫 요청" }, headers))).status).toBe(200);

    const response = await POST(request({ question: "두 번째 요청" }, headers));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect(await response.json()).toEqual({
      error: "요청이 많아요. 10분 뒤 다시 시도해 주세요.",
      id: "json-test-id",
      retryAfterSec: 600,
    });
    expect(research).toHaveBeenCalledOnce();
    expect(logRun).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, stage: "limited", error: "rate limit exceeded" }));
  });

  it("shows an hourly retry message when the daily client limit is exceeded", async () => {
    vi.stubEnv("RATE_LIMIT_10M", "10");
    vi.stubEnv("RATE_LIMIT_DAY", "1");
    vi.stubEnv("RATE_LIMIT_IP_10M", "10");
    const headers = { "X-Forwarded-For": "203.0.113.201", "X-Muffin-Client": "6f4e1a2b-1234-4abc-8def-0123456789ab" };
    expect((await POST(request({ question: "첫 요청" }, headers))).status).toBe(200);

    const response = await POST(request({ question: "두 번째 요청" }, headers));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("요청이 많아요. 24시간 뒤 다시 시도해 주세요.");
  });

  it.each([{}, { question: " \n\t " }, { question: "a".repeat(501) }])("rejects invalid input before research: %j", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ id: "json-test-id" });
    expect(research).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/report", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(research).not.toHaveBeenCalled();
  });

  it("trims questions and preserves the success response contract", async () => {
    const response = await POST(request({ question: "  환율 현황  " }));
    expect(response.status).toBe(200);
    // usage 는 11/15 부터 함께 갑니다. 모델별 기록(byModel)이 없는 fixture 라 cost 는 없습니다
    expect(await response.json()).toEqual({ report: fixture.report, steps: [], rewrites: 0, id: "json-test-id", usage: fixture.usage });
    expect(research).toHaveBeenCalledWith({ question: "환율 현황", depth: "standard" });
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ quality: expect.objectContaining({ whyUnsupported: fixture.report.why.filter((why) => why.basis === "none").length }) }));
    // 정제 요약이 있으면 quality.edit 로 같이 남는다 (runs.quality jsonb, 표 변경 없음)
    vi.mocked(research).mockResolvedValue({ ...fixture, edit: { ok: true, facts: 3, dropped: 1, unverified: 0, reversed: 1, fallback: false } });
    await POST(request({ question: "환율 왜 올랐어?" }));
    expect(logRun).toHaveBeenLastCalledWith(expect.objectContaining({ quality: expect.objectContaining({ edit: { ok: true, facts: 3, dropped: 1, unverified: 0, reversed: 1, fallback: false } }) }));
  });

  it("keeps redacted diagnostics in server logs while hiding browser errors", async () => {
    const privateMessage = "provider 429: quota exceeded key=fixture-placeholder-key";
    vi.mocked(research).mockRejectedValue(new Error(privateMessage));
    const response = await POST(request({ question: "환율 현황" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "조사 중 오류가 생겼어요. 잠시 후 다시 시도해 주세요.", id: "json-test-id" });
    expect(JSON.stringify(vi.mocked(logRun).mock.calls)).not.toContain(privateMessage);
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ error: "provider 429: quota exceeded key=[REDACTED]" }));
    expect(logRun).toHaveBeenCalledTimes(1);
  });

  it("masks failed tool details on successful reports and known keys in input logs", async () => {
    vi.mocked(research).mockResolvedValue({ ...fixture, steps: [{ tool: "get_fx_krw_rate", status: "error", ms: 2, error: "upstream timeout key=fixture-placeholder-key" }] });
    const response = await POST(request({ question: "fixture-placeholder-key 환율" }));
    const body = await response.json();
    expect(body.steps[0]).toEqual({ tool: "get_fx_krw_rate", status: "error", ms: 2, error: "데이터를 확인하지 못했어요." });
    const logs = JSON.stringify(vi.mocked(logRun).mock.calls);
    expect(logs).toContain("upstream timeout key=[REDACTED]");
    expect(logs).not.toContain("fixture-placeholder-key");
  });

  it("keeps config errors at HTTP 500 with a request id", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(request({ question: "환율 현황" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "리포트 서비스 설정을 확인해 주세요.", id: "json-test-id" });
    expect(research).not.toHaveBeenCalled();
  });

  it("supports the explicit mock mode without a real key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.mocked(isMockMode).mockReturnValue(true);
    expect((await POST(request({ question: "환율 현황" }))).status).toBe(200);
    expect(mockResearch).toHaveBeenCalledOnce();
    expect(research).not.toHaveBeenCalled();
  });
});
