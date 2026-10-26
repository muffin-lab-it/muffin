/**
 * 📋 분류 Agent. 담당: @seoyoung23 (서영).
 *
 * 하는 일: 질문 · 관심 영역 · 깊이를 읽고 (1) 의도(현황 · 원인 · 비교 · 판단 요청 · 범위 밖)와 (2) 조사가 부를 tool 을 정합니다.
 * 리포트 모드(판단 요청 · 범위 밖)는 의도로 코드가 정합니다 (schema.ts modeFor). 범위 밖이면 조사 · 정제 · 작성을 건너뜁니다.
 * 모델이 실패하면 defaultPlan 이 규칙으로 대신합니다 (범위 밖 판정은 모델만 합니다).
 *
 * 이 파일에서 고치는 것: planRules(분류 기준 · 예시) · planInput(모델이 받는 입력) · areaTools · defaultPlan 의 규칙 · 테스트(plan.test.ts).
 * 출력 모양(planSchema)과 호출 순서(muffin.ts)는 리더가 관리합니다. 점수는 `pnpm eval` 의 "의도" 열(질문 세트의 intent 와 일치)입니다.
 */
import { Agent, run, type RunContext } from "@openai/agents";
import { muffinTools } from "../tools";
import type { ResearchContext } from "./context";
import { instructionsFor } from "./instructions";
import { modelFor } from "./models";
import { planSchema, type Area, type Depth, type PlanOutput } from "./schema";

/** 아직 초안입니다. 분류 기준과 예시 질문을 채우는 것이 담당자의 일입니다. */
export const planRules = `[역할: 📋 분류]
당신은 tool 을 부르지 않습니다. 질문을 읽고 의도와, 조사 단계가 부를 tool 을 정합니다.
- status: 지금 얼마인지 · 어떤 상태인지 묻는 질문 (예: "오늘 달러 환율 얼마야?")
- cause: 왜 · 원인 · 이유를 묻는 질문 (예: "환율이 왜 올랐어?"). 원인 설명에 필요한 다른 영역 tool 도 함께 고릅니다 (환율 원인 → 금리 · 뉴스).
- compare: 둘 이상을 비교하거나 기간 차이를 묻는 질문 (예: "한국이랑 미국 금리 차이 얼마나 나?")
- decision: 사도 되는지 · 팔아야 하는지 · 들어가도 되는지 묻는 질문. 거절하지 않고, 판단에 필요한 사실을 모을 tool 을 고릅니다.
- out_of_scope: 환율 · ETF · 경제 뉴스 · 금리 · 물가 지표와 무관한 질문 (예: 개별 코인 시세, 날씨, 코드 작성). tools 는 빈 배열.
- 관심 영역이 주어지면 그 영역의 tool 을 먼저 넣습니다. 확실하지 않으면 tool 을 더 넣는 쪽이 안전합니다 (조사가 필요 없는 것은 건너뜁니다).`;

/** 관심 영역 → 그 영역의 tool 이름. 레지스트리의 name 과 같아야 합니다. */
export const areaTools: Record<Area, string> = {
  fx: "get_fx_krw_rate",
  etf: "get_etf_kr_price",
  news: "get_korean_economic_news",
  rate: "get_rate_data",
  macro: "get_macro_indicators",
};

const areaNames: Record<Area, string> = { fx: "환율", etf: "ETF", news: "경제뉴스", rate: "금리", macro: "물가·경제지표" };

/** "사도 돼?" 류 판단 요청. Mock 과 기본 규칙이 같이 씁니다. */
export const DECISION_PATTERN = /(사도|살까|팔까|팔아야|매수|매도|들어가도|투자해도|사야|팔면)/;
const CAUSE_PATTERN = /(왜|원인|이유|때문|배경)/;
const COMPARE_PATTERN = /(비교|대비|vs|차이|보다|격차)/i;

export function planInstructions(): string {
  return instructionsFor(planRules);
}

export function createPlannerAgent(depth: Depth) {
  return new Agent<ResearchContext, typeof planSchema>({
    name: "Muffin Planner",
    model: modelFor(depth, "plan"),
    instructions: planInstructions(),
    outputType: planSchema,
  });
}

/** 모델이 받는 입력: 질문 · 관심 영역 · 깊이 · 고를 수 있는 tool 목록(이름과 설명). */
export function planInput(question: string, area: Area | undefined, depth: Depth, tools: typeof muffinTools = muffinTools): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return [
    `[질문]\n${question}`,
    `[관심 영역]\n${area ? `${areaNames[area]} (${area})` : "(지정 없음)"}`,
    `[설명 깊이]\n${depth}`,
    `[쓸 수 있는 tool] 이 이름 그대로 tools 에 적습니다.\n${list}`,
  ].join("\n\n");
}

/**
 * 모델 없이 규칙으로 만드는 기본 계획. 분류 Agent 가 실패했을 때 씁니다.
 * 범위 밖은 판정하지 않습니다 (모르면 조사하는 쪽이 안전). 관심 영역이 없으면 모든 tool 을 줍니다.
 */
export function defaultPlan(question: string, area?: Area): PlanOutput {
  const intent = DECISION_PATTERN.test(question) ? "decision" : CAUSE_PATTERN.test(question) ? "cause" : COMPARE_PATTERN.test(question) ? "compare" : "status";
  const tools = area ? [areaTools[area]] : muffinTools.map((t) => t.name);
  if (area && (intent === "cause" || intent === "decision") && area !== "news") tools.push(areaTools.news);
  return { intent, tools: [...new Set(tools)], reason: "분류 Agent 없이 기본 규칙으로 정함" };
}

/**
 * 모델 출력을 정리합니다. 레지스트리에 없는 tool 이름은 버리고, 범위 밖이 아닌데 tool 이 하나도 없으면 기본 계획의 tool 을 씁니다.
 */
export function normalizePlan(output: PlanOutput, question: string, area: Area | undefined, tools: typeof muffinTools = muffinTools): PlanOutput {
  const known = new Set(tools.map((t) => t.name));
  const picked = [...new Set(output.tools.filter((name) => known.has(name)))];
  if (output.intent === "out_of_scope") return { ...output, tools: [] };
  return { ...output, tools: picked.length ? picked : defaultPlan(question, area).tools };
}

/**
 * 분류 Agent 를 한 번 실행합니다. 출력이 없거나 실패하면 기본 계획으로 대신하고 reason 에 그 사실을 남깁니다.
 * 분류 하나 때문에 리포트 전체가 실패하지 않게 하기 위한 것이고, 조사 · 작성은 실패하면 그대로 throw 합니다.
 */
export async function runPlan(
  agent: ReturnType<typeof createPlannerAgent>,
  input: string,
  runCtx: RunContext<ResearchContext>,
  fallback: PlanOutput,
): Promise<PlanOutput> {
  try {
    const result = await run(agent, input, { context: runCtx });
    return result.finalOutput ?? { ...fallback, reason: `${fallback.reason} (분류 Agent 가 출력을 내지 못함)` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...fallback, reason: `${fallback.reason} (분류 Agent 실패: ${message.slice(0, 120)})` };
  }
}
