/**
 * 정책금리의 긴 기간 비교 (리더, 11/21).
 *
 * 11/20 베타: "금리 내려가는 추세야?" 에 "최근 30일 동안 내리지 않았지만 더 긴 기간은 확인하기 어렵습니다", 다른 사람은 "기준금리 3, 비교값 3? 한 달을
 * 비교하면 당연히 안 맞음". 정책금리는 몇 달에 한 번 바뀌어 30일 비교는 거의 늘 "변동 없음" 입니다. 조사가 받은 정책금리의 변화가 0 이면
 * 코드가 같은 지표를 365일로 한 번 더 받아 장부에 올리고, 작성에 [금리 긴 기간] 으로 알려 줍니다. 금리 tool 은 건드리지 않습니다.
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import type { Evidence } from "./schema";
import type { InvokableTool } from "./supplement";

/** 긴 기간으로 다시 보는 정책금리. 장부의 indicator 이름 → 금리 tool 의 series (시장금리 DGS10 은 매일 움직여 대상이 아님) */
const POLICY_SERIES: Record<string, string> = { "한국은행 기준금리": "BOK", "미국 실효 연방기금금리": "DFF" };
export const LONG_DAYS = 365;

const isRate = (e: Evidence) => e.tool === areaTools.rate && typeof e.values.indicator === "string" && e.values.indicator in POLICY_SERIES;
const daysOf = (e: Evidence) => Number(e.values.requestedDays);

/** 추세 · 흐름을 묻는 질문인지. 이런 질문은 짧은 기간에 변화가 있었어도 1년 전과 비교해야 답이 됩니다 ("금리 내려가는 추세야?") */
export function isTrendQuestion(question: string): boolean {
  return /추세|흐름|추이|계속|내려가|올라가|내리고|오르고|인하|인상/.test(question);
}

/** 짧은 기간 정책금리 중 365일 결과가 아직 없는 지표. 기본은 변화가 0 인 것만, any 면 전부 */
export function flatPolicyRates(evidence: Evidence[], any = false): string[] {
  const long = new Set(evidence.filter((e) => isRate(e) && daysOf(e) === LONG_DAYS).map((e) => String(e.values.indicator)));
  const flat = evidence.filter((e) => isRate(e) && daysOf(e) < LONG_DAYS && (any || e.values.changePp === 0)).map((e) => String(e.values.indicator));
  return [...new Set(flat)].filter((indicator) => !long.has(indicator));
}

/** 변화가 0 인 정책금리(추세를 묻는 질문이면 전부)를 365일로 한 번 더 받습니다. 금리 tool 이 없거나 대상이 없으면 부르지 않고, 실패해도 리포트는 이어집니다 (error step 만 남음) */
export async function ensureRateYear(ctx: ResearchContext, tools: readonly InvokableTool[], question = ""): Promise<string[]> {
  const rate = tools.find((t) => t.name === areaTools.rate);
  const targets = rate ? flatPolicyRates(ctx.evidence, isTrendQuestion(question)) : [];
  if (!rate || targets.length === 0) return [];
  const rc = new RunContext(ctx);
  await Promise.all(targets.map((indicator) => rate.invoke(rc, JSON.stringify({ series: POLICY_SERIES[indicator], days: LONG_DAYS })).catch(() => undefined)));
  return targets;
}

/** 장부의 365일 정책금리 항목 (짧은 기간 결과가 같이 있는 지표만: 조사가 처음부터 365일로 받은 것은 평소대로 쓰입니다) */
export function yearRates(evidence: Evidence[]): Evidence[] {
  const short = new Set(evidence.filter((e) => isRate(e) && daysOf(e) < LONG_DAYS).map((e) => String(e.values.indicator)));
  return evidence.filter((e) => isRate(e) && daysOf(e) === LONG_DAYS && short.has(String(e.values.indicator)));
}

const pp = (n: number) => (n === 0 ? "변동 없음" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%p`);

/** 작성 입력에 붙이는 [금리 긴 기간]. 정제가 뺐더라도 볼 수 있게 값을 직접 적습니다 (검증은 장부 전체로 대조) */
export function rateYearNote(evidence: Evidence[]): string {
  const rows = yearRates(evidence);
  if (rows.length === 0) return "";
  return [
    `[금리 긴 기간] 정책금리는 몇 달에 한 번 바뀌어 짧은 기간 비교는 대부분 "변동 없음" 입니다. 그래서 1년 전과도 비교했습니다.`,
    ...rows.map((e) => `- ${e.values.indicator} (ref ${e.id}): ${e.values.comparisonDate} ${e.values.comparisonRate}% → ${e.values.asOf} ${e.values.rate}%, 1년 변화 ${pp(Number(e.values.changePp))}`),
    `금리의 추세 · 흐름 · 오르내림을 답할 때는 이 1년 비교를 먼저 쓰고, 짧은 기간의 "변동 없음" 은 덧붙입니다. "더 긴 기간은 확인하기 어렵다" 고 쓰지 않습니다.`,
    `1년 사이 언제 몇 번 바뀌었는지는 이 자료에 없으므로 쓰지 않습니다.`,
  ].join("\n");
}
