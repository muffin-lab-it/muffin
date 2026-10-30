/**
 * 국내 ETF 시세 tool. 금융위원회 증권상품시세정보(공공데이터포털, 원천 KRX) V2 를 씁니다.
 *
 * 한 번 호출로 최신 영업일 시세(종가·NAV·괴리율·순자산·기초지수)와
 * 최근 N일 기간 변화(수익률·고저·기초지수 대비 추적 차이)를 돌려줍니다.
 */
import { z } from "zod";
import { fetchJson } from "../../lib/http";
import { defineTool, type EvidenceValues } from "../define";
import type { ToolResult } from "../types";

export const parameters = z.object({
  query: z
    .string()
    .min(1)
    .describe('ETF 이름(운용사명+공백+상품명, 예: "KODEX 200", "TIGER 미국S&P500") 또는 6자리 종목코드(예: "069500")'),
  days: z.number().int().min(1).max(365).describe("기간 변화를 볼 일수(달력 기준). 예: 한 달이면 30"),
});

export type Input = z.infer<typeof parameters>;

// 오퍼레이션 이름에도 _V2 가 붙습니다. 빼면 NO_OPENAPI_SERVICE_ERROR 가 납니다.
const ENDPOINT = "https://apis.data.go.kr/1160100/GetSecuritiesProductInfoService_V2/getETFPriceInfo_V2";
const SOURCE_NAME = "금융위원회 증권상품시세정보 (공공데이터포털, 원천 KRX)";
const SOURCE_URL = "https://www.data.go.kr/data/15094806/openapi.do";

/** T+1 공개라 요청 기간보다 넉넉히 받아 둡니다. */
const BUFFER_DAYS = 7;
/** 부분 일치 후보를 찾을 때 보는 기간 */
const CANDIDATE_DAYS = 10;
const MAX_CANDIDATES_SHOWN = 10;

/** API 원본 행. 숫자도 전부 문자열로 옵니다. */
type EtfRow = {
  basDt: string;
  srtnCd: string;
  isinCd: string;
  itmsNm: string;
  clpr: string;
  vs: string;
  fltRt: string;
  nav: string;
  mkp: string;
  hipr: string;
  lopr: string;
  trqu: string;
  trPrc: string;
  mrktTotAmt: string;
  nPptTotAmt: string;
  stLstgCnt: string;
  bssIdxIdxNm: string;
  bssIdxClpr: string;
};

type ApiResponse = {
  response?: {
    header: { resultCode: string; resultMsg: string };
    body?: { totalCount: number; items?: { item?: EtfRow[] | EtfRow } | "" };
  };
};

export async function execute({ query, days }: Input): Promise<ToolResult<EtfData>> {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error("DATA_GO_KR_KEY 가 설정되지 않았습니다 (.env.local 확인)");

  const q = query.trim();
  const today = todayKst();
  const range = { beginBasDt: shiftDays(today, -(days + BUFFER_DAYS)), endBasDt: shiftDays(today, 0) };

  let rows: EtfRow[];
  if (/^\d[0-9A-Z]{5}$/.test(q)) {
    rows = await fetchRows(key, { likeSrtnCd: q, ...range });
    if (rows.length === 0) throw new Error(`종목코드 ${q} 인 국내 ETF 를 찾지 못했습니다.`);
  } else {
    rows = await fetchRows(key, { itmsNm: q, ...range });
    if (rows.length === 0) {
      const code = await findUniqueCode(key, q, today);
      rows = await fetchRows(key, { likeSrtnCd: code, ...range });
    }
  }

  return toResult(rows, days);
}

/** 이름 부분 일치로 후보를 찾고, 하나로 좁혀지지 않으면 후보 목록을 담아 실패합니다. */
async function findUniqueCode(key: string, name: string, today: string): Promise<string> {
  const rows = await fetchRows(key, {
    likeItmsNm: name,
    beginBasDt: shiftDays(today, -CANDIDATE_DAYS),
    endBasDt: shiftDays(today, 0),
  });
  const candidates = new Map(rows.map((r) => [r.srtnCd, r.itmsNm]));

  if (candidates.size === 1) return [...candidates.keys()][0];
  if (candidates.size === 0) {
    throw new Error(
      `"${name}" 에 해당하는 국내 ETF 를 찾지 못했습니다. 운용사명+공백+상품명(예: "KODEX 200") 이나 6자리 종목코드로 다시 조회하세요.`,
    );
  }
  const list = [...candidates].map(([code, nm]) => `${nm}(${code})`);
  const shown = list.slice(0, MAX_CANDIDATES_SHOWN).join(", ");
  const more = list.length > MAX_CANDIDATES_SHOWN ? ` 외 ${list.length - MAX_CANDIDATES_SHOWN}개` : "";
  throw new Error(
    `"${name}" 와 이름이 비슷한 ETF 가 ${list.length}개입니다. 정확한 이름이나 종목코드로 다시 조회하세요. 후보: ${shown}${more}`,
  );
}

async function fetchRows(key: string, params: Record<string, string>): Promise<EtfRow[]> {
  // 공공데이터포털 Encoding 키(이미 % 인코딩됨)는 그대로, Decoding 키는 인코딩해서 보냅니다.
  const serviceKey = key.includes("%") ? key : encodeURIComponent(key);
  const qs = new URLSearchParams({ resultType: "json", numOfRows: "1000", pageNo: "1", ...params });
  let json: ApiResponse;
  try {
    json = await fetchJson<ApiResponse>(`${ENDPOINT}?serviceKey=${serviceKey}&${qs}`);
  } catch (err) {
    // 공통 HttpError 메시지에는 요청 URL 이 통째로 들어가서, 쿼리로 보내는 키가 노출됩니다.
    // 삼키지 않고 키만 가린 메시지로 다시 던집니다.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.replace(/serviceKey=[^&\s]*/g, "serviceKey=****"));
  }

  const header = json.response?.header;
  if (!header) throw new Error(`금융위 API 응답 형식이 예상과 다릅니다: ${JSON.stringify(json).slice(0, 200)}`);
  if (header.resultCode !== "00") throw new Error(`금융위 API 오류 ${header.resultCode}: ${header.resultMsg}`);

  const items = json.response?.body?.items;
  const item = items && typeof items === "object" ? items.item : undefined;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * tool 이 돌려주는 data. 숫자는 API 값과 그 값으로 바로 나눈 결과를 반올림 없이 그대로 둡니다.
 * 키 이름의 단위 접미사(Pct · Pp)와 비교 시점 접미사(From)는 검증기가 단위와 역할을 판단하는 데 씁니다.
 */
export type EtfData = {
  etf: { code: string; isin: string; name: string; baseIndex: string };
  latest: {
    date: string;
    close: number | null;
    change: number | null;
    changePct: number | null;
    nav: number | null;
    /** 괴리율 (종가 - NAV) / NAV × 100 */
    premiumPct: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    tradeValue: number | null;
    netAssets: number | null;
    listedShares: number | null;
    indexClose: number | null;
  };
  period: {
    from: string;
    to: string;
    tradingDays: number;
    /** 기간 시작일(from) 종가 · 기초지수 종가 */
    closeFrom: number | null;
    indexCloseFrom: number | null;
    returnPct: number | null;
    high: number;
    low: number;
    indexReturnPct: number | null;
    /** ETF 수익률 - 기초지수 수익률 (%p) */
    trackingDiffPp: number | null;
  };
};

function toResult(allRows: EtfRow[], days: number): ToolResult<EtfData> {
  const sorted = [...allRows].sort((a, b) => a.basDt.localeCompare(b.basDt));
  const last = sorted[sorted.length - 1];
  // 같은 조회에 다른 종목이 섞여 오지 않도록 최신 행의 종목코드로 한 번 더 거릅니다.
  const rows = sorted.filter((r) => r.srtnCd === last.srtnCd);

  const latestDate = toIsoDate(last.basDt);
  const fromBasDt = shiftDays(latestDate, -days).replaceAll("-", "");
  const period = rows.filter((r) => r.basDt >= fromBasDt);
  const first = period[0];

  const close = num(last.clpr);
  const nav = num(last.nav);
  const hasBaseline = period.length >= 2;
  const returnPct = hasBaseline ? pctChange(num(first.clpr), close) : null;
  const indexReturnPct = hasBaseline ? pctChange(num(first.bssIdxClpr), num(last.bssIdxClpr)) : null;

  return {
    data: {
      etf: { code: last.srtnCd, isin: last.isinCd, name: last.itmsNm, baseIndex: last.bssIdxIdxNm },
      latest: {
        date: latestDate,
        close,
        change: num(last.vs),
        changePct: num(last.fltRt),
        nav,
        premiumPct: close !== null && nav ? ((close - nav) / nav) * 100 : null,
        open: num(last.mkp),
        high: num(last.hipr),
        low: num(last.lopr),
        volume: num(last.trqu),
        tradeValue: num(last.trPrc),
        netAssets: num(last.nPptTotAmt),
        listedShares: num(last.stLstgCnt),
        indexClose: num(last.bssIdxClpr),
      },
      period: {
        from: toIsoDate(first.basDt),
        to: latestDate,
        tradingDays: period.length,
        closeFrom: hasBaseline ? num(first.clpr) : null,
        indexCloseFrom: hasBaseline ? num(first.bssIdxClpr) : null,
        returnPct,
        high: Math.max(...period.map((r) => num(r.hipr) ?? -Infinity)),
        low: Math.min(...period.map((r) => num(r.lopr) ?? Infinity)),
        indexReturnPct,
        trackingDiffPp: returnPct === null || indexReturnPct === null ? null : returnPct - indexReturnPct,
      },
    },
    source: { name: SOURCE_NAME, url: SOURCE_URL, asOf: latestDate },
    note:
      "T+1 공개 데이터라 최신값은 직전 영업일 종가 기준입니다(다음 영업일 오후 1시 이후 갱신). " +
      "기간 수익률은 분배금을 뺀 가격 기준입니다. 괴리율 = (종가 - NAV) / NAV × 100. 금액 단위는 원입니다. " +
      "해외 지수를 추종하는 ETF 는 기초지수가 현지 통화 기준이라, 환헤지가 없으면 추적 차이에 환율 변동이 섞입니다.",
  };
}

// ---------------------------------------------------------------- 유틸

function num(s: string | undefined): number | null {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return (to / from - 1) * 100;
}

/** 한국 시간 기준 오늘 (YYYY-MM-DD) */
function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/** YYYY-MM-DD 에서 n 일 이동한 날짜를 YYYYMMDD 로 */
function shiftDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

function toIsoDate(basDt: string): string {
  return `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6, 8)}`;
}

/**
 * 증거 장부에 올릴 핵심 값. 리포트의 숫자가 이 값을 인용하고(E1…), 검증기가 대조합니다.
 *  - 종목코드 · ISIN 은 뺍니다. "069500" 이 숫자 69500 으로 읽혀 대조 후보에 섞이기 때문입니다.
 *  - 값이 없는(null) 항목은 뺍니다.
 *  - 키는 data 의 경로 그대로 둡니다. 단위(Pct = %, Pp = %p)와 비교 시점(From) 접미사를 검증기가 읽습니다.
 */
export function evidenceOf(data: EtfData): EvidenceValues {
  const { etf, latest, period } = data;
  const values: Record<string, string | number | null> = {
    name: etf.name,
    baseIndex: etf.baseIndex,
    "latest.date": latest.date,
    "latest.close": latest.close,
    "latest.change": latest.change,
    "latest.changePct": latest.changePct,
    "latest.nav": latest.nav,
    "latest.premiumPct": latest.premiumPct,
    "latest.open": latest.open,
    "latest.high": latest.high,
    "latest.low": latest.low,
    "latest.volume": latest.volume,
    "latest.tradeValue": latest.tradeValue,
    "latest.netAssets": latest.netAssets,
    "latest.indexClose": latest.indexClose,
    "period.from": period.from,
    "period.to": period.to,
    "period.closeFrom": period.closeFrom,
    "period.indexCloseFrom": period.indexCloseFrom,
    "period.returnPct": period.returnPct,
    "period.indexReturnPct": period.indexReturnPct,
    "period.trackingDiffPp": period.trackingDiffPp,
    "period.high": Number.isFinite(period.high) ? period.high : null,
    "period.low": Number.isFinite(period.low) ? period.low : null,
  };
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) as EvidenceValues;
}

export const etfTool = defineTool({
  name: "get_etf_kr_price",
  description:
    "국내 상장 ETF 의 최신 시세(종가·등락률·NAV·괴리율·순자산·기초지수)와 최근 N일 수익률·고저·기초지수 대비 추적 차이를 조회한다. " +
    '특정 ETF 가 요즘 어떤지, 기초지수를 잘 따라가는지 알고 싶을 때 사용. 예: query "KODEX 200", days 30. ' +
    "미국 등 해외 거래소에 상장된 ETF(SPY, QQQ 등)와 보유종목은 제공하지 않음.",
  parameters,
  execute,
  evidence: evidenceOf,
});
