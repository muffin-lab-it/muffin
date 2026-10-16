/**
 * Rate Tool 테스트
 * fixture(실제 ECOS·FRED 응답)와 mockFetch를 사용하므로 실제 API를 호출하지 않습니다.
 * 현재 날짜는 2026-10-15(한국 시간)로 고정합니다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { execute } from "./index";

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Rate Tool — ECOS (BOK)", () => {
  // 1. BOK 정상 응답 테스트
  it("최신 관측일 기준 90일 전 값과 비교한다", async () => {
    vi.stubEnv("ECOS_API_KEY", "test-key");
    const fetchMock = mockFetch(fixture.ecos);

    const result = await execute({ series: "BOK", days: "90" });

    expect(result.data).toMatchObject({
      rate: 3,
      unit: "%",
      asOf: "2026-10-08",
      comparisonDate: "2026-07-10",
      comparisonRate: 2.5,
      changePp: 0.5,
      changeBp: 50,
      requestedDays: 90,
      observationCount: 91,
    });
    expect(result.source).toMatchObject({
      name: expect.any(String),
      url: expect.stringMatching(/^https?:/),
      asOf: "2026-10-08",
    });

    // 발표 시차를 고려해 요청 기간 + 14일을 조회한다
    expect(fetchMock.mock.calls[0][0]).toContain("/722Y001/D/20260703/20261015/0101000");
  });

  // 2. BOK API 오류 테스트
  it("BOK API가 실패하면 에러를 던지고 API 키를 노출하지 않는다", async () => {
    vi.stubEnv("ECOS_API_KEY", "test-key");
    mockFetch({ message: "not found" }, 404);

    const error = await execute({ series: "BOK", days: "90" }).catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("404");
    expect((error as Error).message).not.toContain("test-key");
  });

  // 3. ECOS 결측값 처리 테스트
  it.each([
    ["빈 문자열", ""],
    ["공백", " "],
    ["null", null],
  ])("ECOS 결측값(%s)을 0%%로 처리하지 않는다", async (_label, missing) => {
    vi.stubEnv("ECOS_API_KEY", "test-key");

    const response = structuredClone(fixture.ecos);
    const rows = response.StatisticSearch.row as { TIME: string; DATA_VALUE: string | null }[];
    rows[rows.length - 1].DATA_VALUE = missing;
    mockFetch(response);

    const result = await execute({ series: "BOK", days: "90" });

    expect(result.data).toMatchObject({
      rate: 3,
      asOf: "2026-10-07",
      comparisonDate: "2026-07-09",
    });
  });

  // 4. ECOS 데이터 없음(RESULT) 응답 테스트
  it("ECOS가 데이터 없음 응답을 주면 에러를 던진다", async () => {
    vi.stubEnv("ECOS_API_KEY", "test-key");
    mockFetch({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } });

    await expect(execute({ series: "BOK", days: "90" })).rejects.toThrow("INFO-200");
  });
});

describe("Rate Tool — FRED (DGS10/DFF)", () => {
  // 5. FRED 정상 응답 테스트
  it("국채 10년물 금리와 90일 변동폭을 계산한다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    const fetchMock = mockFetch(fixture.fred);

    const result = await execute({ series: "DGS10", days: "90" });

    expect(result.data).toMatchObject({
      rate: 5.21,
      unit: "%",
      asOf: "2026-10-13",
      comparisonDate: "2026-07-15",
      comparisonRate: 4.55,
      changePp: 0.66,
      changeBp: 66,
      requestedDays: 90,
      observationCount: 63,
    });
    expect(result.source).toMatchObject({
      name: "Federal Reserve Bank of St. Louis (FRED)",
      url: "https://fred.stlouisfed.org/series/DGS10",
      asOf: "2026-10-13",
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("observation_start")).toBe("2026-07-03");
    expect(url.searchParams.get("observation_end")).toBe("2026-10-15");
  });

  // 6. 주말 처리 테스트
  it("비교 기준일이 주말이면 직전 영업일 값을 사용한다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    mockFetch(fixture.fred);

    // 2026-10-13 - 30일 = 2026-09-13(일) → 2026-09-11(금)
    const result = await execute({ series: "DGS10", days: "30" });

    expect(result.data).toMatchObject({
      comparisonDate: "2026-09-11",
      comparisonRate: 4.96,
      changePp: 0.25,
      changeBp: 25,
    });
  });

  // 7. 휴일(".") 처리 테스트
  it("비교 기준일이 휴일('.')이면 직전 관측일 값을 사용한다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");

    // 최신 관측일을 2026-10-07 로 자르면 30일 전은 2026-09-07(Labor Day, ".")
    const response = structuredClone(fixture.fred);
    response.observations = response.observations.filter((row) => row.date <= "2026-10-07");
    mockFetch(response);

    const result = await execute({ series: "DGS10", days: "30" });

    expect(result.data).toMatchObject({
      rate: 5.28,
      asOf: "2026-10-07",
      comparisonDate: "2026-09-04",
      comparisonRate: 4.78,
      changePp: 0.5,
      changeBp: 50,
    });
  });

  // 8. FRED 결측값 처리 테스트
  it.each([
    ["빈 문자열", ""],
    ["null", null],
  ])("FRED 결측값(%s)을 0%%로 처리하지 않는다", async (_label, missing) => {
    vi.stubEnv("FRED_API_KEY", "test-key");

    const response = structuredClone(fixture.fred);
    const rows = response.observations as { date: string; value: string | null }[];
    rows[rows.length - 1].value = missing;
    mockFetch(response);

    const result = await execute({ series: "DGS10", days: "90" });

    // 2026-10-13 이 빠지고 2026-10-12(".")도 제외되어 2026-10-09 가 최신값
    expect(result.data).toMatchObject({
      rate: 5.24,
      asOf: "2026-10-09",
    });
  });

  // 9. FRED API 오류 테스트
  it("FRED API 오류 시 에러를 던지고 API 키를 노출하지 않는다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    mockFetch({ error_message: "Not found" }, 404);

    const error = await execute({ series: "DFF", days: "90" }).catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("404");
    expect((error as Error).message).not.toContain("test-key");
  });
});
