import { z } from "zod";

import { defineTool } from "../define";
import { fetchJson } from "../../lib/http";
import type { ToolResult } from "../types";

const API_BASE_URL = "https://api.frankfurter.dev/v2/rates";
const QUOTE_CURRENCY = "KRW";

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

export type Input = z.infer<typeof parameters>;

/** ToolResult.data에 담기는 JSON 직렬화 가능 응답 형식입니다. */
export type FxResultData = {
  pair: string;
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
  url.searchParams.set("from", subtractDays(to, days));
  url.searchParams.set("to", to);
  return url.toString();
}

function validateRates(rates: FxRate[], currency: Input["currency"]): FxRate[] {
  if (!Array.isArray(rates) || rates.length < 2) {
    throw new Error("비교할 환율 데이터가 충분하지 않습니다.");
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

export async function execute({ currency, days }: Input): Promise<ToolResult<FxResultData>> {
  const sourceUrl = buildSourceUrl(currency, days);
  const rates = validateRates(await fetchJson<FxRate[]>(sourceUrl), currency);
  const comparison = rates[0];
  const latest = rates[rates.length - 1];
  const change = latest.rate - comparison.rate;
  const changePct = (change / comparison.rate) * 100;

  const result: ToolResult<FxResultData> = {
    data: {
      pair: `${currency}/${QUOTE_CURRENCY}`,
      rate: latest.rate,
      asOf: latest.date,
      comparison: {
        rate: comparison.rate,
        asOf: comparison.date,
      },
      change: round(change, 6),
      changePct: round(changePct, 2),
    },
    source: {
      name: "Frankfurter v2",
      url: sourceUrl,
      asOf: latest.date,
    },
    note: "일별 mid-market 기준환율입니다. 실시간 매수·매도 호가가 아니며, 변동값은 조회 구간에서 API가 반환한 최초·최신 데이터의 차이입니다.",
  };

  return result;
}

export const fxTool = defineTool({
  name: "get_fx_krw_rate",
  description:
    "USD, EUR, JPY와 KRW의 최신 기준환율 및 지정 기간 변동률을 조회합니다. 실시간 매수·매도 호가나 환전 추천이 필요할 때는 사용할 수 없습니다.",
  parameters,
  execute,
});
