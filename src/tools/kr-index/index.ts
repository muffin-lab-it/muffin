/**
 * 국내 주가지수 시세 (리더, 11/21). 금융위원회 지수시세정보(공공데이터포털, 원천 KRX)에서 지수의 종가와 기간 변화를 받습니다.
 *
 * 11/20 베타에서 "요즘 코스피 어때?" 가 뉴스만 불러 "오늘의 숫자" 가 비어 있었습니다. 지수 값을 주는 tool 이 없었기 때문입니다.
 * 이 tool 은 레지스트리(muffinTools)에 넣지 않고, 지수 질문이면 코드가 직접 부릅니다 (src/agent/supplement.ts ensureIndex).
 * 공개 자료는 다음 영업일 오후에 갱신돼, 최신 값은 직전 영업일 종가입니다.
 */
import { z } from "zod";
import { fetchJson } from "../../lib/http";
import { defineTool, type EvidenceValues } from "../define";
import type { ToolResult } from "../types";

export const KR_INDEXES = ["코스피", "코스닥", "코스피 200", "코스닥 150"] as const;
export type KrIndexName = (typeof KR_INDEXES)[number];

export const parameters = z.object({
  index: z.enum(KR_INDEXES).describe("지수 이름"),
  days: z.number().int().min(1).max(365).describe("비교 기간(달력 일수). 최신 기준일에서 이만큼 전 이하인 가장 가까운 거래일과 비교"),
});
export type Input = z.infer<typeof parameters>;

const ENDPOINT = "https://apis.data.go.kr/1160100/GetMarketIndexInfoService_V2/getStockMarketIndex_V2";
const SOURCE_NAME = "금융위원회 지수시세정보 (공공데이터포털, 원천 KRX)";
const SOURCE_URL = "https://www.data.go.kr/data/15094807/openapi.do";
/** 휴장일이 끼어도 비교 시점을 찾도록 기간보다 넉넉히 받습니다 */
const BUFFER_DAYS = 10;

type IndexRow = { basDt: string; idxNm: string; clpr: string; vs: string; fltRt: string };
type ApiResponse = {
  response?: { header: { resultCode: string; resultMsg: string }; body?: { items?: { item?: IndexRow[] | IndexRow } | "" } };
};

export type KrIndexData = {
  index: KrIndexName;
  latest: { date: string; close: number; change: number; changePct: number };
  period: { from: string; to: string; closeFrom: number; change: number; returnPct: number };
  /** 비교 시점부터 최신까지의 일별 종가. 장부에는 올리지 않고 차트가 씁니다 */
  series: { date: string; close: number }[];
};

const iso = (basDt: string) => `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6, 8)}`;
const compact = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const round = (x: number, d: number) => Number(x.toFixed(d));

/** 응답에서 그 지수의 줄만 날짜 오름차순으로. 형식이 다르거나 오류 코드면 throw 합니다. */
export function rowsOf(json: ApiResponse, index: KrIndexName): { date: string; close: number; change: number; changePct: number }[] {
  const header = json.response?.header;
  if (!header) throw new Error(`지수시세 API 응답 형식이 예상과 다릅니다: ${JSON.stringify(json).slice(0, 200)}`);
  if (header.resultCode !== "00") throw new Error(`지수시세 API 오류 ${header.resultCode}: ${header.resultMsg}`);
  const items = json.response?.body?.items;
  const item = items && typeof items === "object" ? items.item : undefined;
  const rows = (Array.isArray(item) ? item : item ? [item] : []).filter((r) => r.idxNm === index);
  return rows
    .map((r) => ({ date: iso(r.basDt), close: Number(r.clpr), change: Number(r.vs), changePct: Number(r.fltRt) }))
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 최신 거래일과, 그보다 days 일 전 이하인 가장 가까운 거래일을 비교합니다. */
export function toResult(index: KrIndexName, days: number, rows: ReturnType<typeof rowsOf>): ToolResult<KrIndexData> {
  const latest = rows.at(-1);
  if (!latest) throw new Error(`${index} 지수 시세가 없습니다.`);
  const target = new Date(Date.parse(`${latest.date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const from = [...rows].reverse().find((r) => r.date <= target);
  if (!from) throw new Error(`${index} 지수의 ${days}일 전 시세가 없습니다 (가장 이른 자료 ${rows[0]!.date}).`);
  return {
    data: {
      index,
      latest,
      period: {
        from: from.date,
        to: latest.date,
        closeFrom: from.close,
        change: round(latest.close - from.close, 2),
        returnPct: round((latest.close / from.close - 1) * 100, 2),
      },
      series: rows.filter((r) => r.date >= from.date).map((r) => ({ date: r.date, close: r.close })),
    },
    source: { name: SOURCE_NAME, url: SOURCE_URL, asOf: latest.date },
    note: "다음 영업일에 공개되는 자료라 최신 값은 직전 영업일 종가입니다. 장중 · 당일 값은 들어 있지 않습니다. 지수 값의 단위는 포인트입니다.",
  };
}

export async function execute({ index, days }: Input): Promise<ToolResult<KrIndexData>> {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error("DATA_GO_KR_KEY 가 설정되지 않았습니다 (.env.local 확인)");
  // 공공데이터포털 Encoding 키(이미 % 인코딩됨)는 그대로, Decoding 키는 인코딩해서 보냅니다.
  const serviceKey = key.includes("%") ? key : encodeURIComponent(key);
  const now = new Date();
  const qs = new URLSearchParams({
    resultType: "json",
    numOfRows: "400",
    pageNo: "1",
    idxNm: index,
    beginBasDt: compact(new Date(now.getTime() - (days + BUFFER_DAYS) * 86_400_000)),
    endBasDt: compact(new Date(now.getTime() + 86_400_000)),
  });
  const json = await fetchJson<ApiResponse>(`${ENDPOINT}?serviceKey=${serviceKey}&${qs}`, { timeoutMs: 8_000 });
  return toResult(index, days, rowsOf(json, index));
}

/** 장부에 올릴 값. 키의 접미사(Pct · From)는 검증기가 단위와 비교 시점을 읽는 데 씁니다. */
export function evidenceOf(data: KrIndexData): EvidenceValues {
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

export const krIndexTool = defineTool({
  name: "get_kr_stock_index",
  description:
    "국내 주가지수(코스피 · 코스닥 · 코스피 200 · 코스닥 150)의 최신 종가와 전일 대비, 지정 기간 변화를 조회한다. " +
    "다음 영업일에 공개되는 자료라 최신 값은 직전 영업일 종가다. 당일 · 장중 값과 개별 종목 시세는 제공하지 않는다.",
  parameters,
  execute,
  evidence: evidenceOf,
});
