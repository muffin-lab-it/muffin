import { Agent, run } from "@openai/agents";
import { muffinTools } from "../tools";
import { ResearchContext, mergeSources, type ToolStep } from "./context";
import { instructionsFor } from "./instructions";
import { reportSchema, type Area, type Depth, type Report } from "./schema";

export function createMuffinAgent(depth: Depth, area?: Area) {
  return new Agent<ResearchContext, typeof reportSchema>({
    name: "Muffin Research Agent",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: instructionsFor(depth, area),
    tools: muffinTools,
    outputType: reportSchema,
  });
}

export type ResearchInput = { question: string; depth: Depth; area?: Area };
export type ResearchResult = {
  report: Report;
  /** 어떤 tool 을 불렀고 성공했는지. 진행상황 화면·디버깅용 */
  steps: ToolStep[];
};

/**
 * 백엔드 팀은 이 함수만 호출합니다. 시그니처는 3주차에 고정합니다.
 * 스트리밍은 run(agent, question, { stream: true, context }) 로 확장합니다.
 */
export async function research({ question, depth, area }: ResearchInput): Promise<ResearchResult> {
  const agent = createMuffinAgent(depth, area);
  const ctx = new ResearchContext();
  const result = await run(agent, question, { context: ctx });
  if (!result.finalOutput) throw new Error("Agent 가 리포트를 생성하지 못했습니다.");

  // 출처는 모델의 기억이 아니라 tool 이 실제로 반환한 것을 기준으로 합니다.
  const report: Report = {
    ...result.finalOutput,
    sources: mergeSources(ctx.sources, result.finalOutput.sources),
  };
  return { report, steps: ctx.steps };
}
