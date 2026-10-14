/**
 * Tool 템플릿. 이 폴더를 복사해서 시작하세요.
 *
 *   cp -r src/tools/_template src/tools/<이름>
 *
 * 채울 것은 네 가지입니다: name / description / parameters / execute.
 * execute 는 반드시 ToolResult (data + source) 를 반환하고, 실패하면 throw 합니다.
 * 타임아웃·에러 처리·출처 수집은 defineTool 래퍼가 공통으로 처리합니다.
 *
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
  series: z.enum([ "BOK", "DGS10", "DFF" ])
    .describe("조회 지표. BOK: 한국은행 기준금리, DGS10: 미국 10년 국채금리, DFF: 미국 실효 연방기금금리"),
  days: z.enum(["30", "90", "365"]).describe("기준금리 조회 및 비교 기간(일)"),
});

export type Input = z.infer<typeof parameters>;

// 외부 API 응답 모양. 응답을 어떻게 읽을지는 tool 담당자가 정합니다.

// 2) 외부 API 응답 타입 정의
// 한국은행 ECOS 기준금리 데이터
type EcosRow = {
  TIME: string;
  DATA_VALUE: string;
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
    value: string;
  }[];
};


// 한국 현재 날짜를 YYYYMMDD 형식으로 반환합니다.
function koreanToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", { 
    timeZone: "Asia/Seoul", 
    year: "numeric", 
    month: "2-digit", 
    day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => 
    parts.find((p) => p.type === type)?.value ?? "";
  return value("year") + value("month") + value("day");
} 

// YYYYMMDD 형식의 날짜에서 지정한 일수를 차감합니다.
function subtractDays(dateText: string, days: number): string {
  const y = Number(dateText.slice(0, 4));
  const m = Number(dateText.slice(4, 6));
  const d = Number(dateText.slice(6, 8));
  
  const date = new Date(Date.UTC(y, m - 1, d -days));
 
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

// 3) 실제 로직. Agent 없이도 호출할 수 있게 defineTool 바깥에 둡니다.
//    run.ts 와 index.test.ts 가 이 함수를 직접 부릅니다.
// 3) Rate Tool 실행 함수
// BOK는 ECOS API로 조회하고, 미국 금리는 executeFred로 전달합니다.
export async function execute(
  { series, days }: Input,
): Promise<ToolResult> {
  if (series !== "BOK") {
    return executeFred(series, days);
  }

  // 한국은행 ECOS API 키 확인
  const apiKey = process.env.ECOS_API_KEY;
  
  if (!apiKey) {
    throw new Error("ECOS_API_KEY가 설정되지 않았습니다");
}

  const end = koreanToday();
  const start = subtractDays(end, Number(days));

  const baseUrl = "https://ecos.bok.or.kr/api/StatisticSearch";

  const url = [
    baseUrl,
    encodeURIComponent(apiKey),
    "json",
    "kr",
    "1",
    "1000",
    "722Y001",
    "D",
    start,
    end,
    "0101000",
  ].join("/");

  let json: EcosResponse;

  try {
    json = await fetchJson<EcosResponse>(url);
  } catch (err){
    const message = err instanceof Error ? err.message : "";
    const status = message.match(/\b[45]\d{2}\b/)?.[0];
    throw new Error(`ECOS API 요청 실패${status ? ` (${status})` : ""}`);
  }

  if (!json.StatisticSearch) {
    throw new Error(
      `ECOS 응답 오류: ${json.RESULT?.CODE ?? "UNKNOWN"}`,
    );
  }

  const rows = json.StatisticSearch.row ?? [];

  const observations = rows
    .map((row) => ({
      date: row.TIME,
      rate: Number(row.DATA_VALUE),
      name: row.ITEM_NAME1,
      unit: row.UNIT_NAME,
    }))
    .filter(
      (row) =>
        /^\d{8}$/.test(row.date) &&
        Number.isFinite(row.rate),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  if (observations.length === 0) {
    throw new Error("조회 기간에 유효한 기준금리 데이터가 없습니다.");
  }

  const first = observations[0];
  const latest = observations[observations.length - 1];

  const changePp = Number(
    (latest.rate - first.rate).toFixed(4),
  );
  const changeBp = Number((changePp * 100).toFixed(2));

  const asOf =
    latest.date.slice(0, 4) + "-" +
    latest.date.slice(4, 6) + "-" +
    latest.date.slice(6, 8);


 // 팀 공통 ToolResult 형식
  return {
    data: {
      indicator: "한국은행 기준금리",
      rate: latest.rate,
      unit: latest.unit,
      asOf,
      comparisonDate: first.date,
      comparisonRate: first.rate,
      changePp,
      changeBp,
      requestedDays: Number(days),
      observationCount: observations.length,
    },
    source: {
      name: "한국은행 경제통계시스템(ECOS)",
      url: "https://ecos.bok.or.kr",
      asOf,
    },
    note:
      "기준금리는 정책금리입니다. 변동폭은 조회 기간 내 " +
      "첫 번째와 마지막 관측값의 차이이며, 시장금리의 " +
      "일별 변동과는 다릅니다.",
  };
}

// 미국 FRED 금리 데이터 조회
// DGS10과 DFF를 조회하고 기간별 금리 변동폭을 계산합니다.
async function executeFred(
  series: "DGS10" | "DFF",
  days: "30" | "90" | "365",
): Promise<ToolResult> {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    throw new Error("FRED_API_KEY가 설정되지 않았습니다.");
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Number(days) - 7);

  const formatDate = (date: Date) =>
    date.toISOString().slice(0, 10);

  const url = new URL(
    "https://api.stlouisfed.org/fred/series/observations",
  );

  url.searchParams.set("series_id", series);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", formatDate(start));
  url.searchParams.set("observation_end", formatDate(end));

  let json: FredResponse;

  try {
    json = await fetchJson<FredResponse>(url.toString());
  } catch (err) {
    // HTTP 상태 코드만 추출하고 API 키가 포함된 URL은 숨김
    const message = err instanceof Error ? err.message : "";
    const status = message.match(/\b[45]\d{2}\b/)?.[0];

    throw new Error(
      `FRED API 요청 실패${status ? ` (${status})` : ""}`,
    );
  }

  if (!Array.isArray(json.observations)) {
    throw new Error("FRED 응답 구조가 올바르지 않습니다.");
  }


  const observations = json.observations
  .filter((row) => row.value !== "." && row.value !== "")
  .map((row) => ({
    date: row.date,
    rate: Number(row.value),
  }))
  .filter((row) =>
    /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    Number.isFinite(row.rate),
  )
  .sort((a, b) => a.date.localeCompare(b.date));


  const cutoff = new Date(end);
  cutoff.setUTCDate(cutoff.getUTCDate() - Number(days));
  const cutoffText = formatDate(cutoff);

  const comparison = observations.filter(
    (row) => row.date <= cutoffText,
  );

  if (observations.length === 0 || comparison.length === 0) {
    throw new Error("비교 가능한 FRED 금리 데이터가 없습니다.");
  }

  const first = comparison[comparison.length - 1];
  const latest = observations[observations.length - 1];

  const changePp = Number(
    (latest.rate - first.rate).toFixed(4),
  );

  return {
    data: {
      indicator: series === "DGS10"
        ? "미국 국채 10년물 금리"
        : "미국 실효 연방기금금리",
      rate: latest.rate,
      unit: "%",
      asOf: latest.date,
      comparisonDate: first.date,
      comparisonRate: first.rate,
      changePp,
      changeBp: Number((changePp * 100).toFixed(2)),
      requestedDays: Number(days),
      observationCount: observations.length,
    },
    source: {
      name: "Federal Reserve Bank of St. Louis (FRED)",
      url: `https://fred.stlouisfed.org/series/${series}`,
      asOf: latest.date,
    },
    note:
      "DGS10은 미국 국채 10년물 시장금리, " +
      "DFF는 미국 실효 연방기금금리입니다.",
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