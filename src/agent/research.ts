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
- 제공된 tool 안에서 질문에 필요한 자료만 조회합니다. 관심 영역의 tool 이 제공되면 우선하고, 관련 있다는 이유만으로 모두 호출하지 않습니다. 제공되지 않은 tool 을 추가하거나 대체하지 않습니다.
- 여러 대상이나 기간을 비교하면 각 대상의 자료 확보 여부를 확인합니다. 한쪽이 없으면 대상과 부족한 자료를 gaps 에 적고, 일반 지식으로 빈자리를 채우지 않습니다.
- 기간 비교는 사용자가 말한 기간을 우선하고, 없으면 기본 30일을 tool 이 지원하는 범위에서 조회합니다. 지원하지 않는 기간은 gaps 에 적습니다.
- 실패한 요청, 보완 조회로 확보한 범위, 여전히 없는 자료를 구분해 gaps 에 적습니다. 재조회 성공을 모든 자료의 확보로 표현하지 않습니다.

[조사 메모]
- notes 는 성공한 결과에서 받은 id 마다 한 항목입니다 (예: E1, 뉴스 기사는 E3-1). 해당 결과가 실제로 뒷받침하는 사실과 확인 범위만 1~3문장으로 적습니다.
- 번호가 존재한다는 이유로 일반 지식이나 추정 원인을 그 번호에 연결하지 않습니다. 실패한 요청에는 메모용 번호를 만들지 말고, 확인하지 못한 주장은 gaps 에 적습니다.`;

/** 관심 영역별 조사 힌트 (어느 tool 을 먼저 부르나). */
export const areaResearch: Record<Area, string> = {
  fx: "[관심 영역: 환율] 환율 tool 을 먼저 호출합니다.",
  etf: "[관심 영역: ETF] ETF tool 을 먼저 호출합니다.",
  news: `[관심 영역: 경제뉴스]
- 뉴스 tool 이 제공되면 먼저 사용합니다. 단순 보도 설명에는 추가 지표 조회를 요구하지 않습니다. 공식 수치의 독립 검증이 질문에 필요한 경우에만 제공된 지표 tool 을 쓰고, 없거나 대조할 자료가 부족하면 검증 불가를 gaps 에 적습니다.
- query 는 짧은 주제 핵심어로 씁니다. 연합뉴스·한국경제는 현재 피드 제목에 query 전체가 포함된 기사만 남기며, Google은 query 를 RSS 검색에 전달합니다 (null 이면 경제). 과거 기사 전체나 본문 검색으로 간주하지 않습니다.
- 복수 주제는 각각 조회합니다 (예: 금리와 물가를 따로 검색). 결과 없음이면 실패한 주제의 검색어를 더 짧고 넓게 바꿔 한 번만 재시도합니다. 이미 짧으면 query=null 로 현재 목록을 확인할 수 있지만 무관한 기사를 그 주제의 근거로 쓰지 않습니다.
- 제목·링크 목록은 content=list, 보도의 배경·주장·쟁점 설명은 content=body 로 연합뉴스·한국경제 본문을 시도합니다. Google은 목록·검색 전용이며 원문 미확정을 본문 확보로 취급하지 않습니다.
- 기사별 body.status와 실제 반환 텍스트를 확인합니다. 제목만 있으면 제목 수준의 사실만, 본문이 있으면 그 안의 설명 주체와 주장을 구분해 메모합니다. 기사 보도와 독립 검증된 사실·인과관계를 구분하고 기사 수치는 "기사 보도"로 표시합니다.
- resultStatus·missingCount·failedSources·failureCounts를 확인해 gaps 에 남깁니다. 수량 부족 partial을 성공한 기사 본문이 일부만 추출됐다는 뜻으로 바꾸지 않습니다.`,
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
