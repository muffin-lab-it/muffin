/**
 * ③ 작성 Agent. tool 이 없고, 증거 장부와 조사 메모만 보고 깊이별 리포트를 씁니다.
 * 수정 요청이 와도 tool 을 다시 부르지 않으므로 증거 번호가 그대로 유지됩니다.
 * 권유 표현 검사는 SDK output guardrail 로 걸어 Traces 에 남기고, 걸리면 출력을 들고 검증 → 수정 흐름으로 넘깁니다.
 */
import { Agent, OutputGuardrailTripwireTriggered, run, type OutputGuardrail, type RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { findAdvice } from "./guard";
import { writerInstructions } from "./instructions";
import { modelFor } from "./models";
import { writerSchema, type Area, type Depth, type Evidence, type ResearchNotes, type WriterOutput } from "./schema";

/** 투자 권유 표현이 있으면 tripwire. 패턴은 guard.ts 하나만 씁니다. */
export const adviceGuardrail: OutputGuardrail<typeof writerSchema, ResearchContext> = {
  name: "no_investment_advice",
  execute: async ({ agentOutput }) => {
    const flagged = findAdvice(agentOutput as WriterOutput);
    return { tripwireTriggered: flagged.length > 0, outputInfo: { flagged } };
  },
};

export function createWriterAgent(depth: Depth, area?: Area) {
  return new Agent<ResearchContext, typeof writerSchema>({
    name: "Muffin Writer",
    model: modelFor(depth),
    instructions: writerInstructions(depth, area),
    outputType: writerSchema,
    outputGuardrails: [adviceGuardrail],
  });
}

/** 작성 Agent 에게 주는 재료. 장부가 숫자의 진실이고, 메모는 맥락입니다. */
export function writerInput(question: string, evidence: Evidence[], notes: ResearchNotes): string {
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
    `[증거 장부] numbers 의 숫자는 여기 있는 값만 쓰고, ref 에는 그 항목의 id 를 적습니다.\n${
      ledger || "- (없음. tool 이 모두 실패했습니다. numbers 는 비우고 dataGaps 에 무엇을 확인하지 못했는지 적습니다)"
    }`,
    `[조사 메모]\n${memo}`,
    `[확인하지 못한 것] dataGaps 에 옮깁니다.\n${gaps}`,
  ].join("\n\n");
}

/** 검증 실패 목록을 붙인 1회 수정 요청. */
export function revisionNote(failures: string[]): string {
  return (
    "[수정 요청] 검증에서 아래 항목이 실패했습니다. 같은 장부로 리포트를 다시 쓰되, " +
    "틀린 숫자는 장부의 값으로 고치거나 빼고, 근거 표시(basis · refs)는 규칙대로 맞추고, 권유 표현은 \"무엇을 뜻하는지\" 까지만 쓰세요.\n- " +
    failures.join("\n- ")
  );
}

/**
 * 작성 Agent 를 한 번 실행합니다. 권유 표현 가드레일에 걸리면 SDK 가 throw 하지만 출력은 들고 있으니
 * 그대로 돌려주고, 검증(verify)이 권유 표현을 실패 항목으로 잡아 수정 요청으로 이어지게 합니다.
 */
export async function runWriter(
  agent: ReturnType<typeof createWriterAgent>,
  input: string,
  runCtx: RunContext<ResearchContext>,
): Promise<WriterOutput> {
  try {
    const result = await run(agent, input, { context: runCtx });
    if (!result.finalOutput) throw new Error("작성 Agent 가 리포트를 생성하지 못했습니다.");
    return result.finalOutput;
  } catch (err) {
    if (err instanceof OutputGuardrailTripwireTriggered) {
      const output = (err.result as { agentOutput?: unknown }).agentOutput;
      if (output && typeof output === "object") return output as WriterOutput;
    }
    throw err;
  }
}
