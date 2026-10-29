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

/**
 * 분류 기준은 구체적인 질문 예시를 기준으로 적용합니다.
 * 출력은 intent · 등록된 tool 이름 · 한 문장 reason 으로 제한합니다.
 */
export const planRules = `[역할: 📋 분류]
당신은 tool 을 직접 부르지 않습니다. 질문을 읽고 의도와 조사 단계가 부를 tool 을 정합니다.

[의도 분류 — 질문에서 가장 중요한 요청 하나를 고릅니다]
- decision: 사용자가 사거나 팔아도 되는지, 투자해도 되는지 판단을 요청합니다.
  예: "달러 지금 사도 돼?", "이 ETF 팔아야 할까?", "금리가 내리면 채권 ETF 투자해도 돼?"
  판단 요청은 다른 의도보다 우선합니다. 질문에 '왜'가 있어도 최종 요청이 매수·매도 판단이면 decision 입니다.
  투자 결정을 대신하거나 매수·매도를 권하지 말고, 판단에 필요한 사실을 조사합니다.
- out_of_scope: 환율, ETF, 경제 뉴스, 금리, 물가·경제지표와 관련 없는 질문입니다.
  예: "오늘 비트코인 시세 알려줘", "내일 서울 날씨", "파이썬 코드 작성해 줘".
  tools 는 반드시 빈 배열입니다. 금융이라는 이유만으로 지원 영역에 포함하지 않습니다.
- cause: 어떤 변화나 상태의 원인·이유·배경을 묻습니다.
  예: "원달러 환율이 왜 올랐어?", "물가가 오른 이유가 뭐야?"
  원인 설명에 필요한 영역을 고르고, 질문에 직접 관련된 경제 뉴스·금리 등 보조 tool 을 함께 선택합니다.
- compare: 둘 이상의 대상이나 시점·기간 사이의 차이를 묻습니다.
  예: "한국과 미국 금리 차이는?", "환율이 한 달 전보다 얼마나 변했어?", "두 ETF를 비교해 줘".
- status: 현재 값·최근 상태·현황을 묻거나, 위 의도에 해당하지 않는 지원 영역 질문입니다.
  예: "오늘 원달러 환율 얼마야?", "현재 기준금리가 얼마야?", "최근 경제 뉴스 알려줘".

[tool 선택]
- 관심 영역이 지정되면 해당 영역의 tool 을 첫 번째에 둡니다. 관심 영역은 질문의 실제 대상과 충돌하지 않는 한 우선합니다.
- 원인 질문은 원인을 설명하는 데 도움이 되는 관련 tool 을 추가합니다. 예: 환율 원인 → 환율 + 경제 뉴스, 금리 등 질문과 관련된 영역.
- 판단·비교 질문은 질문에 등장하는 대상과 비교 기준을 확인할 수 있는 tool 을 선택합니다.
- 질문에 답하는 데 필요한 tool 만 고릅니다. 확실하지 않다는 이유만으로 모든 tool 을 무조건 선택하지 않습니다.
- [쓸 수 있는 tool] 목록에 실제로 있는 이름만 정확히 사용합니다. 이름을 지어내거나 중복해서 쓰지 않습니다.
- out_of_scope 는 항상 tools: [] 입니다. 그 외 의도는 가능한 관련 tool 을 선택합니다.
- reason 은 선택한 의도와 tool 의 이유를 한국어 한 문장으로 설명합니다.
- 숫자·변동률을 직접 계산하지 않습니다. 계산은 후속 단계의 계산 tool 이 담당합니다.`;

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
