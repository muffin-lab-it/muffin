/**
 * 미국 주가지수 시세 (리더, 11/21). FRED(세인트루이스 연준)의 일별 종가에서 지수의 최신 종가와 기간 변화를 받습니다.
 *
 * 국내 지수 tool(src/tools/kr-index)과 같은 모양으로 돌려주고, 레지스트리(muffinTools)에는 넣지 않습니다.
 * 질문이 미국 지수를 물으면 코드가 직접 부릅니다 (src/agent/index-quote.ts). FRED 는 하루 이틀 늦게 올라와 당일 값은 없습니다.
 */
import { z } from "zod";
import { fetchJson } from "../../lib/http";
import { defineTool, type EvidenceValues } from "../define";
import type { ToolResult } from "../types";

export const US_INDEXES = ["S&P 500", "나스닥 종합", "나스닥 100", "다우존스"] as const;
export type UsIndexName = (typeof US_INDEXES)[number];

/** 지수 이름 → FRED series id */
const SERIES: Record<UsIndexName, string> = { "S&P 500": "SP500", "나스닥 종합": "NASDAQCOM", "나스닥 100": "NASDAQ100", 다우존스: "DJIA" };

export const parameters = z.object({
  index: z.enum(US_INDEXES).describe("지수 이름"),
  days: z.number().int().min(1).max(365).describe("비교 기간(달력 일수). 최신 기준일에서 이만큼 전 이하인 가장 가까운 거래일과 비교"),
});
export type Input = z.infer<typeof parameters>;

const ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";
const SOURCE_NAME = "Federal Reserve Bank of St. Louis (FRED)";
/** 휴장일이 끼어도 비교 시점과 전일을 찾도록 기간보다 넉넉히 받습니다 */
const BUFFER_DAYS = 10;

type FredResponse = { observations?: { date: string; value: string }[]; error_message?: string };

export type UsIndexData = {
  index: UsIndexName;
  latest: { date: string; close: number; change: number; changePct: number };
  period: { from: string; to: string; closeFrom: number; change: number; returnPct: number };
  /** 비교 시점부터 최신까지의 일별 종가. 장부에는 올리지 않고 차트가 씁니다 */
  series: { date: string; close: number }[];
};

const round = (x: number, d: number) => Number(x.toFixed(d));
const day = (date: Date) => date.toISOString().slice(0, 10);

/** 값이 있는 날만 날짜 오름차순으로 (휴장일은 "." 로 옵니다). 형식이 다르면 throw 합니다. */
export function rowsOf(json: FredResponse): { date: string; close: number }[] {
  if (!Array.isArray(json.observations)) throw new Error(`FRED 응답 형식이 예상과 다릅니다${json.error_message ? `: ${json.error_message}` : ""}`);
  return json.observations
    .map((o) => ({ date: o.date, close: Number(o.value) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 최신 거래일을 전 거래일, 그리고 days 일 전 이하인 가장 가까운 거래일과 비교합니다. */
export function toResult(index: UsIndexName, days: number, rows: ReturnType<typeof rowsOf>): ToolResult<UsIndexData> {
  const latest = rows.at(-1);
  const prev = rows.at(-2);
  if (!latest || !prev) throw new Error(`${index} 지수 시세가 없습니다.`);
  const target = day(new Date(Date.parse(`${latest.date}T00:00:00Z`) - days * 86_400_000));
  const from = [...rows].reverse().find((r) => r.date <= target);
  if (!from) throw new Error(`${index} 지수의 ${days}일 전 시세가 없습니다 (가장 이른 자료 ${rows[0]!.date}).`);
  return {
    data: {
      index,
      latest: { date: latest.date, close: latest.close, change: round(latest.close - prev.close, 2), changePct: round((latest.close / prev.close - 1) * 100, 2) },
      period: { from: from.date, to: latest.date, closeFrom: from.close, change: round(latest.close - from.close, 2), returnPct: round((latest.close / from.close - 1) * 100, 2) },
      series: rows.filter((r) => r.date >= from.date),
    },
    source: { name: SOURCE_NAME, url: `https://fred.stlouisfed.org/series/${SERIES[index]}`, asOf: latest.date },
    note: "FRED 에 하루 이틀 늦게 올라오는 일별 종가예요. 장중 · 당일 값은 들어 있지 않아요. 지수 값의 단위는 포인트이고, 전일 대비는 직전 거래일 종가와 비교했어요.",
  };
}

export async function execute({ index, days }: Input): Promise<ToolResult<UsIndexData>> {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY 가 설정되지 않았습니다 (.env.local 확인)");
  const now = Date.now();
  const qs = new URLSearchParams({
    series_id: SERIES[index],
    api_key: key,
    file_type: "json",
    observation_start: day(new Date(now - (days + BUFFER_DAYS) * 86_400_000)),
    observation_end: day(new Date(now + 86_400_000)),
  });
  const json = await fetchJson<FredResponse>(`${ENDPOINT}?${qs}`, { timeoutMs: 8_000 });
  return toResult(index, days, rowsOf(json));
}

/** 장부에 올릴 값. 국내 지수 tool 과 같은 키라 src/agent/index-quote.ts 가 같은 코드로 읽습니다. */
export function evidenceOf(data: UsIndexData): EvidenceValues {
  return {
    index: data.index,
    "latest.date": data.latest.date,
    "latest.close": data.latest.close,
    "latest.change": data.latest.change,
    "latest.changePct": data.latest.changePct,
    "period.from": data.period.from,
    "period.to": data.period.to,
    "period.closeFrom": data.period.closeFrom,
    "period.change": data.period.change,
    "period.returnPct": data.period.returnPct,
  };
}

export const usIndexTool = defineTool({
  name: "get_us_stock_index",
  description:
    "미국 주가지수(S&P 500 · 나스닥 종합 · 나스닥 100 · 다우존스)의 최신 종가와 전일 대비, 지정 기간 변화를 조회한다. " +
    "하루 이틀 늦게 올라오는 일별 종가다. 당일 · 장중 값과 개별 종목 시세는 제공하지 않는다.",
  parameters,
  execute,
  evidence: evidenceOf,
});
