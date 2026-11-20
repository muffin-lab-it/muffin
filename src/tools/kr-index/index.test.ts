/**
 * fixture 기반 테스트. 실제 API 를 호출하지 않으므로 키 없이 CI 에서 돌아갑니다.
 * fixture.json 은 코스피 2026-10-12 ~ 2026-11-19 실제 응답입니다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { evidenceOf, execute, rowsOf, toResult } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("국내 지수 tool", () => {
  it("최신 종가와, 30일 전 이하인 가장 가까운 거래일을 비교한다", () => {
    const result = toResult("코스피", 30, rowsOf(fixture, "코스피"));
    expect(result.data.latest).toEqual({ date: "2026-11-19", close: 5137.89, change: 70.45, changePct: 1.39 });
    expect(result.data.period).toEqual({ from: "2026-10-20", to: "2026-11-19", closeFrom: 5552.74, change: -414.85, returnPct: -7.47 });
    // 차트용 일별 종가는 비교 시점부터 최신까지 (장부에는 올리지 않음)
    expect(result.data.series[0]).toEqual({ date: "2026-10-20", close: 5552.74 });
    expect(result.data.series.at(-1)).toEqual({ date: result.data.latest.date, close: result.data.latest.close });
    expect(evidenceOf(result.data)).not.toHaveProperty("series");
    expect(result.source).toMatchObject({ url: "https://www.data.go.kr/data/15094807/openapi.do", asOf: "2026-11-19" });
    expect(result.note).toContain("직전 영업일 종가");
    expect(evidenceOf(result.data)).toMatchObject({ index: "코스피", "latest.close": 5137.89, "period.returnPct": -7.47 });
  });

  it("execute 는 키와 지수 이름으로 조회한다", async () => {
    vi.stubEnv("DATA_GO_KR_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await execute({ index: "코스피", days: 30 });
    expect(result.data.latest.close).toBe(5137.89);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("idxNm")).toBe("코스피");
    expect(url.searchParams.get("serviceKey")).toBe("test-key");
  });

  it("키가 없거나, 오류 코드거나, 자료가 없으면 throw 한다 (빈 값으로 돌려주지 않음)", async () => {
    vi.stubEnv("DATA_GO_KR_KEY", "");
    await expect(execute({ index: "코스피", days: 30 })).rejects.toThrow("DATA_GO_KR_KEY");
    expect(() => rowsOf({ response: { header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR." } } }, "코스피")).toThrow("30");
    expect(() => rowsOf({}, "코스피")).toThrow("형식");
    expect(() => toResult("코스닥", 30, rowsOf(fixture, "코스닥"))).toThrow("시세가 없습니다");
    expect(() => toResult("코스피", 300, rowsOf(fixture, "코스피"))).toThrow("300일 전");
  });
});
