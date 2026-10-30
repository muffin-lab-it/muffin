/**
 * ✂️ 정제 Agent. 담당: @o3ozzvb (은경).
 *
 * 하는 일: 조사가 끝난 뒤, 작성 전에 (1) 장부와 메모에서 질문에 답하는 데 필요한 사실만 고르고 (2) 차이 · 변동률은 계산 tool(calc_metrics)로
 * 만들어 C 번호를 받고 (3) 뺀 항목과 장부로 확인되지 않은 주장을 기록합니다. 작성은 여기서 고른 사실 목록만 봅니다.
 * 검증(verify.ts)과 다른 점: 정제는 "무엇을 쓸까" 를 고르는 모델의 판단이고, 검증은 "쓴 숫자가 장부와 맞나" 를 보는 코드입니다.
 * 정제가 실패하면(출력 없음 · 예외) 작성은 장부 전체를 봅니다. 그래서 정제가 비어도 리포트는 나옵니다.
 *
 * 이 파일에서 고치는 것: editRules(고르는 기준 · 계산을 부르는 기준 · 예시) · editInput(모델이 받는 입력) · 테스트(edit.test.ts).
 * 출력 모양(factsSchema) · 계산 tool(src/tools/calc) · 호출 순서(muffin.ts)는 리더가 관리합니다. 계산 tool 사용법은 src/tools/calc/README.md.
 * 점수는 `pnpm eval` 에서 작성 결과의 "숫자 ✓/C/제거" 와 "why 📊" 입니다 (정제가 좋으면 제거가 줄고 C 가 늘어납니다).
 */
import { Agent, run, type RunContext } from "@openai/agents";
import { calcTools } from "../tools";
import type { ResearchContext } from "./context";
import { instructionsFor } from "./instructions";
import { modelFor } from "./models";
import { factsSchema, type Depth, type Evidence, type FactsOutput, type PlanOutput, type ResearchNotes } from "./schema";

/** 아직 초안입니다. 고르는 기준과 계산을 부르는 기준을 채우는 것이 담당자의 일입니다. */
export const editRules = `[역할: ✂️ 정제]
당신은 데이터를 새로 가져오지 않습니다. 아래 [증거 장부] 와 [조사 메모] 에서 질문에 답하는 데 필요한 사실만 골라 facts 에 적습니다.
- facts 의 한 항목은 장부 항목 하나(ref)에서 나온 한 문장입니다. 숫자는 장부의 values 그대로, 단위와 기준일을 붙입니다. 반올림하지 않습니다.
- 의도가 cause(원인)면 "무엇이 변했나" 다음에 "그 변화를 설명할 수 있는 다른 데이터" 를 고릅니다. status(현황)면 현재 값과 비교 기준 값만 고릅니다.
- 두 값의 차이 · 변동률이 필요하면 직접 계산하지 말고 calc_metrics 를 부릅니다 (예: 한국 금리와 미국 금리의 pp_diff).
  결과로 받은 C 번호를 facts 에 적습니다. 계산이 실패하면 그 사실은 빼고 unverified 에 적습니다.
- 질문과 무관한 항목(예: 원인과 관계없는 기사)은 dropped 에 ref 와 이유를 적습니다. 작성은 그 항목을 보지 못합니다.
- 뉴스 기사가 말한 숫자가 장부(제목)에 없으면 facts 에 숫자 없이 "기사에 따르면 …" 으로 적거나 unverified 에 둡니다.
- 받은 적 없는 id 를 쓰지 않습니다. 장부가 비어 있으면 facts 는 빈 배열이고 unverified 에 무엇을 확인하지 못했는지 적습니다.`;

export function editInstructions(): string {
  return instructionsFor(editRules);
}

/** 정제 Agent 는 계산 tool 만 씁니다 (데이터 tool 은 조사의 몫). */
export function createEditorAgent(depth: Depth) {
  return new Agent<ResearchContext, typeof factsSchema>({
    name: "Muffin Editor",
    model: modelFor(depth, "edit"),
    instructions: editInstructions(),
    tools: calcTools,
    outputType: factsSchema,
  });
}

const intentNames: Record<PlanOutput["intent"], string> = {
  status: "현황",
  cause: "원인",
  compare: "비교",
  decision: "판단 요청 (판단에 필요한 사실만)",
  out_of_scope: "범위 밖",
};

/** 모델이 받는 입력: 질문 · 의도 · 장부 전체(values · note) · 조사 메모 · 확인하지 못한 것. 뺄 것을 고르려면 전체를 봐야 합니다. */
export function editInput(question: string, plan: PlanOutput, evidence: Evidence[], notes: ResearchNotes): string {
  const ledger = evidence
    .map((e) => {
      const lines = [`- ${e.id} · ${e.label} · 기준일 ${e.source.asOf}`, `  values: ${JSON.stringify(e.values)}`];
      if (e.note) lines.push(`  note: ${e.note}`);
      return lines.join("\n");
    })
    .join("\n");
  const memo = notes.notes.map((n) => `- ${n.ref}: ${n.summary}`).join("\n") || "- (없음)";
  const gaps = notes.gaps.map((g) => `- ${g}`).join("\n") || "- (없음)";
  return [
    `[질문]\n${question}`,
    `[의도]\n${intentNames[plan.intent]} (${plan.intent}) · ${plan.reason}`,
    `[증거 장부] 계산 tool 의 a · b 에는 여기 있는 id 와 values 의 키를 그대로 적습니다.\n${ledger || "- (없음. tool 이 모두 실패했습니다)"}`,
    `[조사 메모]\n${memo}`,
    `[확인하지 못한 것]\n${gaps}`,
  ].join("\n\n");
}

/**
 * 모델 출력을 장부와 맞춰 정리합니다. 작성은 facts 가 인용한 장부 항목만 보므로, 여기서 어긋난 것을 걸러야 합니다.
 *  - facts: 장부에 없는 ref(지어낸 번호, 뉴스 E3 처럼 목록의 호출 번호)와 빈 문장은 빼고 dropped 에 이유를 남깁니다. 같은 ref · 같은 문장은 한 번만
 *  - dropped: facts 에서 쓴 ref 는 뺀 것이 아니므로 지웁니다. 장부에 없는 ref 와 중복도 지웁니다
 *  - unverified: 빈 문장과 중복을 지웁니다
 */
export function cleanFacts(out: FactsOutput, ledgerIds: ReadonlySet<string>): FactsOutput {
  const facts: FactsOutput["facts"] = [];
  const unknown: FactsOutput["dropped"] = [];
  const seenFacts = new Set<string>();
  for (const f of out.facts) {
    const fact = f.fact.trim();
    if (!fact) continue;
    if (!ledgerIds.has(f.ref)) {
      if (!unknown.some((d) => d.ref === f.ref)) unknown.push({ ref: f.ref, reason: "장부에 없는 번호라 사실에서 뺌" });
      continue;
    }
    const key = `${f.ref}\u0000${fact}`;
    if (seenFacts.has(key)) continue;
    seenFacts.add(key);
    facts.push({ ref: f.ref, fact });
  }

  const used = new Set(facts.map((f) => f.ref));
  const dropped: FactsOutput["dropped"] = [];
  for (const d of out.dropped) {
    if (used.has(d.ref) || !ledgerIds.has(d.ref) || dropped.some((x) => x.ref === d.ref)) continue;
    dropped.push(d);
  }

  const unverified = [...new Set(out.unverified.map((u) => u.trim()).filter(Boolean))];
  return { facts, dropped: [...dropped, ...unknown], unverified };
}

/**
 * 정제 Agent 를 한 번 실행합니다. 계산 tool 결과는 runCtx 안의 장부에 C 번호로 쌓입니다.
 * 출력은 cleanFacts 로 장부와 맞춥니다 (계산 tool 이 만든 C 번호도 장부에 있으므로 통과).
 * 출력이 없거나 실패하면 null 을 돌려주고, 작성은 장부 전체를 봅니다 (muffin.ts). 정제 하나 때문에 리포트가 실패하지 않게 하기 위한 것입니다.
 */
export async function runEdit(
  agent: ReturnType<typeof createEditorAgent>,
  input: string,
  runCtx: RunContext<ResearchContext>,
): Promise<FactsOutput | null> {
  try {
    const result = await run(agent, input, { context: runCtx });
    if (!result.finalOutput) return null;
    return cleanFacts(result.finalOutput, new Set(runCtx.context.evidence.map((e) => e.id)));
  } catch {
    return null;
  }
}
