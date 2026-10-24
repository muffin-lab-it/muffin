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
  model: "fixture-model", usage: { requests: 1, inputTokens: 10, outputTokens: 20 },
};
const request = (body: unknown) => new Request("http://localhost/api/report", {
  method: "POST", body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "fixture-placeholder-key");
  vi.mocked(isMockMode).mockReturnValue(false);
  vi.mocked(research).mockResolvedValue(fixture);
  vi.mocked(mockResearch).mockResolvedValue(fixture);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/report", () => {
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
    expect(await response.json()).toEqual({ report: fixture.report, steps: [], rewrites: 0, id: "json-test-id" });
    expect(research).toHaveBeenCalledWith({ question: "환율 현황", depth: "standard" });
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ quality: expect.objectContaining({ whyUnsupported: fixture.report.why.filter((why) => why.basis === "none").length }) }));
  });

  it("keeps redacted diagnostics in server logs while hiding browser errors", async () => {
    const privateMessage = "provider 429: quota exceeded key=fixture-placeholder-key";
    vi.mocked(research).mockRejectedValue(new Error(privateMessage));
    const response = await POST(request({ question: "환율 현황" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", id: "json-test-id" });
    expect(JSON.stringify(vi.mocked(logRun).mock.calls)).not.toContain(privateMessage);
    expect(logRun).toHaveBeenCalledWith(expect.objectContaining({ error: "provider 429: quota exceeded key=[REDACTED]" }));
    expect(logRun).toHaveBeenCalledTimes(1);
  });

  it("masks failed tool details on successful reports and known keys in input logs", async () => {
    vi.mocked(research).mockResolvedValue({ ...fixture, steps: [{ tool: "get_fx_krw_rate", status: "error", ms: 2, error: "upstream timeout key=fixture-placeholder-key" }] });
    const response = await POST(request({ question: "fixture-placeholder-key 환율" }));
    const body = await response.json();
    expect(body.steps[0]).toEqual({ tool: "get_fx_krw_rate", status: "error", ms: 2, error: "데이터를 확인하지 못했습니다." });
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
