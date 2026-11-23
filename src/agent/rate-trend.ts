/**
 * 정책금리의 긴 기간 비교 (리더, 11/21).
 *
 * 11/20 베타: "금리 내려가는 추세야?" 에 "최근 30일 동안 내리지 않았지만 더 긴 기간은 확인하기 어렵습니다", 다른 사람은 "기준금리 3, 비교값 3? 한 달을
 * 비교하면 당연히 안 맞음". 정책금리는 몇 달에 한 번 바뀌어 30일 비교는 거의 늘 "변동 없음" 입니다. 조사가 받은 정책금리의 변화가 0 이면
 * 코드가 같은 지표를 365일로 한 번 더 받아 장부에 올리고, 작성에 [금리 긴 기간] 으로 알려 줍니다. 금리 tool 은 건드리지 않습니다.
 * 나라를 말하지 않은 정책금리 질문이면 미국 정책금리 1년 비교도 참고 카드로 붙입니다 (아래 "다른 나라 금리 참고", 11/23).
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import { namesCountry } from "./relation";
import type { Evidence, WriterOutput } from "./schema";
import type { InvokableTool } from "./supplement";

/** 긴 기간으로 다시 보는 정책금리. 장부의 indicator 이름 → 금리 tool 의 series (시장금리 DGS10 은 매일 움직여 대상이 아님) */
const POLICY_SERIES: Record<string, string> = { "한국은행 기준금리": "BOK", "미국 실효 연방기금금리": "DFF" };
export const LONG_DAYS = 365;

const isRate = (e: Evidence) => e.tool === areaTools.rate && typeof e.values.indicator === "string" && e.values.indicator in POLICY_SERIES;
const daysOf = (e: Evidence) => Number(e.values.requestedDays);

/** 금리가 주제인 질문인지 */
export function isRateQuestion(question: string): boolean {
  return /금리|기준금리|연준|금통위/.test(question) && !/환율|달러|엔화|유로/.test(question);
}

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
  // 금리를 묻는 질문일 때만 합니다. 환율 원인 질문이 보조로 받은 금리까지 1년 비교를 붙이면 질문과 무관한 조회 · 안내가 늘어납니다 (11/21 재실행에서 확인)
  if (!isRateQuestion(question)) return [];
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

const pp = (n: number) => (Math.abs(n) < 0.005 ? "변동 없음" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%p`);

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

// ── 다른 나라 금리 참고 (베타 B2, 11/23) ─────────────────────────────────────
// 11/20 베타 5번: "금리 내려가는 추세야?" 에 한국 기준금리만 답하자 "한국 금리만 있는 게 아닐 텐데". 나라를 말하지 않은 정책금리 질문이면
// 미국 정책금리의 1년 비교를 참고로 하나 더 받아 카드로 붙입니다. 답은 한국 기준금리로 하고, 미국 금리는 한 문장 · 카드 하나만 씁니다.

const KR_POLICY = "한국은행 기준금리";
const US_POLICY = "미국 실효 연방기금금리";
/** 정책금리가 아닌 금리를 묻는 질문 (예적금 · 대출 · 채권 · 시장금리). 이런 질문에 미국 정책금리를 붙이면 질문과 멀어집니다 */
const NOT_POLICY = /예금|적금|대출|주담대|주택\s*담보|코픽스|COFIX|채권|국채|국고채|회사채|시장\s*금리|CD\s*금리|모기지/i;

/**
 * 나라를 말하지 않은 정책금리 질문이면 미국 정책금리를 365일로 받습니다. 받은 항목 id, 대상이 아니면 null.
 * 한국 기준금리로 답하는 리포트에만 붙이고(장부에 한국 기준금리가 있을 때), 조사가 미국 정책금리를 이미 받았으면 평소대로 둡니다.
 * 금통위는 한국을 말한 것으로 봅니다. 실패해도 리포트는 이어집니다 (error step 만 남음)
 */
export async function ensureRateReference(ctx: ResearchContext, tools: readonly InvokableTool[], question: string): Promise<string | null> {
  if (!isRateQuestion(question) || NOT_POLICY.test(question) || namesCountry(question) || /금통위/.test(question)) return null;
  if (!ctx.evidence.some((e) => isRate(e) && e.values.indicator === KR_POLICY)) return null;
  if (ctx.evidence.some((e) => isRate(e) && e.values.indicator === US_POLICY)) return null;
  const rate = tools.find((t) => t.name === areaTools.rate);
  if (!rate) return null;
  await rate.invoke(new RunContext(ctx), JSON.stringify({ series: POLICY_SERIES[US_POLICY], days: LONG_DAYS })).catch(() => undefined);
  return referenceRate(ctx.evidence)?.id ?? null;
}

function referenceRate(evidence: Evidence[], id?: string): Evidence | undefined {
  return evidence.find((e) => (id ? e.id === id : true) && isRate(e) && e.values.indicator === US_POLICY && daysOf(e) === LONG_DAYS && typeof e.values.rate === "number" && typeof e.values.changePp === "number");
}

/** 미국 금리가 한국보다 높은 폭이 1년 사이 어떻게 됐는지 (숫자는 쓰지 않음: 장부에 없는 값). 한국 기준금리의 1년 비교가 있을 때만 */
function gapLine(us: Evidence, evidence: Evidence[]): string {
  const kr = evidence.find((e) => isRate(e) && e.values.indicator === KR_POLICY && daysOf(e) === LONG_DAYS);
  if (!kr) return "";
  const now = Number(us.values.rate) - Number(kr.values.rate);
  const before = Number(us.values.comparisonRate) - Number(kr.values.comparisonRate);
  if (![now, before].every(Number.isFinite)) return "";
  if (now !== 0 && before !== 0 && Math.sign(now) !== Math.sign(before)) return `- 두 나라 금리의 높고 낮음이 1년 사이 바뀌었습니다 (지금은 ${now > 0 ? "미국" : "한국"} 금리가 더 높습니다).`;
  const [hi, lo] = now >= 0 ? ["미국", "한국"] : ["한국", "미국"];
  const way = Math.abs(Math.abs(now) - Math.abs(before)) < 0.005 ? "그대로입니다" : Math.abs(now) > Math.abs(before) ? "벌어졌습니다" : "좁혀졌습니다";
  return `- ${hi} 금리가 ${lo}보다 높은 폭은 1년 사이 ${way}. 이 폭을 숫자로 쓰려면 장부의 계산 항목(C 번호)이 있을 때만 씁니다.`;
}

/** 작성 입력에 붙이는 [다른 나라 금리 참고] */
export function rateReferenceNote(evidence: Evidence[], id: string | null): string {
  const us = id ? referenceRate(evidence, id) : undefined;
  if (!us) return "";
  const v = us.values;
  return [
    `[다른 나라 금리 참고] 질문이 나라를 정하지 않아, 한국 기준금리와 함께 미국 정책금리의 1년 비교도 참고로 받았습니다.`,
    `- ${v.indicator} (ref ${us.id}): ${v.comparisonDate} ${v.comparisonRate}% → ${v.asOf} ${v.rate}%, 1년 변화 ${pp(Number(v.changePp))}`,
    gapLine(us, evidence),
    `한 줄 요약과 요약의 첫 문장은 한국 기준금리로 답합니다. 미국 금리는 요약 끝에 참고로 한 문장만 쓰고(한국과 같은 방향인지 반대인지), 원인(why) 칸에는 넣지 않습니다.`,
    `미국 금리 카드는 코드가 넣으므로 쓰지 않아도 됩니다. 미국 금리를 받은 것을 주의점 · 확인하지 못한 것에 적지 않습니다.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 미국 정책금리 참고 카드를 "오늘의 숫자" 맨 뒤에 넣습니다 (한국 기준금리 카드가 먼저). 작성이 같은 항목으로 쓴 카드는 이 카드로 바꿉니다. 값은 장부 그대로라 검증을 통과합니다 */
export function withRateReference(output: WriterOutput, evidence: Evidence[], id: string | null): WriterOutput {
  const us = id ? referenceRate(evidence, id) : undefined;
  if (!us) return output;
  const v = us.values;
  const card = { label: `${v.indicator} (참고)`, value: `${v.rate}%`, change: `1년 ${pp(Number(v.changePp))}`, asOf: String(v.asOf), ref: us.id };
  return { ...output, numbers: [...output.numbers.filter((n) => n.ref !== us.id), card] };
}
