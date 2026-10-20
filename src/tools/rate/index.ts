/**
 * Rate Tool — 한국·미국 금리 데이터 조회
 *
 * 한국은행 ECOS와 미국 FRED API를 이용해
 * 한국은행 기준금리(BOK), 미국 국채 10년물 금리(DGS10),
 * 미국 실효 연방기금금리(DFF)를 조회합니다.
 *
 * 조회 기간: 최근 30일 / 90일 / 365일
 * 반환 정보: 최신 금리, 비교 금리, 금리 변동폭(%p, bp), 데이터 출처
 */
import { z } from "zod";
import { fetchJson } from "../../lib/http";
import { defineTool } from "../define";
import type { ToolResult } from "../types";

// 1) 입력 스키마. Agent 가 이 스키마를 보고 인자를 채웁니다.
//    모든 필드는 required 로 두세요 (optional 대신 nullable 사용).
export const parameters = z.object({
  series: z
    .enum(["BOK", "DGS10", "DFF"])
    .describe("조회 지표. BOK: 한국은행 기준금리, DGS10: 미국 10년 국채금리, DFF: 미국 실효 연방기금금리"),
  days: z.enum(["30", "90", "365"]).describe("기준금리 조회 및 비교 기간(일)"),
});

export type Input = z.infer<typeof parameters>;

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
// BOK는 ECOS API로 조회하고, 미국 금리는 executeFred로 전달합니다.
export async function execute({ series, days }: Input): Promise<ToolResult> {
  if (series !== "BOK") {
    return executeFred(series, days);
  }

  // 한국은행 ECOS API 키 확인
  const apiKey = process.env.ECOS_API_KEY;

  if (!apiKey) {
    throw new Error("ECOS_API_KEY가 설정되지 않았습니다");
  }

  const end = koreanToday();
  const start = shiftDays(end, -(Number(days) + FETCH_BUFFER_DAYS));
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

  const data = compareRates(observations, Number(days));

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
async function executeFred(series: "DGS10" | "DFF", days: "30" | "90" | "365"): Promise<ToolResult> {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    throw new Error("FRED_API_KEY가 설정되지 않았습니다.");
  }

  const end = koreanToday();
  const start = shiftDays(end, -(Number(days) + FETCH_BUFFER_DAYS));

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

  const data = compareRates(observations, Number(days));

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

// 4) Agent 에 등록할 tool. 리더가 src/tools/index.ts 에 이 export 를 추가합니다.
export const rateTool = defineTool({
  name: "get_rate_data",
  description:
    "한국은행 ECOS와 미국 FRED에서 금리 데이터를 조회한다. " +
    "한국은행 기준금리(BOK), 미국 국채 10년물(DGS10), " +
    "미국 실효 연방기금금리(DFF)의 수준과 " +
    "최근 30일, 90일, 365일 변동폭을 제공한다.",
  parameters,
  execute,
});
