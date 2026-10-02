import { Agent, run } from "@openai/agents";
import { muffinTools } from "../tools";
import { instructionsFor } from "./instructions";
import { reportSchema, type Area, type Depth, type Report } from "./schema";

export function createMuffinAgent(depth: Depth, area?: Area) {
  return new Agent({
    name: "Muffin Research Agent",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: instructionsFor(depth, area),
    tools: muffinTools,
    outputType: reportSchema,
  });
}

export type ResearchInput = { question: string; depth: Depth; area?: Area };

/**
 * 백엔드 팀은 이 함수만 호출합니다. 시그니처는 3주차에 고정합니다.
 * 스트리밍은 run(agent, question, { stream: true }) 로 확장합니다.
 */
export async function research({ question, depth, area }: ResearchInput): Promise<Report> {
  const agent = createMuffinAgent(depth, area);
  const result = await run(agent, question);
  if (!result.finalOutput) throw new Error("Agent 가 리포트를 생성하지 못했습니다.");
  return result.finalOutput;
}
