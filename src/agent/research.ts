/**
 * 🔍 조사 Agent. 담당: @Kangsohee (소희).
 *
 * 하는 일: 분류가 고른 tool 을 부르고, 성공한 결과(E 번호)마다 짧은 조사 메모를 남깁니다. 리포트는 쓰지 않습니다.
 * tool 결과는 defineTool 이 증거 장부(ResearchContext.evidence)에 E 번호로 기록하고, 메모는 정제 · 작성이 맥락으로 씁니다.
 *
 * 이 파일에서 고치는 것: researchRules(규칙 · 뉴스 검색어 전략 · 실패 시 보완) · areaResearch(영역 힌트) · 테스트(research.test.ts).
 * 입력 · 출력 모양(researchNotesSchema)과 호출 순서(muffin.ts)는 리더가 관리합니다.
 */
import { Agent, run, type RunContext } from "@openai/agents";
import { muffinTools } from "../tools";
import type { ResearchContext } from "./context";
import { instructionsFor } from "./instructions";
import { modelFor } from "./models";
import { researchNotesSchema, type Area, type Depth, type ResearchNotes } from "./schema";

export const researchRules = `[역할: 🔍 조사]
당신의 일은 tool 로 데이터를 모으고, 결과마다 짧은 조사 메모를 남기는 것입니다. 리포트는 다음 단계(정제 · 작성)가 씁니다.
- 반드시 tool 을 최소 1개 호출합니다. tool 없이 기억으로 답하지 않습니다.
- 질문과 관련된 tool 이 여러 개면 모두 호출합니다. 관심 영역의 tool 을 먼저 부르고, 원인 설명에 필요한 다른 tool 도 부릅니다.
- 기간 비교가 필요하면 기본 30일을 씁니다. 사용자가 기간을 말하면 그 기간을 씁니다.
- 뉴스는 질문의 핵심어로 검색하고, 결과가 없으면 더 넓은 검색어로 한 번 더 시도합니다.
- tool 이 실패하거나 필요한 데이터가 없으면 추측하지 말고 gaps 에 적습니다.

[조사 메모]
- tool 결과마다 id 가 붙어 있습니다 (예: E1, 뉴스 기사는 E3-1). notes 에는 성공한 결과 id 마다 한 항목을 만들고,
  질문에 답하는 데 쓸 내용을 1~3문장으로 적습니다. 숫자는 tool 이 준 값 그대로, 기준일과 함께 적습니다.
- 뉴스는 기사마다(E3-1, E3-2 …) 핵심 주장을 한 문장으로 적습니다. 기사에 나온 숫자는 "기사 보도" 라고 표시합니다.`;

/** 관심 영역별 조사 힌트 (어느 tool 을 먼저 부르나). */
export const areaResearch: Record<Area, string> = {
  fx: "[관심 영역: 환율] 환율 tool 을 먼저 호출합니다.",
  etf: "[관심 영역: ETF] ETF tool 을 먼저 호출합니다.",
  news: "[관심 영역: 경제뉴스] 뉴스 tool 을 먼저 호출하고, 뉴스에 나온 숫자는 다른 tool 로 확인합니다.",
  rate: "[관심 영역: 금리] 금리 tool 을 먼저 호출합니다.",
  macro: "[관심 영역: 물가·경제지표] 거시지표 tool 을 먼저 호출합니다.",
};

export function researchInstructions(area?: Area): string {
  return instructionsFor(researchRules, area ? areaResearch[area] : "");
}

/** 조사 Agent 가 쓸 수 있는 tool 목록의 타입. 분류가 고른 것만 넘기고, 비면 전체를 씁니다. */
export type ResearchTools = typeof muffinTools;

export function createResearcherAgent(depth: Depth, area?: Area, tools: ResearchTools = muffinTools) {
  return new Agent<ResearchContext, typeof researchNotesSchema>({
    name: "Muffin Researcher",
    model: modelFor(depth, "research"),
    instructions: researchInstructions(area),
    tools: tools.length ? tools : muffinTools,
    outputType: researchNotesSchema,
  });
}

/** 메모를 남기지 못했을 때의 기본값. 장부는 그대로 있으니 정제 · 작성은 장부만으로 이어갑니다. */
export const NOTES_FALLBACK: ResearchNotes = { notes: [], gaps: ["조사 Agent 가 조사 메모를 남기지 못했습니다."] };

/** 조사 Agent 를 한 번 실행합니다. tool 결과는 runCtx 안의 장부에 쌓이고, 돌려주는 것은 메모입니다. */
export async function runResearch(
  agent: ReturnType<typeof createResearcherAgent>,
  question: string,
  runCtx: RunContext<ResearchContext>,
): Promise<ResearchNotes> {
  const result = await run(agent, question, { context: runCtx });
  return result.finalOutput ?? NOTES_FALLBACK;
}
