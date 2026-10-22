/**
 * Rate Tool 테스트
 * fixture(실제 ECOS·FRED·BIS 응답)와 mockFetch를 사용하므로 실제 API를 호출하지 않습니다.
 * 현재 날짜는 2026-10-15(한국 시간)로 고정합니다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { execute, parameters, parseCsv, type Input } from "./index";

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// BIS 는 CSV 를 돌려주므로 본문을 그대로 응답합니다.
function mockText(body: string, status = 200) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(
    async () => new Response(body, { status, headers: { "content-type": "text/csv;charset=UTF-8" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type BisCountry = keyof typeof fixture.bis;

// fixture.bis.<국가> 는 실제 BIS CSV 응답에서 테스트에 필요한 행만 남긴 것입니다 (헤더 + 최대 5행).
// 최신 행(대표 행)은 원문 그대로이고, 나머지 행은 긴 설명(COMPILATION·SUPP_INFO_BREAKS)만 비웠습니다.
// 결측·중복·따옴표·줄바꿈 같은 특수 사례는 bisRow() 로 테스트 안에서 만듭니다.
const BIS_HEADER = parseCsv(fixture.bis.JP[0])[0];
const column = (name: string) => BIS_HEADER.indexOf(name);

function toCsvLine(cells: string[]): string {
  return cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",");
}

function bisCsv(lines: string[], eol = "\n"): string {
  return lines.join(eol) + eol;
}

// 국가 fixture 의 마지막 행을 복사해 일부 컬럼만 바꾼 행을 만듭니다.
function bisRow(country: BisCountry, changes: Record<string, string>): string {
  const cells = parseCsv(fixture.bis[country].at(-1) ?? "")[0];
  for (const [name, value] of Object.entries(changes)) cells[column(name)] = value;
  return toCsvLine(cells);
}

// 실제 API 처럼 URL 의 startPeriod ~ endPeriod 범위 행만 돌려줍니다.
// 조회 기간이 비교 기준일을 포함하지 못하면 테스트가 실패하므로 조회 범위도 함께 검증됩니다.
function mockBis(lines: string[], eol = "\n") {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
    const { searchParams } = new URL(url);
    const start = searchParams.get("startPeriod") ?? "";
    const end = searchParams.get("endPeriod") ?? "9999-12-31";
    const [header, ...rows] = lines;
    const inRange = rows.filter((line) => {
      const date = parseCsv(line)[0][column("TIME_PERIOD")];
      return date >= start && date <= end;
    });
    return new Response(bisCsv([header, ...inRange], eol), {
      status: 200,
      headers: { "content-type": "text/csv;charset=UTF-8" },
    });
  });
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

    const result = await execute({ series: "BOK", days: 90 });

    expect(result.data).toMatchObject({
      rate: 3,
      unit: "%",
      asOf: "2026-10-08",
      comparisonDate: "2026-07-10",
      comparisonRate: 2.5,
      changePp: 0.5,
      changeBp: 50,
      requestedDays: 90,
      // 비교일(07-10)~최신일(10-08) 사이 fixture 행: 07-10, 07-16, 08-27, 10-07, 10-08
      observationCount: 5,
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

    const error = await execute({ series: "BOK", days: 90 }).catch((err: Error) => err);

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

    const result = await execute({ series: "BOK", days: 90 });

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

    await expect(execute({ series: "BOK", days: 90 })).rejects.toThrow("INFO-200");
  });
});

describe("Rate Tool — FRED (DGS10/DFF)", () => {
  // 5. FRED 정상 응답 테스트
  it("국채 10년물 금리와 90일 변동폭을 계산한다", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    const fetchMock = mockFetch(fixture.fred);

    const result = await execute({ series: "DGS10", days: 90 });

    expect(result.data).toMatchObject({
      rate: 5.21,
      unit: "%",
      asOf: "2026-10-13",
      comparisonDate: "2026-07-15",
      comparisonRate: 4.55,
      changePp: 0.66,
      changeBp: 66,
      requestedDays: 90,
      // 비교일(07-15)~최신일(10-13) 사이 유효 fixture 행 ("." 휴일 09-07·10-12 제외):
      // 07-15, 09-04, 09-11, 09-14, 10-07, 10-09, 10-13
      observationCount: 7,
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
    const result = await execute({ series: "DGS10", days: 30 });

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

    const result = await execute({ series: "DGS10", days: 30 });

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

    const result = await execute({ series: "DGS10", days: 90 });

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

    const error = await execute({ series: "DFF", days: 90 }).catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("404");
    expect((error as Error).message).not.toContain("test-key");
  });
});

describe("Rate Tool — CSV 파서", () => {
  it("따옴표 안의 쉼표를 하나의 필드로 처리한다", () => {
    expect(parseCsv('a,"b, c",d')).toEqual([["a", "b, c", "d"]]);
  });

  it('이스케이프된 따옴표("")를 따옴표 하나로 바꾼다', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', "x"]]);
  });

  it("따옴표 안의 줄바꿈은 필드 내용으로 유지한다", () => {
    expect(parseCsv('"line1\nline2",x\r\n"a\r\nb",y')).toEqual([
      ["line1\nline2", "x"],
      ["a\r\nb", "y"],
    ]);
  });

  it("LF·CRLF 줄바꿈, 마지막 줄바꿈, 빈 줄, BOM 을 처리한다", () => {
    expect(parseCsv("﻿A,B\r\n1,2\n\n3,4\r\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("빈 필드를 유지한다", () => {
    expect(parseCsv("a,,\n,b,")).toEqual([
      ["a", "", ""],
      ["", "b", ""],
    ]);
  });

  it("닫히지 않은 따옴표는 형식 오류로 throw 한다", () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow("닫히지 않은 따옴표");
  });

  it("실제 BIS 응답의 따옴표·쉼표가 포함된 COMPILATION 을 헤더 컬럼 수대로 파싱한다", () => {
    for (const lines of Object.values(fixture.bis)) {
      for (const cells of parseCsv(bisCsv(lines))) expect(cells).toHaveLength(BIS_HEADER.length);
    }
    const [jp] = parseCsv(fixture.bis.JP.at(-1) ?? "");
    expect(jp[column("COMPILATION")]).toMatch(/^From 24 Sep 2026: .*, refer to https:\/\/data\.bis\.org\/topics\/CBPOL$/);
    expect(jp[column("TIME_PERIOD")]).toBe("2026-10-13");
    expect(jp[column("OBS_VALUE")]).toBe("1.25");
  });
});

describe("Rate Tool — BIS 주요국 정책금리", () => {
  // 1. 7개국 조회 · URL 생성
  it.each([
    // country, rate, asOf, comparisonDate, comparisonRate, changePp, changeBp, daysSinceLatest, sourceRef
    ["JP", 1.25, "2026-10-13", "2026-07-15", 1, 0.25, 25, 2, "Bank of Japan"],
    ["GB", 3.75, "2026-10-12", "2026-07-14", 3.75, 0, 0, 3, "Bank of England"],
    ["CA", 2.25, "2026-10-12", "2026-07-14", 2.25, 0, 0, 3, "Bank of Canada"],
    ["AU", 4.6, "2026-10-08", "2026-07-10", 4.35, 0.25, 25, 7, "Reserve Bank of Australia"],
    ["CH", 0, "2026-10-13", "2026-07-15", 0, 0, 0, 2, "Swiss National Bank"],
    ["CN", 3, "2026-10-13", "2026-07-15", 3, 0, 0, 2, "People's Bank of China"],
    ["BR", 13.75, "2026-10-13", "2026-07-15", 14.25, -0.5, -50, 2, "Central Bank of Brazil"],
  ] as const)(
    "%s 정책금리와 90일 변동폭을 조회한다",
    async (country, rate, asOf, comparisonDate, comparisonRate, changePp, changeBp, daysSinceLatest, sourceRef) => {
      const fetchMock = mockBis(fixture.bis[country]);

      const result = await execute({ series: country, days: 90 });

      expect(result.data).toMatchObject({
        country,
        rate,
        unit: "%",
        asOf,
        comparisonDate,
        comparisonRate,
        changePp,
        changeBp,
        requestedDays: 90,
        daysSinceLatest,
        stale: false,
        sourceRef,
        title: expect.stringMatching(/^Central bank policy rates - .+ - Daily - End of period$/),
        definition: expect.any(String),
      });
      expect(result.source).toEqual({
        name: "BIS Central bank policy rates (WS_CBPOL)",
        url: `https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/D.${country}`,
        asOf,
      });
      expect(result.note).not.toContain("경고");

      // 최신 관측일이 늦어도 비교값이 들어오도록 요청 기간 + 30일을 조회한다 (키 불필요)
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe(
        `https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.${country}`,
      );
      expect(url.searchParams.get("startPeriod")).toBe("2026-06-17");
      expect(url.searchParams.get("endPeriod")).toBe("2026-10-15");
      expect(url.searchParams.get("format")).toBe("csv");
    },
  );

  // 2. 365일 비교 — 실제 API 조회 범위(startPeriod) 안에 1년 전 비교값이 들어오는지 함께 검증
  it.each([
    ["JP", "2025-10-13", 0.5, 0.75, 75],
    ["GB", "2025-10-10", 4, -0.25, -25], // 2025-10-12(일) → 직전 영업일
    ["CA", "2025-10-10", 2.5, -0.25, -25],
    ["AU", "2025-10-08", 3.6, 1, 100],
    ["CH", "2025-10-13", 0, 0, 0],
    ["CN", "2025-10-13", 3, 0, 0],
    ["BR", "2025-10-13", 15, -1.25, -125],
  ] as const)("%s 365일 변동폭을 계산한다", async (country, comparisonDate, comparisonRate, changePp, changeBp) => {
    const fetchMock = mockBis(fixture.bis[country]);

    const result = await execute({ series: country, days: 365 });

    expect(result.data).toMatchObject({ comparisonDate, comparisonRate, changePp, changeBp, requestedDays: 365 });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("startPeriod")).toBe("2025-09-15");
  });

  // 3. 30·90·365일 비교 기준일
  it.each([
    // 2026-10-13 - 30일 = 2026-09-13(일) → 2026-09-11(금)
    [30, "2026-08-16", "2026-09-11", 1, 0.25, 25],
    [90, "2026-06-17", "2026-07-15", 1, 0.25, 25],
    [365, "2025-09-15", "2025-10-13", 0.5, 0.75, 75],
  ] as const)(
    "JP %i일 비교: 최신 관측일 기준 N일 전 또는 직전 관측값과 비교한다",
    async (days, startPeriod, comparisonDate, comparisonRate, changePp, changeBp) => {
      const fetchMock = mockBis(fixture.bis.JP);

      const result = await execute({ series: "JP", days });

      expect(result.data).toMatchObject({
        rate: 1.25,
        asOf: "2026-10-13",
        comparisonDate,
        comparisonRate,
        changePp,
        changeBp,
      });
      expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("startPeriod")).toBe(startPeriod);
    },
  );

  // 4. 스위스 0%
  it("스위스 0% 금리를 결측이 아닌 유효한 값으로 처리한다", async () => {
    mockBis(fixture.bis.CH);

    const result = await execute({ series: "CH", days: 30 });

    expect(result.data).toMatchObject({
      rate: 0,
      asOf: "2026-10-13",
      comparisonDate: "2026-09-11",
      comparisonRate: 0,
      changePp: 0,
      changeBp: 0,
    });
  });

  // 5. 휴일(NaN, OBS_STATUS=M)
  it("비교 기준일이 휴일(NaN, 상태 M)이면 직전 관측값을 사용한다", async () => {
    // CA fixture 의 2026-09-12(토)는 실제 응답에서 NaN·M 이다
    mockBis(fixture.bis.CA);

    const result = await execute({ series: "CA", days: 30 });

    expect(result.data).toMatchObject({ asOf: "2026-10-12", comparisonDate: "2026-09-11", comparisonRate: 2.25 });
  });

  it("최신 행이 휴일(NaN, 상태 M)이면 직전 관측일을 최신값으로 쓴다", async () => {
    mockBis([...fixture.bis.CA, bisRow("CA", { TIME_PERIOD: "2026-10-13", OBS_VALUE: "NaN", OBS_STATUS: "M" })]);

    const result = await execute({ series: "CA", days: 90 });

    expect(result.data).toMatchObject({ rate: 2.25, asOf: "2026-10-12" });
  });

  // 6. 빈 값·잘못된 금리·관측 상태·날짜
  it.each([
    ["빈 문자열", { OBS_VALUE: "" }],
    ["공백", { OBS_VALUE: " " }],
    ["NaN", { OBS_VALUE: "NaN" }],
    ["숫자가 아닌 값", { OBS_VALUE: "abc" }],
    ["OBS_STATUS=M", { OBS_STATUS: "M" }],
    ["OBS_STATUS=P(A 아님)", { OBS_STATUS: "P" }],
    ["OBS_STATUS 없음", { OBS_STATUS: "" }],
    ["존재하지 않는 날짜", { TIME_PERIOD: "2026-02-30" }],
    ["날짜 형식 오류", { TIME_PERIOD: "2026/10/14" }],
    ["다른 국가 행", { REF_AREA: "IN" }],
    ["월별 행", { FREQ: "M" }],
  ])("사용할 수 없는 관측값(%s)은 제외한다", async (_label, changes) => {
    // 최신 관측일 2026-10-13 을 무효로 만들면 2026-10-12 가 최신값이 되고,
    // 비교 기준일도 2026-10-12 - 30일 = 2026-09-12(토) → 2026-09-11 로 바뀐다
    const lines = [...fixture.bis.JP];
    lines[lines.length - 1] = bisRow("JP", changes);
    mockBis(lines);

    const result = await execute({ series: "JP", days: 30 });

    expect(result.data).toMatchObject({ rate: 1.25, asOf: "2026-10-12", comparisonDate: "2026-09-11" });
  });

  // 7. COMPILATION 원문 · 쉼표·따옴표·줄바꿈 컬럼
  it("COMPILATION 원문을 자르지 않고 정의(definition)로 반환한다", async () => {
    mockBis(fixture.bis.JP);

    const result = await execute({ series: "JP", days: 30 });

    const original = parseCsv(fixture.bis.JP.at(-1) ?? "")[0][column("COMPILATION")];
    expect(original.length).toBeGreaterThan(1000);
    expect(result.data).toMatchObject({
      definition: original,
      centralBank: "일본은행(Bank of Japan)",
      sourceRef: "Bank of Japan",
    });
  });

  it("쉼표·이스케이프된 따옴표·줄바꿈이 섞인 컬럼과 CRLF 응답을 처리한다", async () => {
    const compilation = 'Policy rate, "official" bank rate;\nsee notes, part 2';
    mockBis(
      [...fixture.bis.GB, bisRow("GB", { TIME_PERIOD: "2026-10-13", OBS_VALUE: "3.5", COMPILATION: compilation })],
      "\r\n",
    );

    const result = await execute({ series: "GB", days: 90 });

    expect(result.data).toMatchObject({
      rate: 3.5,
      asOf: "2026-10-13",
      comparisonRate: 3.75,
      changePp: -0.25,
      changeBp: -25,
      definition: compilation,
    });
  });

  it("중국은 BIS 원자료 정의(1년 LPR)에 맞는 지표명으로 반환한다", async () => {
    mockBis(fixture.bis.CN);

    const result = await execute({ series: "CN", days: 90 });

    expect(result.data).toMatchObject({
      indicator: "중국 1년 만기 LPR",
      centralBank: "중국인민은행(People's Bank of China)",
      sourceRef: "People's Bank of China",
      definition: expect.stringMatching(/^From 20 Aug 2019 onwards: Loan Prime Rate\s+\(1 year\)/),
    });
  });

  it.each([
    ["JP", "일본 정책금리", "일본은행(Bank of Japan)"],
    ["GB", "영국 정책금리", "영란은행(Bank of England)"],
    ["CA", "캐나다 정책금리", "캐나다은행(Bank of Canada)"],
    ["AU", "호주 정책금리", "호주중앙은행(RBA, Reserve Bank of Australia)"],
    ["CH", "스위스 정책금리", "스위스국립은행(Swiss National Bank)"],
    ["BR", "브라질 정책금리", "브라질중앙은행(Banco Central do Brasil)"],
  ] as const)("%s 지표명과 중앙은행 명칭", async (country, indicator, centralBank) => {
    mockBis(fixture.bis[country]);

    const result = await execute({ series: country, days: 30 });

    expect(result.data).toMatchObject({ indicator, centralBank });
  });

  // 같은 TIME_PERIOD 중복
  it("같은 관측일이 중복되면 마지막 유효 행 하나로 금리값과 설명을 함께 고른다", async () => {
    mockBis(fixture.bis.JP);
    const base = await execute({ series: "JP", days: 30 });

    const duplicate = bisRow("JP", { OBS_VALUE: "1.5", TITLE: "Duplicated title", COMPILATION: "Duplicated definition" });
    mockBis([...fixture.bis.JP, duplicate]);
    const result = await execute({ series: "JP", days: 30 });

    expect(result.data).toMatchObject({
      rate: 1.5,
      asOf: "2026-10-13",
      title: "Duplicated title",
      definition: "Duplicated definition",
      changePp: 0.5,
      changeBp: 50,
    });
    // 중복 관측일은 한 번만 센다
    expect((result.data as { observationCount: number }).observationCount).toBe(
      (base.data as { observationCount: number }).observationCount,
    );
  });

  it("중복 관측일의 뒤 행이 무효(NaN, 상태 M)면 앞의 유효 행을 금리값·설명 모두에 쓴다", async () => {
    const original = parseCsv(fixture.bis.JP.at(-1) ?? "")[0][column("COMPILATION")];
    const invalid = bisRow("JP", { OBS_VALUE: "NaN", OBS_STATUS: "M", COMPILATION: "Invalid row definition" });
    mockBis([...fixture.bis.JP, invalid]);

    const result = await execute({ series: "JP", days: 30 });

    expect(result.data).toMatchObject({ rate: 1.25, asOf: "2026-10-13", definition: original });
  });

  // 8. 오래된 관측값
  it.each([
    ["2026-10-22T03:00:00Z", 14, false],
    ["2026-10-23T03:00:00Z", 15, true],
    ["2026-11-05T03:00:00Z", 28, true],
  ] as const)("현재 %s 이면 경과 %i일, stale=%s", async (now, daysSinceLatest, stale) => {
    vi.setSystemTime(new Date(now));
    mockBis(fixture.bis.AU);

    const result = await execute({ series: "AU", days: 30 });

    // 최신 관측일이 오래돼도 비교값(2026-09-08)이 조회 범위 안에 있어 계산된다
    expect(result.data).toMatchObject({ asOf: "2026-10-08", comparisonDate: "2026-09-08", daysSinceLatest, stale });
    if (stale) {
      expect(result.note).toContain(
        `경고: 최신 관측일(2026-10-08)이 오늘(${now.slice(0, 10)}) 기준 ${daysSinceLatest}일 전입니다.`,
      );
    } else {
      expect(result.note).not.toContain("경고");
    }
  });

  // 9. 비교할 과거 값이 없음
  it("비교 기준일 이전 관측값이 없으면 임의로 계산하지 않고 throw 한다", async () => {
    // 2026-10 이후 행(10-12, 10-13)만 있는 응답
    const recent = fixture.bis.JP.slice(1).filter((line) => parseCsv(line)[0][column("TIME_PERIOD")] >= "2026-10-01");
    expect(recent).toHaveLength(2);
    mockBis([fixture.bis.JP[0], ...recent]);

    await expect(execute({ series: "JP", days: 30 })).rejects.toThrow(
      "2026-09-13 이전의 비교 가능한 금리 데이터가 없습니다.",
    );
  });

  // 10. API 오류 · 응답 형식 오류
  it.each([
    [404, "BIS API 요청 실패 (404): 조회 기간에 관측값이 없거나 시계열을 찾을 수 없습니다"],
    [500, "BIS API 요청 실패 (500)"],
  ])("HTTP %i 이면 에러를 던진다", async (status, message) => {
    mockText("NoResultsFound", status);

    await expect(execute({ series: "JP", days: 30 })).rejects.toThrow(message);
  });

  it("네트워크 오류·타임아웃이면 에러를 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );

    await expect(execute({ series: "JP", days: 30 })).rejects.toThrow(
      "BIS API 요청 실패: The operation was aborted due to timeout",
    );
  });

  it.each([
    ["빈 응답", "", "BIS 응답이 비어 있습니다."],
    ["공백 응답", " \r\n", "BIS 응답이 비어 있습니다."],
    ["헤더만 있는 응답", `${fixture.bis.JP[0]}\n`, "조회 기간에 유효한 금리 데이터가 없습니다."],
    ["HTML 응답", "<html><body>Service Unavailable</body></html>", "BIS 응답 형식 오류"],
    ["필수 컬럼 누락", "FREQ,REF_AREA,TIME_PERIOD\nD,JP,2026-10-13\n", "OBS_VALUE, OBS_STATUS 컬럼이 없습니다."],
    ["컬럼 수 불일치", `${fixture.bis.JP[0]}\nD,JP,2026-10-13,1.25\n`, "2번째 행의 컬럼 수(4)가 헤더(15)와 다릅니다."],
    ["닫히지 않은 따옴표", `${fixture.bis.JP[0]}\nD,JP,368,0,,"unterminated\n`, "닫히지 않은 따옴표"],
  ])("%s 이면 에러를 던진다", async (_label, body, message) => {
    mockText(body);

    await expect(execute({ series: "JP", days: 30 })).rejects.toThrow(message);
  });
});

describe("Rate Tool — 입력 검증", () => {
  it.each(["IN", "US", "KR", "XX", ""])("지원하지 않는 국가(%s)는 스키마에서 거부한다", (series) => {
    expect(parameters.safeParse({ series, days: 90 }).success).toBe(false);
  });

  it("스키마를 거치지 않아도 지원하지 않는 국가는 API 호출 전에 막는다", async () => {
    const fetchMock = mockText("");

    await expect(execute({ series: "IN", days: 90 } as unknown as Input)).rejects.toThrow(
      "지원하지 않는 금리 지표입니다: IN",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([30, 90, 365])("days 숫자 %i 를 허용한다", (days) => {
    expect(parameters.safeParse({ series: "JP", days }).success).toBe(true);
  });

  it.each([["90"], [60], [0], [-30], [90.5], [null]])("days %j 는 거부한다", (days) => {
    expect(parameters.safeParse({ series: "BOK", days }).success).toBe(false);
  });

  it("스키마를 거치지 않아도 지원하지 않는 days 는 API 호출 전에 막는다", async () => {
    const fetchMock = mockText("");

    await expect(execute({ series: "JP", days: 60 } as unknown as Input)).rejects.toThrow(
      "지원하지 않는 비교 기간입니다: 60",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Agent 에 노출되는 days 스키마는 숫자 enum 이다", () => {
    expect(parameters.shape.days.toJSONSchema()).toMatchObject({ type: "number", enum: [30, 90, 365] });
  });
});
