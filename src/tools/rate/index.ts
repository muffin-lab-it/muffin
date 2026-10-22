/**
 * Rate Tool — 한국·미국·주요국 금리 데이터 조회
 *
 * 한국은행 ECOS, 미국 FRED, BIS API를 이용해
 * 한국은행 기준금리(BOK), 미국 국채 10년물 금리(DGS10),
 * 미국 실효 연방기금금리(DFF), 주요 7개국 정책금리(BIS WS_CBPOL)를 조회합니다.
 *
 * 조회 기간: 최근 30일 / 90일 / 365일
 * 반환 정보: 최신 금리, 비교 금리, 금리 변동폭(%p, bp), 데이터 출처
 */
import { z } from "zod";
import { fetchJson, fetchText, HttpError } from "../../lib/http";
import { defineTool } from "../define";
import type { ToolResult } from "../types";

// BIS 일별(D) 정책금리가 확인된 국가만 지원합니다.
// centralBank 는 BIS SOURCE_REF(원자료 제공처) 와 별개로 둔 중앙은행 명칭입니다.
// indicator 는 BIS COMPILATION 의 현재 정의에 맞춥니다 (중국: "From 20 Aug 2019 onwards: Loan Prime Rate (1 year)").
const BIS_COUNTRIES = {
  JP: { indicator: "일본 정책금리", centralBank: "일본은행(Bank of Japan)" },
  GB: { indicator: "영국 정책금리", centralBank: "영란은행(Bank of England)" },
  CA: { indicator: "캐나다 정책금리", centralBank: "캐나다은행(Bank of Canada)" },
  AU: { indicator: "호주 정책금리", centralBank: "호주중앙은행(RBA, Reserve Bank of Australia)" },
  CH: { indicator: "스위스 정책금리", centralBank: "스위스국립은행(Swiss National Bank)" },
  CN: { indicator: "중국 1년 만기 LPR", centralBank: "중국인민은행(People's Bank of China)" },
  BR: { indicator: "브라질 정책금리", centralBank: "브라질중앙은행(Banco Central do Brasil)" },
} as const;

type BisCountry = keyof typeof BIS_COUNTRIES;

function isBisCountry(series: string): series is BisCountry {
  return Object.hasOwn(BIS_COUNTRIES, series);
}

const SUPPORTED_DAYS = [30, 90, 365] as const;

// 1) 입력 스키마. Agent 가 이 스키마를 보고 인자를 채웁니다.
//    모든 필드는 required 로 두세요 (optional 대신 nullable 사용).
export const parameters = z.object({
  series: z
    .enum(["BOK", "DGS10", "DFF", "JP", "GB", "CA", "AU", "CH", "CN", "BR"])
    .describe(
      "조회 지표. BOK: 한국은행 기준금리, DGS10: 미국 10년 국채금리, DFF: 미국 실효 연방기금금리, " +
        "JP 일본·GB 영국·CA 캐나다·AU 호주·CH 스위스·CN 중국·BR 브라질: 해당국 정책금리(BIS). 그 외 국가는 지원하지 않음",
    ),
  days: z.literal(SUPPORTED_DAYS).describe("금리 비교 기간(일). 30, 90, 365 중 하나의 숫자"),
});

export type Input = z.infer<typeof parameters>;
type Days = Input["days"];

// 2) 외부 API 응답 타입 정의
// 한국은행 ECOS 기준금리 데이터
type EcosRow = {
  TIME: string;
  DATA_VALUE: string | null;
  ITEM_NAME1: string;
  UNIT_NAME: string;
};
type EcosResponse = {
  StatisticSearch?: {
    row?: EcosRow[];
  };
  RESULT?: {
    CODE: string;
    MESSAGE: string;
  };
};
// 미국 FRED 금리 시계열 데이터
type FredResponse = {
  observations: {
    date: string;
    value: string | null;
  }[];
};

// 날짜는 한국·미국 모두 YYYY-MM-DD 로 통일합니다.
type Observation = {
  date: string;
  rate: number;
};

// 발표 시차·휴일 때문에 비교 기준일보다 앞선 관측값이 필요하므로 여유 기간을 더 조회합니다.
const FETCH_BUFFER_DAYS = 14;

// BIS는 국가별로 마지막 관측일이 늦을 수 있습니다. 최신 관측일이 오래돼도(stale)
// N일 전 비교값이 조회 범위 안에 들어오도록 ECOS·FRED 보다 여유를 더 둡니다.
const BIS_FETCH_BUFFER_DAYS = 30;
// 최신 관측일이 오늘(한국 시간)보다 이 일수를 넘게 지나면 stale로 안내합니다.
const BIS_STALE_AFTER_DAYS = 14;
const BIS_API_BASE = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0";
const BIS_REQUIRED_COLUMNS = ["FREQ", "REF_AREA", "TIME_PERIOD", "OBS_VALUE", "OBS_STATUS"] as const;

const COMPARISON_NOTE =
  "변동폭은 최신 관측일로부터 요청 기간(requestedDays)만큼 이전 날짜의 값과 비교한 차이이며, " +
  "그날 값이 없으면 직전 관측일 값을 사용합니다. " +
  "최신 관측일은 발표 시차로 오늘보다 이전일 수 있습니다.";

// 한국 현재 날짜를 YYYY-MM-DD 형식으로 반환합니다.
function koreanToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// YYYY-MM-DD 형식의 날짜에 지정한 일수를 더합니다 (음수면 차감).
function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

// 금리 문자열을 숫자로 바꿉니다. 결측값("", " ", ".", null)은 0 이 아니라 null 로 처리합니다.
function parseRate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || text === ".") return null;
  const rate = Number(text);
  return Number.isFinite(rate) ? rate : null;
}

// 실제로 존재하는 YYYY-MM-DD 날짜인지 확인합니다 (2026-02-30 같은 값은 거부).
function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// 두 YYYY-MM-DD 날짜 사이의 일수(to - from)를 구합니다.
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// RFC 4180 CSV 를 행 배열로 파싱합니다.
// 따옴표로 감싼 필드 안의 쉼표·줄바꿈, 이스케이프된 따옴표(""), LF·CRLF 줄바꿈을 처리합니다.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // UTF-8 BOM 은 첫 컬럼 이름에 섞이지 않도록 건너뜁니다.
  for (let i = text.startsWith("﻿") ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') {
        field += ch;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new Error("CSV 형식 오류: 닫히지 않은 따옴표가 있습니다.");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 빈 줄은 무시합니다.
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ""));
}

// 최신 관측값과, 최신 관측일 기준 N일 전(없으면 직전 관측일)의 값을 비교합니다.
// observations 는 날짜 오름차순이어야 합니다.
function compareRates(observations: Observation[], days: number) {
  const latest = observations.at(-1);
  if (!latest) {
    throw new Error("조회 기간에 유효한 금리 데이터가 없습니다.");
  }

  const cutoff = shiftDays(latest.date, -days);
  const comparison = observations.findLast((row) => row.date <= cutoff);
  if (!comparison) {
    throw new Error(`${cutoff} 이전의 비교 가능한 금리 데이터가 없습니다.`);
  }

  const changePp = Number((latest.rate - comparison.rate).toFixed(4));

  return {
    rate: latest.rate,
    unit: "%",
    asOf: latest.date,
    comparisonDate: comparison.date,
    comparisonRate: comparison.rate,
    changePp,
    changeBp: Number((changePp * 100).toFixed(2)),
    requestedDays: days,
    // 비교일부터 최신 관측일까지의 유효 관측값 수
    observationCount: observations.filter((row) => row.date >= comparison.date).length,
  };
}

// 3) Rate Tool 실행 함수
// BOK는 ECOS API로 조회하고, 미국 금리는 executeFred, 주요국 정책금리는 executeBis로 전달합니다.
export async function execute({ series, days }: Input): Promise<ToolResult> {
  // execute 는 스키마 검증 없이 직접 호출될 수도 있어 한 번 더 막습니다.
  if (!SUPPORTED_DAYS.includes(days)) {
    throw new Error(`지원하지 않는 비교 기간입니다: ${String(days)}. 30, 90, 365 중 하나를 사용하세요.`);
  }
  if (isBisCountry(series)) {
    return executeBis(series, days);
  }
  if (series === "DGS10" || series === "DFF") {
    return executeFred(series, days);
  }
  if (series !== "BOK") {
    throw new Error(`지원하지 않는 금리 지표입니다: ${String(series)}`);
  }

  // 한국은행 ECOS API 키 확인
  const apiKey = process.env.ECOS_API_KEY;

  if (!apiKey) {
    throw new Error("ECOS_API_KEY가 설정되지 않았습니다");
  }

  const end = koreanToday();
  const start = shiftDays(end, -(days + FETCH_BUFFER_DAYS));
  const compact = (date: string) => date.replace(/-/g, "");

  const url = [
    "https://ecos.bok.or.kr/api/StatisticSearch",
    encodeURIComponent(apiKey),
    "json",
    "kr",
    "1",
    "1000",
    "722Y001",
    "D",
    compact(start),
    compact(end),
    "0101000",
  ].join("/");

  let json: EcosResponse;

  try {
    json = await fetchJson<EcosResponse>(url);
  } catch (err) {
    // HTTP 상태 코드만 추출하고 API 키가 포함된 URL은 숨김
    const message = err instanceof Error ? err.message : "";
    const status = message.match(/\b[45]\d{2}\b/)?.[0];
    throw new Error(`ECOS API 요청 실패${status ? ` (${status})` : ""}`);
  }

  if (!json.StatisticSearch) {
    throw new Error(`ECOS 응답 오류: ${json.RESULT?.CODE ?? "UNKNOWN"}`);
  }

  // ECOS 날짜(YYYYMMDD)를 YYYY-MM-DD 로 변환하고 결측값은 제외합니다.
  const observations: Observation[] = [];
  for (const row of json.StatisticSearch.row ?? []) {
    const rate = parseRate(row.DATA_VALUE);
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(row.TIME);
    if (rate === null || !match) continue;
    observations.push({ date: `${match[1]}-${match[2]}-${match[3]}`, rate });
  }
  observations.sort((a, b) => a.date.localeCompare(b.date));

  const data = compareRates(observations, days);

  // 팀 공통 ToolResult 형식
  return {
    data: {
      indicator: "한국은행 기준금리",
      ...data,
    },
    source: {
      name: "한국은행 경제통계시스템(ECOS)",
      url: "https://ecos.bok.or.kr",
      asOf: data.asOf,
    },
    note:
      "기준금리는 정책금리로, 시장금리의 일별 변동과는 다릅니다. " +
      "ECOS 단위 '연%'를 '%'로 표기합니다. " +
      COMPARISON_NOTE,
  };
}

// 미국 FRED 금리 데이터 조회
// DGS10과 DFF를 조회하고 기간별 금리 변동폭을 계산합니다.
async function executeFred(series: "DGS10" | "DFF", days: Days): Promise<ToolResult> {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    throw new Error("FRED_API_KEY가 설정되지 않았습니다.");
  }

  const end = koreanToday();
  const start = shiftDays(end, -(days + FETCH_BUFFER_DAYS));

  const url = new URL("https://api.stlouisfed.org/fred/series/observations");

  url.searchParams.set("series_id", series);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", start);
  url.searchParams.set("observation_end", end);

  let json: FredResponse;

  try {
    json = await fetchJson<FredResponse>(url.toString());
  } catch (err) {
    // HTTP 상태 코드만 추출하고 API 키가 포함된 URL은 숨김
    const message = err instanceof Error ? err.message : "";
    const status = message.match(/\b[45]\d{2}\b/)?.[0];
    throw new Error(`FRED API 요청 실패${status ? ` (${status})` : ""}`);
  }

  if (!Array.isArray(json.observations)) {
    throw new Error("FRED 응답 구조가 올바르지 않습니다.");
  }

  // 주말·휴일 등 값이 없는 날(".")과 결측값은 제외합니다.
  const observations: Observation[] = [];
  for (const row of json.observations) {
    const rate = parseRate(row.value);
    if (rate === null || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    observations.push({ date: row.date, rate });
  }
  observations.sort((a, b) => a.date.localeCompare(b.date));

  const data = compareRates(observations, days);

  return {
    data: {
      indicator: series === "DGS10" ? "미국 국채 10년물 금리" : "미국 실효 연방기금금리",
      ...data,
    },
    source: {
      name: "Federal Reserve Bank of St. Louis (FRED)",
      url: `https://fred.stlouisfed.org/series/${series}`,
      asOf: data.asOf,
    },
    note:
      "DGS10은 미국 국채 10년물 시장금리, DFF는 미국 실효 연방기금금리입니다. " +
      "주말·미국 공휴일 등 값이 없는 날('.')은 제외합니다. " +
      COMPARISON_NOTE,
  };
}

type BisRow = Record<string, string>;

// BIS CSV 를 헤더 이름 기준의 행 객체로 바꿉니다. 컬럼 순서가 바뀌어도 동작합니다.
function parseBisCsv(text: string): BisRow[] {
  if (text.trim() === "") {
    throw new Error("BIS 응답이 비어 있습니다.");
  }

  const [header = [], ...lines] = parseCsv(text);
  const missing = BIS_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`BIS 응답 형식 오류: ${missing.join(", ")} 컬럼이 없습니다.`);
  }

  return lines.map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(
        `BIS 응답 형식 오류: ${index + 2}번째 행의 컬럼 수(${cells.length})가 헤더(${header.length})와 다릅니다.`,
      );
    }
    return Object.fromEntries(header.map((column, i) => [column, cells[i]]));
  });
}

// 설명 컬럼은 원문 그대로 두고 앞뒤 공백만 정리합니다. 값이 없으면 null.
function textColumn(row: BisRow, column: string): string | null {
  const value = row[column]?.trim();
  return value ? value : null;
}

// BIS 주요국 정책금리 조회 (일별 D 시계열, 키 불필요)
async function executeBis(country: BisCountry, days: Days): Promise<ToolResult> {
  const today = koreanToday();

  const url = new URL(`${BIS_API_BASE}/D.${country}`);
  url.searchParams.set("startPeriod", shiftDays(today, -(days + BIS_FETCH_BUFFER_DAYS)));
  url.searchParams.set("endPeriod", today);
  url.searchParams.set("format", "csv");

  let text: string;

  try {
    text = await fetchText(url.toString());
  } catch (err) {
    if (err instanceof HttpError) {
      // BIS 는 조회 기간에 데이터가 없거나 시계열이 없으면 404 를 돌려줍니다.
      const hint = err.status === 404 ? ": 조회 기간에 관측값이 없거나 시계열을 찾을 수 없습니다" : "";
      throw new Error(`BIS API 요청 실패 (${err.status})${hint}`);
    }
    throw new Error(`BIS API 요청 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 사용 기준: 일별(D)·요청 국가·OBS_STATUS=A(정상)·유효한 날짜·숫자 금리.
  // OBS_STATUS=M(결측, OBS_VALUE=NaN) 등 그 외 상태는 제외합니다. 0% 는 유효한 값입니다.
  // 같은 관측일이 여러 번 오면 응답의 마지막 유효 행 하나만 남겨,
  // 금리값과 지표 설명(TITLE·COMPILATION 등)이 항상 같은 행에서 나오게 합니다.
  const byDate = new Map<string, { rate: number; row: BisRow }>();
  for (const row of parseBisCsv(text)) {
    const rate = parseRate(row.OBS_VALUE);
    const date = row.TIME_PERIOD;
    if (row.FREQ !== "D" || row.REF_AREA !== country || row.OBS_STATUS !== "A") continue;
    if (rate === null || !isValidDate(date)) continue;
    byDate.set(date, { rate, row });
  }
  const observations: Observation[] = [...byDate].map(([date, { rate }]) => ({ date, rate }));
  observations.sort((a, b) => a.date.localeCompare(b.date));

  const data = compareRates(observations, days);
  const latestRow = byDate.get(data.asOf)?.row;
  const { indicator, centralBank } = BIS_COUNTRIES[country];
  const daysSinceLatest = daysBetween(data.asOf, today);
  const stale = daysSinceLatest > BIS_STALE_AFTER_DAYS;

  const notes = [
    "국가마다 정책금리 지표의 정의가 다르므로(예: 중국은 1년 LPR) data.definition 을 함께 확인해야 합니다.",
    "BIS 관측값 중 OBS_STATUS가 A(정상)인 값만 사용하며, 주말·휴일 결측(NaN, 상태 M)은 제외합니다.",
    COMPARISON_NOTE,
  ];
  if (stale) {
    notes.unshift(
      `경고: 최신 관측일(${data.asOf})이 오늘(${today}) 기준 ${daysSinceLatest}일 전입니다. ` +
        "그 이후의 정책금리 변경이 반영되지 않았을 수 있습니다.",
    );
  }

  return {
    data: {
      indicator,
      country,
      centralBank,
      ...data,
      daysSinceLatest,
      stale,
      title: latestRow ? textColumn(latestRow, "TITLE") : null,
      // COMPILATION: 해당국 정책금리 정의와 시기별 변경 이력 (원문)
      definition: latestRow ? textColumn(latestRow, "COMPILATION") : null,
      supplementaryInfo: latestRow ? textColumn(latestRow, "SUPP_INFO_BREAKS") : null,
      // SOURCE_REF: BIS 가 밝힌 원자료 제공처 (중앙은행 명칭과 다를 수 있음)
      sourceRef: latestRow ? textColumn(latestRow, "SOURCE_REF") : null,
    },
    source: {
      name: "BIS Central bank policy rates (WS_CBPOL)",
      url: `https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/D.${country}`,
      asOf: data.asOf,
    },
    note: notes.join(" "),
  };
}

// 4) Agent 에 등록할 tool. 리더가 src/tools/index.ts 에 이 export 를 추가합니다.
export const rateTool = defineTool({
  name: "get_rate_data",
  description:
    "금리 수준과 최근 30·90·365일 변동폭(%p, bp)을 조회한다. " +
    "사용: 한국 기준금리(BOK), 미국 국채 10년물(DGS10)·실효 연방기금금리(DFF), " +
    "일본·영국·캐나다·호주·스위스·중국·브라질 정책금리(BIS)를 조회하거나 비교·분석할 때. " +
    "불가: 미래 금리 예측, 실시간 호가·거래 금리, 위 목록 외 국가, 10년물 외 만기의 국채금리. " +
    "국가별 정책금리 정의가 서로 다르므로 data.definition을 확인하고 같은 지표로 간주하지 말 것. " +
    "data.stale이 true면 최신 관측일이 오래된 값이다.",
  parameters,
  execute,
});
