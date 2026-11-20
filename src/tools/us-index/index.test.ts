/**
 * fixture 기반 테스트. 실제 API 를 호출하지 않으므로 키 없이 CI 에서 돌아갑니다.
 * fixture.json 은 S&P 500 2026-10-05 ~ 2026-11-18 실제 응답입니다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { evidenceOf, execute, rowsOf, toResult } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("미국 지수 tool", () => {
  it("최신 종가를 전 거래일, 30일 전 이하인 가장 가까운 거래일과 비교한다", () => {
    const result = toResult("S&P 500", 30, rowsOf(fixture));
    expect(result.data.latest).toEqual({ date: "2026-11-18", close: 7323.63, change: -16.9, changePct: -0.23 });
    expect(result.data.period).toEqual({ from: "2026-10-19", to: "2026-11-18", closeFrom: 7690.73, change: -367.1, returnPct: -4.77 });
    expect(result.source).toMatchObject({ url: "https://fred.stlouisfed.org/series/SP500", asOf: "2026-11-18" });
    expect(evidenceOf(result.data)).toMatchObject({ index: "S&P 500", "latest.close": 7323.63, "period.returnPct": -4.77 });
  });

  it("execute 는 지수에 맞는 series 로 조회하고, 휴장일(.)은 건너뛴다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ observations: [...fixture.observations, { date: "2026-11-19", value: "." }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await execute({ index: "나스닥 100", days: 30 });
    expect(result.data.latest.date).toBe("2026-11-18");
    expect(new URL(String((fetchMock.mock.calls[0] as unknown[])[0])).searchParams.get("series_id")).toBe("NASDAQ100");
  });

  it("키가 없거나, 형식이 다르거나, 자료가 모자라면 throw 한다 (빈 값으로 돌려주지 않음)", async () => {
    vi.stubEnv("FRED_API_KEY", "");
    await expect(execute({ index: "S&P 500", days: 30 })).rejects.toThrow("FRED_API_KEY");
    expect(() => rowsOf({ error_message: "Bad Request" })).toThrow("Bad Request");
    expect(() => toResult("S&P 500", 30, [])).toThrow("시세가 없습니다");
    expect(() => toResult("S&P 500", 300, rowsOf(fixture))).toThrow("300일 전");
  });
});
