/**
 * Deep Dive 의 긴 기간 비교 (리더, 11/23).
 *
 * 11/19 페르소나 4명 "Deep 인데 얕다", 11/23 운영 Standard · Deep 3쌍 비교: 조사가 부르는 tool 이 Standard 와 똑같아 Deep 은 말투만 다르고,
 * 깊이 규칙의 "배경 1문단" 은 한 번도 나오지 않았으며(요약 칸이 "한입 요약"), 카드는 비교 기준값 · 전월 지수 같은 구성 값으로 늘었습니다.
 * Deep 이면 질문이 말한 지표(환율 · 주가지수 · 물가 · 실업률)를 지난 1년으로도 받아, 짧은 기간 비교와 1년 비교를 함께 보여 줍니다.
 * 관계 질문의 1년 비교(relation.ts)를 그대로 씁니다. 정책금리는 rate-trend.ts 가 Deep 이면 1년을 받으므로 여기서는 받지 않습니다.
 */
import type { ResearchContext } from "./context";
import { ensureRows, questionNodes, relationPlan, relationRows, rowLine, yearCard, type RelationPlan } from "./relation";
import type { Depth, Evidence, WriterOutput } from "./schema";
import type { InvokableTool } from "./supplement";

/** Deep 이고, 관계 질문이 아니고, 질문이 기간을 정하지 않았을 때 1년으로 볼 지표 (최대 2개). 없으면 null */
export function deepPlan(question: string, depth: Depth): RelationPlan | null {
  if (depth !== "deep" || relationPlan(question)) return null;
  const found = questionNodes(question);
  const nodes = (found?.nodes ?? []).filter((n) => n.kind !== "rate").slice(0, 2);
  return nodes.length > 0 ? { nodes, missing: [] } : null;
}

/** 1년 비교 자료 중 없는 것을 받습니다. 대상이 아니면 아무것도 부르지 않고 null. 실패해도 리포트는 이어집니다 */
export async function ensureDeep(ctx: ResearchContext, question: string, depth: Depth, tools: readonly InvokableTool[], indexTools?: { kr: InvokableTool; us: InvokableTool }): Promise<RelationPlan | null> {
  const plan = deepPlan(question, depth);
  if (!plan) return null;
  await ensureRows(ctx, plan, tools, indexTools);
  return relationRows(ctx.evidence, plan).length > 0 ? plan : null;
}

/** 정제가 뺐더라도 작성이 보는 항목 (extra-facts) */
export function deepRefs(evidence: Evidence[], plan: RelationPlan): string[] {
  return [...new Set(relationRows(evidence, plan).flatMap((r) => [r.to.ref, r.from.ref]))];
}

/** 작성 입력에 붙이는 [긴 기간 비교]. 값을 직접 적어 정제가 뺐더라도 작성이 볼 수 있게 합니다 */
export function deepNote(evidence: Evidence[], plan: RelationPlan): string {
  const rows = relationRows(evidence, plan);
  if (rows.length === 0) return "";
  return [
    `[긴 기간 비교] Deep Dive 라 질문의 지표를 지난 1년으로도 받았습니다.`,
    ...rows.map(rowLine),
    `요약에 이 1년 비교를 한 문장 넣고, 짧은 기간(30일 · 전월 등) 변화와 방향이 같은지 다른지 함께 씁니다. 1년 사이 언제 어떻게 움직였는지는 이 자료에 없으므로 쓰지 않습니다.`,
    `1년 비교 카드는 코드가 넣으므로 쓰지 않아도 됩니다.`,
  ].join("\n");
}

/**
 * 1년 비교 카드를 "오늘의 숫자" 뒤에 붙입니다 (작성의 지금 값 · 짧은 기간 카드가 먼저). 환율 · 지수처럼 1년 전용 항목이 따로 있는 지표는
 * 작성이 그 항목으로 쓴 카드를 이 카드로 바꿉니다. 값은 장부 그대로라 검증을 통과합니다.
 */
export function withDeepNumbers(output: WriterOutput, evidence: Evidence[], plan: RelationPlan): WriterOutput {
  const rows = relationRows(evidence, plan);
  if (rows.length === 0) return output;
  const own = new Set(rows.filter((r) => r.node.kind === "fx" || r.node.kind === "stock").map((r) => r.to.ref));
  return { ...output, numbers: [...output.numbers.filter((n) => !(n.ref && own.has(n.ref))), ...rows.map(yearCard)] };
}
