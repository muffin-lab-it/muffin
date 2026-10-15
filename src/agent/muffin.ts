import { Agent, RunContext, run } from "@openai/agents";
import { muffinTools } from "../tools";
import { ResearchContext, mergeSources, type ToolStep } from "./context";
import { findAdvice } from "./guard";
import { instructionsFor } from "./instructions";
import { reportSchema, type Area, type Depth, type Report } from "./schema";

/** 깊이별 모델. Deep Dive 만 상위 모델을 씁니다. .env 로 바꿀 수 있습니다. */
export function modelFor(depth: Depth): string {
  if (depth === "deep") return process.env.OPENAI_MODEL_DEEP || process.env.OPENAI_MODEL || "gpt-4.1";
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

export function createMuffinAgent(depth: Depth, area?: Area, extraInstructions = "") {
  return new Agent<ResearchContext, typeof reportSchema>({
    name: "Muffin Research Agent",
    model: modelFor(depth),
    instructions: [instructionsFor(depth, area), extraInstructions].filter(Boolean).join("\n\n"),
    tools: muffinTools,
    outputType: reportSchema,
  });
}

export type ResearchInput = { question: string; depth: Depth; area?: Area };
export type ResearchResult = {
  report: Report;
  /** 어떤 tool 을 불렀고 성공했는지. 진행상황 화면·디버깅용 */
  steps: ToolStep[];
  /** 권유 표현 검사에 걸려 다시 쓴 횟수 */
  rewrites: number;
  /** 사용한 모델과 토큰 (재작성 포함 합계). 로그·비용 추적용 */
  model?: string;
  usage?: { requests: number; inputTokens: number; outputTokens: number };
};

/**
 * 백엔드 팀은 이 함수만 호출합니다. 시그니처는 3주차에 고정합니다.
 * 스트리밍은 run(agent, question, { stream: true, context }) 로 확장합니다.
 */
export async function research({ question, depth, area }: ResearchInput): Promise<ResearchResult> {
  const ctx = new ResearchContext();
  // RunContext 로 직접 감싸야 재작성까지 포함한 토큰 사용량이 한곳에 쌓입니다.
  const runCtx = new RunContext(ctx);
  let extra = "";
  let rewrites = 0;
  let report: Report | undefined;

  // 권유 표현이 걸리면 한 번만 다시 씁니다. 두 번째도 걸리면 그대로 내보내고 rewrites 로 표시합니다.
  for (let attempt = 0; attempt < 2; attempt++) {
    const agent = createMuffinAgent(depth, area, extra);
    const result = await run(agent, question, { context: runCtx });
    if (!result.finalOutput) throw new Error("Agent 가 리포트를 생성하지 못했습니다.");
    report = result.finalOutput;

    const flagged = findAdvice(report);
    if (flagged.length === 0) break;
    rewrites++;
    extra = `[재작성] 아래 문장에 투자 권유 표현이 있습니다. 같은 데이터로 리포트를 다시 쓰되, 행동 지시 없이 "무엇을 뜻하는지" 까지만 쓰세요.\n- ${flagged.join("\n- ")}`;
  }

  // 출처는 모델의 기억이 아니라 tool 이 실제로 반환한 것을 기준으로 합니다.
  const final: Report = { ...report!, sources: mergeSources(ctx.sources, report!.sources) };
  const { requests, inputTokens, outputTokens } = runCtx.usage;
  return {
    report: final,
    steps: ctx.steps,
    rewrites,
    model: modelFor(depth),
    usage: { requests, inputTokens, outputTokens },
  };
}
