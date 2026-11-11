import { z } from "zod";

import { defineTool } from "../define";
import { fetchJson } from "../../lib/http";
import type { ToolResult } from "../types";

const API_BASE_URL = "https://api.frankfurter.dev/v2/rates";
const ECOS_API_BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch";
const ECOS_STAT_CODE = "731Y001";
const QUOTE_CURRENCY = "KRW";
const COMPARISON_LOOKBACK_DAYS = 14;

const ECOS_ITEMS = {
  USD: "0000001",
  JPY: "0000002",
  EUR: "0000003",
} as const;

export const parameters = z.object({
  currency: z
    .enum(["USD", "EUR", "JPY"])
    .describe("기준 통화입니다. USD, EUR, JPY 중 하나를 입력하세요."),
  days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .describe("환율 변동을 비교할 기간입니다. 1~365일 범위로 입력하세요."),
});

type FxRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

type EcosRow = {
  STAT_CODE: string;
  ITEM_CODE1: string;
  ITEM_NAME1: string;
  UNIT_NAME: string;
  TIME: string;
  DATA_VALUE: string | null;
};

type EcosResponse = {
  StatisticSearch?: { row?: EcosRow[] };
  RESULT?: { CODE?: string; MESSAGE?: string };
};

type RateObservation = { date: string; rate: number };

export type Input = z.infer<typeof parameters>;

/** ToolResult.data에 담기는 JSON 직렬화 가능 응답 형식입니다. */
export type FxResultData = {
  pair: string;
  /** rate와 comparison.rate의 단위. JPY는 국내 관행에 따라 100엔 기준입니다. */
  unit: string;
  rate: number;
  asOf: string;
  comparison: {
    rate: number;
    asOf: string;
  };
  change: number;
  changePct: number;
};

function getKstDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  const year = value("year");
  const month = value("month");
  const day = value("day");

  if (!year || !month || !day) {
    throw new Error("KST 날짜를 계산할 수 없습니다.");
  }

  return `${year}-${month}-${day}`;
}

function subtractDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function buildSourceUrl(currency: Input["currency"], days: number): string {
  const to = getKstDate();
  const url = new URL(API_BASE_URL);
  url.searchParams.set("base", currency.toLowerCase());
  url.searchParams.set("quotes", QUOTE_CURRENCY.toLowerCase());
  // 주말·공휴일 또는 당일 집계 전에도 비교값을 찾을 수 있도록 여유를 둡니다.
  url.searchParams.set("from", subtractDays(to, days + COMPARISON_LOOKBACK_DAYS));
  url.searchParams.set("to", to);
  return url.toString();
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

function buildEcosUrl(currency: Input["currency"], days: number, key: string): string {
  const to = getKstDate();
  const from = subtractDays(to, days + COMPARISON_LOOKBACK_DAYS);
  return [
    ECOS_API_BASE_URL,
    encodeURIComponent(key),
    "json",
    "kr",
    "1",
    "1000",
    ECOS_STAT_CODE,
    "D",
    compactDate(from),
    compactDate(to),
    ECOS_ITEMS[currency],
  ].join("/");
}

function validateRates(rates: FxRate[], currency: Input["currency"]): FxRate[] {
  if (!Array.isArray(rates) || rates.length === 0) {
    throw new Error("환율 데이터가 없습니다.");
  }

  const dates = new Set<string>();
  const validated = rates.map((rate) => {
    if (
      !rate ||
      typeof rate.date !== "string" ||
      rate.base !== currency ||
      rate.quote !== QUOTE_CURRENCY ||
      typeof rate.rate !== "number" ||
      !Number.isFinite(rate.rate) ||
      rate.rate <= 0 ||
      dates.has(rate.date)
    ) {
      throw new Error("Frankfurter 응답 형식이 예상과 다릅니다.");
    }

    dates.add(rate.date);
    return rate;
  });

  return validated.sort((a, b) => a.date.localeCompare(b.date));
}

/** 최신 기준일에서 days일 전 이하인 값 중 가장 최근 값을 고릅니다. */
function comparisonObservation(rates: RateObservation[], days: number): RateObservation {
  const latest = rates.at(-1);
  if (!latest) throw new Error("환율 데이터가 없습니다.");
  const targetDate = subtractDays(latest.date, days);
  const comparison = rates.filter((rate) => rate.date <= targetDate).at(-1);
  if (!comparison) throw new Error("비교 기준일 이전의 환율 데이터가 충분하지 않습니다.");
  return comparison;
}

function validateEcosRates(raw: EcosResponse, currency: Input["currency"]): RateObservation[] {
  if (!raw.StatisticSearch?.row) {
    throw new Error(`ECOS 응답 오류: ${raw.RESULT?.CODE ?? "UNKNOWN"}`);
  }

  const dates = new Set<string>();
  const rates = raw.StatisticSearch.row.map((row) => {
    const value = typeof row.DATA_VALUE === "string" ? Number(row.DATA_VALUE.trim()) : Number.NaN;
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(row.TIME);
    if (
      row.STAT_CODE !== ECOS_STAT_CODE ||
      row.ITEM_CODE1 !== ECOS_ITEMS[currency] ||
      row.UNIT_NAME !== "원" ||
      !match ||
      !Number.isFinite(value) ||
      value <= 0
    ) {
      throw new Error("ECOS 환율 응답 형식이 예상과 다릅니다.");
    }

    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (dates.has(date)) throw new Error("ECOS 환율 응답에 중복 날짜가 있습니다.");
    dates.add(date);
    return { date, rate: value };
  });

  if (!rates.length) throw new Error("ECOS 환율 데이터가 없습니다.");
  return rates.sort((a, b) => a.date.localeCompare(b.date));
}

function resultFromRates(
  currency: Input["currency"],
  days: number,
  rates: RateObservation[],
  source: ToolResult<FxResultData>["source"],
  isEcos = false,
): ToolResult<FxResultData> {
  const latest = rates.at(-1);
  if (!latest) throw new Error("환율 데이터가 없습니다.");
  const comparison = comparisonObservation(rates, days);
  const rate = round(isEcos || currency !== "JPY" ? latest.rate : latest.rate * 100, 6);
  const comparisonValue = round(isEcos || currency !== "JPY" ? comparison.rate : comparison.rate * 100, 6);
  const change = rate - comparisonValue;

  return {
    data: {
      pair: displayPair(currency),
      unit: displayUnit(currency),
      rate,
      asOf: latest.date,
      comparison: { rate: comparisonValue, asOf: comparison.date },
      change: round(change, 6),
      changePct: round((change / comparisonValue) * 100, 2),
    },
    source,
    note: `일별 ${isEcos ? "매매기준" : "mid-market"} 환율입니다. 실시간 매수·매도 호가가 아니며, 변동값은 최신 기준일에서 ${days}일 전 이하인 가장 가까운 데이터와의 차이입니다.${currency === "JPY" ? " JPY는 국내 관행에 따라 100엔 기준으로 표시합니다." : ""}`,
  };
}

async function executeEcos(currency: Input["currency"], days: number, key: string): Promise<ToolResult<FxResultData>> {
  const url = buildEcosUrl(currency, days, key);
  try {
    const rates = validateEcosRates(await fetchJson<EcosResponse>(url), currency);
    const latest = rates.at(-1);
    if (!latest) throw new Error("ECOS 환율 데이터가 없습니다.");
    return resultFromRates(currency, days, rates, {
      name: "한국은행 ECOS — 주요국 통화의 대원화환율",
      url: "https://ecos.bok.or.kr/",
      asOf: latest.date,
    }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ECOS API 요청 실패";
    throw new Error(message.replaceAll(key, "[REDACTED]").replaceAll(encodeURIComponent(key), "[REDACTED]"));
  }
}

function displayPair(currency: Input["currency"]): string {
  return currency === "JPY" ? "JPY(100)/KRW" : `${currency}/${QUOTE_CURRENCY}`;
}

function displayUnit(currency: Input["currency"]): string {
  return currency === "JPY" ? "KRW per 100 JPY" : `KRW per 1 ${currency}`;
}

export async function execute({ currency, days }: Input): Promise<ToolResult<FxResultData>> {
  const sourceUrl = buildSourceUrl(currency, days);
  try {
    const rates = validateRates(await fetchJson<FxRate[]>(sourceUrl), currency);
    const latest = rates[rates.length - 1];
    return resultFromRates(currency, days, rates.map((rate) => ({ date: rate.date, rate: rate.rate })), {
      name: "Frankfurter v2",
      url: sourceUrl,
      asOf: latest.date,
    });
  } catch (frankfurterError) {
    const ecosKey = process.env.ECOS_API_KEY?.trim();
    if (!ecosKey) throw frankfurterError;
    try {
      return await executeEcos(currency, days, ecosKey);
    } catch (ecosError) {
      const message = ecosError instanceof Error ? ecosError.message : "ECOS API 요청 실패";
      throw new Error(`Frankfurter와 ECOS 환율 조회에 모두 실패했습니다: ${message}`);
    }
  }
}

export const fxTool = defineTool({
  name: "get_fx_krw_rate",
  description:
    "USD, EUR, JPY와 KRW의 최신 기준환율 및 지정 기간 변동률을 조회합니다. 실시간 매수·매도 호가나 환전 추천이 필요할 때는 사용할 수 없습니다.",
  parameters,
  execute,
});
