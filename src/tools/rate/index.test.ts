
/**
 * Rate Tool 테스트
 * fixture와 mockFetch를 사용하므로 실제 API를 호출하지 않습니다.
 * ECOS와 FRED의 정상 응답 및 오류 처리를 검증합니다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { execute } from "./index";

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Rate Tool", () => {
  it("BOK 정상 응답을 ToolResult로 변환한다", async () => {
    vi.stubEnv("ECOS_API_KEY", "test-key");
    mockFetch(fixture);
    const result = await execute({ series: "BOK", days: "90" });

    expect(result.data).toMatchObject({ rate: 3, comparisonRate: 2.75, changePp: 0.25, changeBp: 25 });
    expect(result.source).toMatchObject({ name: expect.any(String), url: expect.stringMatching(/^https?:/), asOf: "2026-10-08" });
  });

  it("BOK API가 실패하면 에러를 던진다", async () => {
    vi.stubEnv("ECOS_API_KEY", "test-key");
    mockFetch({ message: "not found" }, 404);

    await expect(execute({ series: "BOK", days: "90" })).rejects.toThrow("404");
  });

  it("FRED 국채 10년물 금리와 변동폭을 계산한다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");

    const today = new Date().toISOString().slice(0, 10);
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 91);
    const pastDate = past.toISOString().slice(0, 10);

    mockFetch({
      observations: [
        { date: pastDate, value: "4.50" },
        { date: today, value: "5.00" },
      ],
    });

    const result = await execute({ series: "DGS10", days: "90" });

    expect(result.data).toMatchObject({
      rate: 5,
      comparisonRate: 4.5,
      changePp: 0.5,
      changeBp: 50,
    });
    expect(result.source).toMatchObject({
      name: "Federal Reserve Bank of St. Louis (FRED)",
      url: "https://fred.stlouisfed.org/series/DGS10",
    });
  });

  it("FRED API 오류 시 에러를 던진다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    mockFetch({ error_message: "Not found" }, 404);

    await expect(execute({ series: "DFF", days: "90" })).rejects.toThrow("404");
  });
});
