/**
 * "돈값이 떨어졌다" 같은 돈의 가치 질문 (리더, 11/22).
 *
 * 11/21 점검: "요즘 돈값이 떨어졌다는데 무슨 말이야?" 에 뜻 두 가지(국내 구매력 · 달러 대비 가치)는 잘 구분했지만, 조사가 환율만 받아
 * "국내 물가 자료가 없어 구매력이 얼마나 줄었는지는 확인하지 못했어요" 라고 답했습니다. 물가 tool 이 있으므로 코드가 두 자료를 다 채웁니다.
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import type { Evidence } from "./schema";
import type { InvokableTool } from "./supplement";

/** 돈의 가치를 묻는 질문인지 */
export function isMoneyValueQuestion(question: string): boolean {
  // 다른 나라 · 다른 통화의 구매력을 묻는 질문은 대상이 아닙니다. 한국 물가와 원/달러 환율을 끼워 넣으면 묻지 않은 나라로 답하게 됩니다 (#135 Codex 리뷰)
  if (/미국|일본|중국|유럽|유로존|해외|엔화|유로|위안|달러\s*(의\s*)?(가치|구매력|값)/.test(question)) return false;
  return /돈\s*값|돈의\s*가치|화폐\s*가치|원화\s*가치|구매력/.test(question);
}

const krCpi = (evidence: Evidence[]) => evidence.find((e) => e.tool === areaTools.macro && e.values.indicator === "cpi" && e.values.country === "KR" && typeof e.values["latest.previousYear.change"] === "number");
const usdFx = (evidence: Evidence[]) => evidence.find((e) => e.tool === areaTools.fx && e.values.pair === "USD/KRW" && typeof e.values.changePct === "number");

/** 돈의 가치 질문이면 한국 물가와 원/달러 환율 중 없는 것을 채웁니다. 대상이 아니면 부르지 않고, 실패해도 이어 갑니다 */
export async function ensureMoneyValue(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<boolean> {
  if (!isMoneyValueQuestion(question)) return false;
  const macro = tools.find((t) => t.name === areaTools.macro);
  const fx = tools.find((t) => t.name === areaTools.fx);
  const rc = new RunContext(ctx);
  await Promise.all([
    macro && !krCpi(ctx.evidence) ? macro.invoke(rc, JSON.stringify({ country: "KR", indicator: "cpi", endMonth: null, months: 1 })).catch(() => undefined) : undefined,
    fx && !usdFx(ctx.evidence) ? fx.invoke(rc, JSON.stringify({ currency: "USD", days: 30 })).catch(() => undefined) : undefined,
  ]);
  return true;
}

/** 두 자료의 장부 항목 (있는 것만) */
export function moneyValueRows(evidence: Evidence[]): Evidence[] {
  return [krCpi(evidence), usdFx(evidence)].filter((e): e is Evidence => !!e);
}

/** 작성 입력에 붙이는 [돈의 가치] */
export function moneyValueNote(evidence: Evidence[]): string {
  const cpi = krCpi(evidence);
  const fx = usdFx(evidence);
  if (!cpi && !fx) return "";
  const month = (m: unknown) => `${String(m).slice(0, 4)}-${String(m).slice(4, 6)}`;
  return [
    `[돈의 가치] "돈값" 은 두 가지 뜻으로 씁니다. 두 뜻을 먼저 구분해 설명하고, 각각 아래 값으로 답합니다.`,
    cpi ? `- 국내에서의 구매력(같은 돈으로 살 수 있는 양): 소비자물가가 1년 전보다 ${Number(cpi.values["latest.previousYear.change"]).toFixed(2)}% 올랐습니다 (${month(cpi.values["latest.month"])}, ref ${cpi.id}). 물가가 오른 만큼 같은 돈으로 살 수 있는 양이 줄어든 것입니다.` : "",
    fx ? `- 다른 나라 돈과 비교한 가치: 원/달러 환율이 ${fx.values["comparison.asOf"]} 보다 ${Number(fx.values.changePct) > 0 ? "+" : ""}${Number(fx.values.changePct).toFixed(2)}% 움직였습니다 (ref ${fx.id}). 환율이 오르면 달러와 비교한 원화의 가치가 낮아진 것입니다.` : "",
    `생활 예시를 하나 듭니다 (예: 작년에 만 원으로 사던 것을 올해는 조금 덜 살 수 있다). 예시에 새 숫자를 계산해 넣지 않습니다.`,
    `"물가 자료가 없어 확인하지 못했다" 고 쓰지 않습니다.`,
  ].filter(Boolean).join("\n");
}
