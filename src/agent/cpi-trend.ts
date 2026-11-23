/**
 * 물가 질문의 1년 상승률 선 (리더, 11/23). 화면 #149 가 월별 % 선을 그립니다 (점 12개면 "1년간").
 *
 * 물가 tool 을 12개월로 한 번 불러, 달마다 tool 이 계산한 전년 같은 달 대비 상승률로 선을 만듭니다. 모델이 만든 숫자는 쓰지 않습니다.
 * 같은 나라 물가 항목이 장부에 이미 있으면 이 12개월 항목은 작성에게 보이지 않게 합니다 (같은 최신 값이 두 번 보이지 않게). 검증은 장부 전체로 합니다.
 * 관계 질문(relation.ts 가 1년 전 · 지금 상승률 카드를 넣음)과, 기간을 정한 질문은 대상이 아닙니다.
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import { questionNodes, relationPlan } from "./relation";
import type { Chart, Evidence } from "./schema";
import type { InvokableTool } from "./supplement";

export const TREND_MONTHS = 12;
type Country = "KR" | "US";

/** 선을 그릴 물가의 나라. 질문이 물가를 말했을 때만 (관계 질문 · 기간을 정한 질문 제외) */
export function cpiTrendCountry(question: string): Country | null {
  if (relationPlan(question)) return null;
  const node = questionNodes(question)?.nodes.find((n) => n.kind === "cpi");
  return node && node.kind === "cpi" ? node.country : null;
}

const isCpi = (e: Evidence, country: Country) => e.tool === areaTools.macro && e.values.indicator === "cpi" && e.values.country === country;
type Observation = { month?: unknown; previousYear?: { change?: unknown } };
const observations = (raw: unknown): Observation[] => {
  const list = (raw as { observations?: unknown } | undefined)?.observations;
  return Array.isArray(list) ? (list as Observation[]) : [];
};

/** 달별 전년 같은 달 대비 상승률 (값이 없는 달은 뺌). t 는 "2025-11" */
export function trendPoints(raw: unknown): { t: string; v: number }[] {
  return observations(raw)
    .filter((o) => typeof o.month === "string" && /^\d{6}$/.test(o.month) && typeof o.previousYear?.change === "number")
    .map((o) => ({ t: `${(o.month as string).slice(0, 4)}-${(o.month as string).slice(4, 6)}`, v: o.previousYear!.change as number }));
}

/** 12개월 물가 항목 (tool 의 전체 응답 raw 에 달이 12개 이상) */
function trendItem(ctx: Pick<ResearchContext, "evidence" | "raw">, country: Country): Evidence | undefined {
  return ctx.evidence.find((e) => isCpi(e, country) && observations(ctx.raw.get(e.id)).length >= TREND_MONTHS);
}

/** 12개월 물가 항목이 없으면 받습니다. 받은(또는 있던) 항목 id, 대상이 아니거나 받지 못하면 null. 실패해도 throw 하지 않습니다 */
export async function ensureCpiTrend(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<string | null> {
  const country = cpiTrendCountry(question);
  if (!country) return null;
  if (!trendItem(ctx, country)) {
    const macro = tools.find((t) => t.name === areaTools.macro);
    if (!macro) return null;
    await macro.invoke(new RunContext(ctx), JSON.stringify({ country, indicator: "cpi", endMonth: null, months: TREND_MONTHS })).catch(() => undefined);
  }
  return trendItem(ctx, country)?.id ?? null;
}

/** 작성에게 숨길 항목: 같은 나라 물가 항목이 따로 있으면 12개월 항목. 그것뿐이면 숨기지 않습니다 */
export function cpiTrendHidden(evidence: Evidence[], id: string): Set<string> {
  const item = evidence.find((e) => e.id === id);
  if (!item) return new Set();
  const country = item.values.country as Country;
  return evidence.some((e) => e.id !== id && isCpi(e, country)) ? new Set([id]) : new Set();
}

/** 월별 전년 같은 달 대비 상승률 선. 점이 셋 미만이면 null */
export function cpiChart(item: Evidence, raw: unknown): Chart | null {
  const points = trendPoints(raw);
  if (points.length < 3) return null;
  const name = item.values.country === "US" ? "미국" : "한국";
  return {
    kind: "line",
    title: `${name} 소비자물가 상승률 (전년 같은 달 대비)`,
    unit: "%",
    series: [{ label: `${name} 소비자물가 상승률`, ref: item.id, points }],
  };
}
