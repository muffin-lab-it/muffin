/**
 * 다섯 단계 오케스트레이션. 리더 관리. 순서는 여기서 고정하고, 모델은 각 단계 파일 안에서만 판단합니다.
 *
 *   📋 plan.ts (서영)  →  🔍 research.ts (소희)  →  ✂️ edit.ts (은경)  →  ✍️ write.ts (은선) + depth.ts (하니)  →  ✅ verify.ts (코드)
 *
 * 단계 사이를 잇는 것은 증거 장부(ResearchContext.evidence)입니다. 조사의 tool 결과는 E 번호, 정제의 계산은 C 번호로 올라가고,
 * 작성은 그 번호를 인용하고, 검증은 번호로 원본과 대조합니다. 검증 실패는 작성에게만 1회 되돌립니다 (조사 · 정제로 되돌아가지 않음).
 * 원인 질문이면 정제와 동시에 유의성 게이트(movement.ts)가 이번 움직임이 평소 범위인지 재서 작성 입력 · 리포트 안내에 붙입니다.
 * 네 Agent 실행은 withTrace 로 한 묶음이라 OpenAI Traces 에서 한 요청으로 보입니다.
 */
import { RunContext, withTrace, type Agent, type AgentOutputType } from "@openai/agents";
import { muffinTools } from "../tools";
import { mergeSameCards } from "./cards";
import { fxChart, indexChart } from "./chart";
import { withEnsuredFacts } from "./extra-facts";
import { ResearchContext, type ToolStep } from "./context";
import { createEditorAgent, editInput, reversedCalcIds, runEdit } from "./edit";
import type { MuffinEvent } from "./events";
import { modelFor, modelSettingsFor, type ModelStage } from "./models";
import { areaTools, createPlannerAgent, defaultPlan, normalizePlan, planInput, runPlan } from "./plan";
import { changeDetailsFor } from "./change";
import { droppedNote } from "./dropped";
import { addModelUsage, type UsageSummary } from "../lib/pricing";
import { basketNote, basketRows, ensureEtfBasket, withBasketNumbers } from "./etf-basket";
import { ensureIndex, indexCaveats, indexFor, indexNote, indexRefs, officialIndex, withIndexNumbers } from "./index-quote";
import { trimNegatives } from "./negatives";
import { dropNewsCards, newsCardNote } from "./news-numbers";
import { addMacroNews, macroNewsNote } from "./news-topics";
import { ensureRateReference, ensureRateYear, rateReferenceNote, rateYearNote, withRateReference, yearRates } from "./rate-trend";
import { addExampleCalc, exampleNote, withExampleNumbers } from "./example-calc";
import { ensureMoneyValue, moneyValueNote, moneyValueRows } from "./money-value";
import { ensureRelation, relationHeadline, relationHidden, relationNote, relationRefs, trimRelationRepeats, withRelationNumbers } from "./relation";
import { ensureCpiCategories, ensureOtherPairs } from "./supplement";
import { cpiCauseNote, cpiRescuedRefs } from "./cpi";
import { DECISION_NOTICE, FOREIGN_ETF_NOTICE, OUT_OF_SCOPE_NOTICE, STOCK_NOTICE, assembleReport, fallbackGaps, foreignEtfOutput, fxBasisCaveats, outOfScopeOutput, stockOutput } from "./report";
import { isSwingQuestion, measureMovement, movementEvidence, movementNote, movementNotice, movementSummary, pickTarget, rescuedRefs, swingNote, withSwingNumbers, type MovementResult } from "./movement";
import { createResearcherAgent, runResearch } from "./research";
import { modeFor, type Area, type Depth, type FactsOutput, type PlanOutput, type Report, type ReportMode, type WriterOutput } from "./schema";
import { dropOffTopic, ensureMentioned, mentionedTools, offTopicGap, offTopicNote, offTopicParts, rescueScope, scopeGap, scopeNote } from "./scope-rescue";
import { trimGapInputs, trimRepeats } from "./trim";
import { applyVerification, summarizeVerification, verify } from "./verify";
import { createWriterAgent, revisionNote, runWriter, writerInput } from "./write";

export { modelFor } from "./models";

/**
 * 개별 기업의 주가를 묻는 질문인지. "주가 · 주식 시세" 를 묻는데 지수(코스피 · 나스닥 등) · ETF · 증시 전체가 아닌 경우입니다.
 * 기업 이름을 다 알 수는 없어, 다루는 대상의 낱말이 없을 때만 그렇게 봅니다.
 */
export function isStockQuestion(question: string): boolean {
  return /주가|주식\s*(시세|가격)|시가총액/.test(question) && !/지수|코스피|코스닥|나스닥|S&P|에스앤피|다우|증시|ETF|이티에프|KODEX|TIGER|환율|금리|물가/i.test(question);
}

/** 사거나 팔거나 투자할지를 묻는 낱말. 이 낱말이 없으면 판단 요청으로 보지 않습니다 */
export const DECISION_WORDS = /사도|살까|사야|살\s*만|사는\s*게|팔까|팔아|팔면|매수|매도|투자|들어가도|넣어도|갈아타|환전해도|바꿔도|바꿀까|가입해도|해지/;

/** 스트림 라우트의 마감(STREAM_TIMEOUT_MS 55초)과 같은 기본 예산. research() 를 부른 시각부터 셉니다. */
export const TIME_BUDGET_MS = 55_000;

/**
 * 🔍 조사에 넘길 영역 힌트 (11/13). 사용자가 영역을 골랐으면 그대로, 안 골랐으면(Auto · 복수 선택) 분류가 고른 tool 에서 읽습니다.
 * 영역 힌트가 없으면 research.ts 의 영역별 지시(환율 원인 질문의 금리 · 뉴스 호출 등)가 통째로 빠져 Auto 에서만 조사가 달라지던 것을 막습니다.
 * 뉴스가 아닌 첫 tool 의 영역을 고릅니다 (뉴스 힌트는 지표 조회를 줄이는 쪽이라, 뉴스와 지표가 같이 뽑힌 질문은 지표 영역이 주제).
 */
export function hintAreaFor(area: Area | undefined, tools: string[]): Area | undefined {
  if (area) return area;
  const byTool = new Map(Object.entries(areaTools).map(([a, t]) => [t, a as Area]));
  const areas = tools.map((t) => byTool.get(t)).filter((a): a is Area => a !== undefined);
  return areas.find((a) => a !== "news") ?? areas[0];
}
/** 다시 쓰기(작성 1회 + 검증)에 드는 시간. 실측 9.6~11.6초 (2026-10-26 · 28). 남은 시간이 이보다 적으면 다시 쓰지 않습니다. */
export const REVISION_RESERVE_MS = 15_000;

/**
 * 단계별 호출 설정(시간 제한 · 시간 초과 재시도 · 추론 강도)을 Agent 에 덧씌웁니다. 값은 models.ts 의 modelSettingsFor 가 정하고,
 * 담당자의 단계 파일은 바꾸지 않습니다.
 */
function tuned<TOutput extends AgentOutputType>(agent: Agent<ResearchContext, TOutput>, stage: ModelStage, depth: Depth): Agent<ResearchContext, TOutput> {
  return agent.clone({ modelSettings: { ...agent.modelSettings, ...modelSettingsFor(stage, depth) } });
}

export type ResearchInput = { question: string; depth: Depth; area?: Area };
export type ResearchOptions = {
  /** 진행 이벤트 (stage · plan · step · verify). report · error 는 라우트가 요청 id 를 붙여 보냅니다 */
  onEvent?: (event: MuffinEvent) => void;
  /** 이 시각(epoch ms)까지 리포트를 내야 합니다. 없으면 부른 시각 + TIME_BUDGET_MS */
  deadline?: number;
};
export type ResearchResult = {
  report: Report;
  /** 어떤 tool 을 불렀고 성공했는지. 진행상황 화면·디버깅용 */
  steps: ToolStep[];
  /** 검증 실패로 작성 Agent 가 다시 쓴 횟수 (최대 1) */
  rewrites: number;
  /** 첫 초안이 검증에 걸린 이유 (다시 쓰기가 돌았을 때만, 줄마다 200자까지). 실행 로그에 남겨 다시 쓰기 원인을 세려고 둡니다 (11/22) */
  rewriteReasons?: string[];
  /** 📋 분류 결과와 모드. 평가(의도 일치) · 로그용. 리포트에는 mode 만 들어갑니다 */
  plan: PlanOutput & { mode: ReportMode };
  /** ✂️ 정제 결과. 실패 · 건너뜀이면 null. 평가에서 뺀 항목을 볼 때 씁니다 (리포트에는 들어가지 않음) */
  facts: FactsOutput | null;
  /** ✂️ 정제 요약 (실행 로그용, 리포트에는 들어가지 않음). 정제가 얼마나 실패하고 빼는지 /admin · SQL 로 세려고 남깁니다 */
  edit?: EditSummary;
  /** 조사 · 작성에 쓴 모델과 토큰 (네 단계 합계). 로그·비용 추적용 */
  model?: string;
  /** 토큰 합계와 모델별(byModel). 모델별이 있어야 단가를 적용해 리포트 한 장의 비용을 냅니다 (src/lib/pricing.ts) */
  usage?: UsageSummary;
};

/**
 * 정제 한 번의 결과를 숫자로. ok 가 false 면 정제가 출력을 내지 못해(실패 · 예외) 작성이 장부 전체를 본 것입니다.
 * dropped 는 정제가 뺀 항목 수(방향이 반대라 코드가 거른 계산 포함), reversed 는 그중 방향이 반대인 계산 수,
 * fallback 은 사실이 0개라 작성이 장부 전체를 본 경우입니다 (정제는 성공).
 */
export type EditSummary = { ok: boolean; facts: number; dropped: number; unverified: number; reversed: number; fallback: boolean };

export function summarizeEdit(facts: FactsOutput | null, reversed: number): EditSummary {
  if (!facts) return { ok: false, facts: 0, dropped: 0, unverified: 0, reversed, fallback: true };
  return { ok: true, facts: facts.facts.length, dropped: facts.dropped.length, unverified: facts.unverified.length, reversed, fallback: facts.facts.length === 0 };
}

/**
 * 다시 쓰기 때 작성에게 보여 주는 이전 초안. 초안 없이 실패 목록만 주면 처음부터 새로 써서, 통과했던 항목이 두 번째 초안에서 새로 틀리고
 * 그대로 빠질 수 있습니다. 초안을 주고 실패한 항목만 고치게 합니다. 수정 요청 문구(revisionNote)는 write.ts 가 관리합니다.
 */
export function draftNote(output: WriterOutput): string {
  return `[이전 초안] 방금 쓴 리포트입니다. 아래 [수정 요청] 에 적힌 항목만 고치고, 나머지 항목은 문장 · 숫자 · ref 를 그대로 둡니다.\n${JSON.stringify(output)}`;
}

/**
 * 백엔드 팀은 이 함수만 호출합니다. 입력 모양은 고정이고, 진행 이벤트는 onEvent 로 받습니다.
 *
 * 📋 분류(의도 · tool 선택 · 모드) → 범위 밖이면 고정 안내로 끝 → 🔍 조사(tool + 메모) → ✂️ 정제(사실 고르기 + 계산, 원인 질문이면 움직임 크기도) →
 * ✍️ 작성(사실 목록만 보고) → ✅ 검증(코드) → 실패하면 작성에 1회 수정 요청 → 그래도 남은 실패는 리포트에서 빼고 verification.removed 에 기록.
 * 수정 때 tool 을 다시 부르지 않아 증거 번호가 유지됩니다. 분류 · 정제가 실패해도 리포트는 나옵니다 (기본 계획 · 장부 전체).
 */
export async function research(input: ResearchInput, options: ResearchOptions = {}): Promise<ResearchResult> {
  const deadline = options.deadline ?? Date.now() + TIME_BUDGET_MS;
  return withTrace("Muffin research", () => runStages(input, { ...options, deadline }));
}

/**
 * 화면이 영역을 여러 개 골랐을 때 질문 앞에 붙이는 머리말("관심 영역: 환율, ETF\n\n", app/components/home-form.ts)을 뗀 질문.
 * 머리말의 "ETF · 금리 · 물가" 가 질문의 낱말로 읽혀 환율 원인 질문의 유의성 게이트가 통째로 빠졌습니다 (11/20 베타: "환율 변동이 왜이렇게 심해?" →
 * 평소 범위 안내 · 차트 없이 "원인은 확인하기 어렵습니다"). 분류에는 고른 영역을 알리려고 원문을 주고, 나머지 단계와 코드 판별은 뗀 질문을 씁니다.
 */
export function plainQuestion(question: string): string {
  return question.replace(/^관심 영역: [^\r\n]+\r?\n\r?\n/, "").trim() || question;
}

async function runStages({ question: asked, depth, area }: ResearchInput, { onEvent, deadline }: ResearchOptions & { deadline: number }): Promise<ResearchResult> {
  const question = plainQuestion(asked);
  const emit = (event: MuffinEvent) => onEvent?.(event);
  const usage: UsageSummary = { requests: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
  // 단계마다 그 단계의 모델 칸에도 쌓습니다 (분류 · 정제는 작은 모델, 조사 · 작성은 깊이별 모델이라 단가가 다름)
  const addUsage = (rc: RunContext<ResearchContext>, stage: ModelStage) => {
    usage.requests += rc.usage.requests;
    usage.inputTokens += rc.usage.inputTokens;
    usage.outputTokens += rc.usage.outputTokens;
    addModelUsage(usage.byModel!, modelFor(depth, stage), rc.usage);
  };
  // 다섯 단계가 같은 장부를 봅니다. 조사가 E 번호를, 정제의 계산이 C 번호를 쌓습니다.
  const ctx = new ResearchContext({ onStep: (step) => emit({ type: "step", step }) });

  // 📋 분류. 실패하면 규칙 기반 기본 계획. 모드는 의도로 코드가 정합니다.
  emit({ type: "stage", stage: "plan", status: "start" });
  const planCtx = new RunContext(ctx);
  // 미국 상장 ETF(QQQ · SPY 등)만 묻는 질문은 국내 ETF tool 로 조회할 수 없어, 분류 모델을 부르지 않고 범위 밖으로 안내합니다.
  const foreign = foreignEtfOutput(question);
  // 개별 기업의 주가를 묻는 질문은 조회할 자료가 없습니다. 분류가 뉴스 tool 로 보내 빈 리포트가 나오던 것을 범위 밖 안내로 돌립니다 (11/21 점검: "삼성전자 주가 어때?")
  const stock = !foreign && isStockQuestion(question);
  const planned = foreign
    ? { intent: "out_of_scope" as const, tools: [], reason: "미국 상장 ETF 는 조회할 수 없음" }
    : stock
      ? { intent: "out_of_scope" as const, tools: [], reason: "개별 기업의 주가는 조회할 수 없음" }
    : await runPlan(tuned(createPlannerAgent(depth), "plan", depth), planInput(asked, area, depth), planCtx, defaultPlan(question, area));
  addUsage(planCtx, "plan");
  // 분류가 범위 밖이라 해도 지수 tool 로 답할 수 있는 지수 질문("나스닥 요즘 어때?")이면 현황 질문으로 조사합니다 (지수 tool 은 레지스트리에 없어 분류가 모름)
  // 일부만 범위 밖인 질문("물가와 금리 … 선물 시장 조사하기")도 답할 수 있는 부분은 조사합니다 (src/agent/scope-rescue.ts)
  const scope = planned.intent === "out_of_scope" && !foreign && !indexFor(question) ? rescueScope(question) : null;
  const rescuedPlan = planned.intent === "out_of_scope" && !foreign && indexFor(question)
    ? { intent: "status" as const, tools: [areaTools.news], reason: "지수 tool 로 답할 수 있는 지수 질문" }
    : scope
      ? { intent: "status" as const, tools: scope.tools, reason: "범위 밖 대상이 섞였지만 답할 수 있는 부분이 있는 질문" }
      : planned;
  // 판단 요청은 사거나 팔거나 투자할지를 물을 때만입니다. 분류가 "금리 오르면 내 대출 이자 어떻게 돼?" 같은 생활 영향 질문을 판단 요청으로 보내면
  // "투자 판단을 대신하지 않아요" 안내가 엉뚱하게 붙으므로 현황 질문으로 돌립니다 (11/21 점검)
  const settledPlan = rescuedPlan.intent === "decision" && !DECISION_WORDS.test(question) ? { ...rescuedPlan, intent: "status" as const } : rescuedPlan;
  const normalized = normalizePlan(settledPlan, question, area);
  // 질문에 이름이 나온 영역(환율 · 금리 · 물가)의 tool 은 분류가 빠뜨려도 조사에 줍니다 (11/22 QA: "미국 여행 갈 때 환율이 무슨 의미인지" 에 환율 tool 이 빠져 "환율 자료가 없어요")
  const plan = {
    ...normalized,
    ...(settledPlan.intent === "out_of_scope" ? {} : { tools: [...new Set([...normalized.tools, ...mentionedTools(question).filter((t) => t !== areaTools.news)])] }),
    mode: modeFor(settledPlan.intent),
  };
  // 금융 질문에 섞인 범위 밖 부탁("그리고 오늘 저녁 메뉴도 추천해줘")은 답하지 않고 그렇다고 밝힙니다 (scope-rescue.ts)
  const offTopic = plan.mode === "out_of_scope" ? null : offTopicParts(question);
  emit({ type: "plan", intent: plan.intent, mode: plan.mode, tools: plan.tools });
  emit({ type: "stage", stage: "plan", status: "done" });

  if (plan.mode === "out_of_scope") {
    // 조사 · 정제 · 작성을 건너뜁니다. 숫자가 없으니 검증은 pass 이고, 어떤 tool 도 부르지 않았습니다.
    emit({ type: "stage", stage: "verify", status: "start" });
    const output = foreign ?? (stock ? stockOutput(question) : outOfScopeOutput(question));
    const verification = summarizeVerification({ output, checks: [], matches: [], removed: [] }, 0);
    emit({ type: "verify", verification });
    emit({ type: "stage", stage: "verify", status: "done" });
    return {
      report: assembleReport(output, [], verification, { mode: "out_of_scope", intent: "out_of_scope", notice: foreign ? FOREIGN_ETF_NOTICE : stock ? STOCK_NOTICE : OUT_OF_SCOPE_NOTICE }),
      steps: [],
      rewrites: 0,
      plan,
      facts: null,
      model: modelFor(depth, "plan"),
      usage,
    };
  }

  // 🔍 조사. 분류가 고른 tool 만 줍니다. tool 결과는 defineTool 이 장부에 E 번호로 기록합니다.
  emit({ type: "stage", stage: "research", status: "start" });
  const tools = muffinTools.filter((t) => plan.tools.includes(t.name));
  const researchCtx = new RunContext(ctx);
  const notes = await runResearch(tuned(createResearcherAgent(depth, hintAreaFor(area, plan.tools), tools), "research", depth), question, researchCtx);
  addUsage(researchCtx, "research");
  // 환율 원인 질문이면 원인 지도가 필요로 하는 같은 기간 다른 통화 환율을 코드가 채웁니다 (조사가 받아 오지 않은 통화만, src/agent/supplement.ts).
  // 잴 대상은 보강 전에 한 번만 고릅니다. 보강으로 통화가 늘어난 뒤 다시 고르면 대상이 바뀔 수 있습니다 (유로만 있던 장부에 달러가 더해지면 달러로)
  // 출렁임을 묻는 질문("요즘 환율 변동 심해?")은 원인 질문이 아니어도 일별 환율을 받아 하루 변동 폭을 잽니다 (movement.ts dailySwing)
  const swing = isSwingQuestion(question);
  const fxTarget = plan.intent === "cause" || swing ? pickTarget(ctx.evidence, question, area) : undefined;
  if (plan.intent === "cause") {
    await ensureOtherPairs(ctx, question, area, tools, fxTarget);
    // 물가 원인 질문이면 품목군별 등락률 · 기여도를 채웁니다 (src/agent/supplement.ts, 11/19 페르소나 테스트: 물가 "왜" 에 원인 0개)
    await ensureCpiCategories(ctx, question, tools);
  }
  // 관계 질문("물가와 금리 관계", "환율이 오르면 코스피는?")이면 질문이 말한 지표를 모두 같은 1년으로 받아 나란히 볼 수 있게 합니다 (src/agent/relation.ts).
  // 지수 값보다 먼저 받아서, 지수가 든 관계 질문은 공식 종가 · 차트도 같은 1년 자료를 씁니다
  const relation = await ensureRelation(ctx, question, muffinTools);
  // 지수 질문(코스피 · 코스닥 등)이면 공식 종가와, 검산되는 당일 종가(기사 보도)를 장부에 올립니다 (분류가 고르지 않아도 코드가 부름, src/agent/index-quote.ts)
  const index = await ensureIndex(ctx, question);
  // 정책금리의 짧은 기간 변화가 0 이면 1년 전과도 비교할 수 있게 365일로 한 번 더 받습니다 (src/agent/rate-trend.ts)
  // 돈의 가치 질문이면 물가 · 환율을 채웁니다 (money-value.ts)
  const moneyValue = await ensureMoneyValue(ctx, question, muffinTools);
  // 질문이 이름을 댄 영역(환율 · 금리 · 물가)을 조사가 건너뛰었으면 기본 입력으로 채웁니다 (scope-rescue.ts)
  const mentioned = await ensureMentioned(ctx, question, muffinTools);
  // 질문에 적힌 가상의 숫자("3%에서 4%로")는 코드가 계산해 계산 항목으로 올립니다 (example-calc.ts)
  const example = addExampleCalc(ctx, question);
  // 나라를 말하지 않은 정책금리 질문이면 미국 정책금리 1년 비교도 참고로 받습니다 (베타 B2, rate-trend.ts). 관계 질문 · 가상의 숫자 질문은 각자 정한 지표만 봅니다
  const [, rateRef] = await Promise.all([ensureRateYear(ctx, muffinTools, question), relation || example ? Promise.resolve(null) : ensureRateReference(ctx, muffinTools, question)]);
  // 종목을 정하지 않은 ETF 질문("etf 요즘 뭐가 좋아?")이면 자산군별 대표 ETF 의 수익률을 채웁니다 (src/agent/etf-basket.ts)
  const basket = await ensureEtfBasket(ctx, question, muffinTools);
  // 주제 없는 뉴스 질문("오늘 경제 뉴스")이면 경제 흐름 주제어로 찾은 기사를 장부에 보탭니다 (src/agent/news-topics.ts)
  const macroNews = await addMacroNews(ctx, question);
  emit({ type: "stage", stage: "research", status: "done" });

  // ✂️ 정제. 장부 전체와 메모를 보고 사실만 고르고, 차이 · 변동률은 계산 tool 로 C 번호를 받습니다. 실패하면 null.
  // 원인 질문이면 같은 시간에 유의성 게이트가 일별 환율을 받아 이번 움직임이 평소 범위인지 잽니다. 실패해도 리포트는 이어 갑니다.
  emit({ type: "stage", stage: "edit", status: "start" });
  const gate: Promise<MovementResult> = plan.intent === "cause" || swing ? measureMovement(ctx.evidence, { question, area, target: fxTarget }) : Promise.resolve({ movement: null });
  const editCtx = new RunContext(ctx);
  const facts = await runEdit(tuned(createEditorAgent(depth), "edit", depth), editInput(question, plan, ctx.evidence, notes), editCtx);
  addUsage(editCtx, "edit");
  // 게이트 결과는 정제가 끝난 뒤 장부에 올려서 C 번호가 정제의 계산 다음에 오게 합니다.
  const { movement, step: gateStep } = await gate;
  if (gateStep) ctx.addStep(gateStep);
  const movementId = movement ? ctx.nextCalcId() : "";
  if (movement) ctx.addEvidence([movementEvidence(movement, movementId)]);
  // 게이트가 받은 일별 환율로 차트 (최근 30일 선 · 평소 폭 띠 · 기간 안의 뉴스 점). 코드가 만든 것이라 검증 대상이 아닙니다
  // 차트: 환율 원인 질문은 평소 폭 띠가 있는 환율 차트, 지수 질문은 비교 기간의 지수 선
  const indexItem = index ? officialIndex(ctx.evidence, index) : undefined;
  const chart = movement ? fxChart(movement, movementId, ctx.evidence) : indexItem ? indexChart(indexItem, ctx.raw.get(indexItem.id)) : null;
  emit({ type: "stage", stage: "edit", status: "done" });

  // ✍️ 작성. tool 없이 사실 목록(없으면 장부 전체)만 봅니다. 움직임을 쟀으면 [움직임 크기] 를 덧붙입니다.
  emit({ type: "stage", stage: "write", status: "start" });
  const writer = tuned(createWriterAgent(depth, area, plan.mode), "write", depth);
  // 작성이 [증거 장부] 에서 보는 id (writerInput 과 같은 기준). null 이면 장부 전체를 봅니다.
  const shown = facts && facts.facts.length > 0 ? new Set(facts.facts.map((f) => f.ref)) : null;
  const dropped = new Set(facts?.dropped.map((d) => d.ref) ?? []);
  // 큰 움직임이면 정제가 뺀 자료도 원인 후보 근거로 다시 보므로(movement.ts), 그 항목은 "쓰지 않은 자료" 목록에서 뺍니다 (두 안내가 어긋나지 않게)
  const rescued = movement ? rescuedRefs(movement, ctx.evidence, dropped) : new Set<string>();
  // 물가 품목군 항목도 정제가 뺐더라도 원인 후보로 다시 봅니다 (src/agent/cpi.ts)
  if (plan.intent === "cause") for (const id of cpiRescuedRefs(ctx.evidence, dropped)) rescued.add(id);
  // 지수 값을 가진 항목도 정제가 뺐더라도 [지수 값] 으로 다시 보여 주므로 "쓰지 않은 자료" 에서 뺍니다
  // 코드가 조사 뒤에 채운 항목들. 정제가 뺐더라도 "쓰지 않은 자료" 로 알리지 않고, 작성의 사실 목록에 넣어 인용할 수 있게 합니다 (src/agent/extra-facts.ts)
  const ensured = new Set<string>([
    ...(index ? indexRefs(ctx.evidence, index) : []),
    ...yearRates(ctx.evidence).map((e) => e.id),
    ...(rateRef ? [rateRef] : []),
    ...macroNews.map((e) => e.id),
    ...(basket ? basketRows(ctx.evidence).map((r) => r.e.id) : []),
    ...(relation ? relationRefs(ctx.evidence, relation) : []),
    ...(moneyValue ? moneyValueRows(ctx.evidence).map((e) => e.id) : []),
    ...mentioned,
  ]);
  for (const id of ensured) rescued.add(id);
  const writerFacts = withEnsuredFacts(facts, ctx.evidence, ensured);
  // 정제가 뺀 자료는 작성이 못 보므로(writerInput), 이름 · 기준일 · 이유만 따로 알려 "자료 없음" 으로 적지 않게 합니다 (dropped.ts)
  // 방향이 반대라 정제가 거른 계산(edit.ts reversedCalcIds)은 작성에 보이지 않게 합니다. 사실 목록이 비거나 정제가 실패해 작성이 장부 전체를 볼 때도
  // 뒤집힌 부호의 숫자가 되살아나지 않습니다 (#117 Codex 리뷰). 검증은 장부 전체로 그대로 합니다.
  const reversed = reversedCalcIds(ctx.evidence);
  // 관계 질문은 1년 비교에 쓴 항목 말고 같은 지표의 다른 기간 항목(30일 환율 등)도 작성에 보이지 않게 합니다 (카드는 1년, 요약은 30일이 되지 않게, relation.ts).
  // 움직임을 잰 원인 질문은 [움직임 크기] 가 30일 자료를 가리키므로 그대로 둡니다
  const sameIndicator = relation && !movement ? relationHidden(ctx.evidence, relation) : new Set<string>();
  const hidden = new Set([...reversed, ...sameIndicator]);
  // 숨긴 항목은 "정제가 뺀 자료" 목록에도 올리지 않습니다 (작성이 "30일 자료는 쓰지 않았어요" 라고 적지 않게)
  for (const id of sameIndicator) rescued.add(id);
  const writerLedger = hidden.size > 0 ? ctx.evidence.filter((e) => !hidden.has(e.id)) : ctx.evidence;
  const writerFactsShown = writerFacts && hidden.size > 0 ? { ...writerFacts, facts: writerFacts.facts.filter((f) => !hidden.has(f.ref)) } : writerFacts;
  // 조사 · 정제가 각각 쓴 "확인하지 못한 것" 을 합쳐 줄인 뒤 넘깁니다 (같은 말 · 작업 과정 줄 제외, src/agent/trim.ts)
  const gapInputs = trimGapInputs([...notes.gaps, ...(facts?.unverified ?? [])]);
  const writerNotes = { ...notes, gaps: gapInputs };
  const input = [writerInput(question, writerLedger, writerNotes, writerFactsShown ? { ...writerFactsShown, unverified: [] } : writerFactsShown), droppedNote(facts, ctx.evidence, rescued), movement ? movementNote(movement, movementId, ctx.evidence, shown, dropped) : "", movement && swing ? swingNote(movement, movementId) : "", plan.intent === "cause" ? cpiCauseNote(ctx.evidence, shown, question) : "", index ? indexNote(ctx.evidence, index) : "", rateYearNote(ctx.evidence), rateReferenceNote(ctx.evidence, rateRef), newsCardNote(ctx.evidence), macroNewsNote(macroNews), relation ? relationNote(ctx.evidence, relation) : "", basket ? basketNote(ctx.evidence) : "", scope ? scopeNote(scope) : "", offTopic ? offTopicNote(offTopic) : "", moneyValue ? moneyValueNote(ctx.evidence) : "", example ? exampleNote(example) : ""]
    .filter(Boolean)
    .join("\n\n");
  const writeCtx = new RunContext(ctx);
  // 지수 질문이면 지수 종가 · 기간 수익률은 작성이 빠뜨려도 코드가 "오늘의 숫자" 에 넣습니다 (실측: 3번 중 1번 빠뜨림). 검증 전이라 장부와 대조됩니다
  // 기사 항목을 가리키는 숫자 카드는 뺍니다 (검산되지 않은 기사 숫자가 "확인한 숫자" 자리에 오르지 않게, src/agent/news-numbers.ts)
  const indexed = (o: WriterOutput) => {
    let out = index ? withIndexNumbers(o, ctx.evidence, index) : o;
    if (relation) out = withRelationNumbers(out, ctx.evidence, relation);
    if (rateRef) out = withRateReference(out, ctx.evidence, rateRef);
    if (basket) out = withBasketNumbers(out, ctx.evidence);
    if (example) out = withExampleNumbers(out, example);
    if (movement && swing) out = withSwingNumbers(out, movement, movementId);
    return mergeSameCards(dropNewsCards(out, ctx.evidence));
  };
  let output = indexed(await runWriter(writer, input, writeCtx));
  addUsage(writeCtx, "write");
  emit({ type: "stage", stage: "write", status: "done" });

  // ✅ 검증. 실패하면 실패 목록을 들고 작성에게 1회 수정 요청. 그래도 남으면 applyVerification 이 뺍니다.
  // 다시 쓰기는 10초 남짓 걸립니다. 마감이 가까우면 다시 쓰지 않고 바로 뺍니다 (시간 초과로 리포트가 아예 안 나가는 것보다 낫습니다).
  emit({ type: "stage", stage: "verify", status: "start" });
  let result = verify(output, ctx.evidence);
  let revisions = 0;
  const revisionSkipped = !result.ok && Date.now() + REVISION_RESERVE_MS > deadline;
  // 첫 초안이 걸린 이유. 다시 쓰기가 돌든 건너뛰든 로그에 남깁니다
  const rewriteReasons = result.ok ? undefined : result.failures.map((f) => (f.length > 200 ? `${f.slice(0, 200)}…` : f));
  if (!result.ok && !revisionSkipped) {
    revisions = 1;
    const reviseCtx = new RunContext(ctx);
    output = indexed(await runWriter(writer, `${input}\n\n${draftNote(output)}\n\n${revisionNote(result.failures)}`, reviseCtx));
    addUsage(reviseCtx, "write");
    result = verify(output, ctx.evidence);
  }
  const applied = applyVerification(output, result);
  const verification = summarizeVerification(applied, revisions, revisionSkipped);
  emit({ type: "verify", verification });
  emit({ type: "stage", stage: "verify", status: "done" });
  // 조회가 실패해 저장된 응답을 쓴 tool 은 코드가 "확인하지 못한 것" 에 적습니다 (검증 뒤라 검증 대상이 아님)
  const gaps = fallbackGaps(ctx.steps);
  // 환율 자료를 썼으면 어떤 환율인지(포털 · 은행 앱과 다를 수 있음)를 코드가 "주의점" 에 적습니다
  // 같은 한계를 주의점 · 확인하지 못한 것에 되풀이한 줄을 줄입니다 (src/agent/trim.ts). 코드가 넣는 줄은 그 뒤에 붙여 줄어들지 않습니다
  // 한 줄 요약 끝의 "…지만 확인되지 않아요" 와, 원인을 묻지 않은 질문의 "원인은 확인할 수 없어요" 문장을 뗍니다 (src/agent/negatives.ts)
  // 관계 질문은 요약에 되풀이된 "상관관계 · 인과관계는 판단할 수 없어요" 와 받지 않는 지표의 한계 문장을 주의점 · 확인하지 못한 것 한 곳으로 모읍니다 (relation.ts)
  const negTrimmed = trimRepeats(trimNegatives(offTopic ? dropOffTopic(applied.output, offTopic) : applied.output, plan.intent));
  const trimmed = relation ? trimRelationRepeats(negTrimmed, relation) : negTrimmed;
  const fxNotes = fxBasisCaveats(ctx.evidence, trimmed.caveats);
  const finalOutput = {
    ...trimmed,
    // 관계 질문의 한 줄은 꼬리를 떼기 전의 원래 문장으로 판단합니다. 뗀 뒤에는 "금리 차이는 환율에 영향을 줄 수 있어요." 처럼 숫자 없는 일반론만 남아
    // 바꿀 조건에 걸리지 않았습니다 (11/22 운영 14번)
    ...(relation ? { headline: relationHeadline(applied.output.headline, ctx.evidence, relation) } : {}),
    caveats: [...trimmed.caveats, ...fxNotes, ...(index ? indexCaveats(ctx.evidence, index, trimmed.caveats) : [])],
    // 범위 밖 부탁이 있으면 그 한 줄이 더 구체적이라 일반 범위 안내는 넣지 않습니다 (같은 말이 두 줄)
    dataGaps: [...trimmed.dataGaps, ...(offTopic ? [offTopicGap(offTopic)] : scope ? [scopeGap(scope)] : []), ...gaps],
  };

  return {
    report: assembleReport(finalOutput, ctx.evidence, verification, {
      mode: plan.mode,
      intent: plan.intent,
      ...(plan.mode === "decision_facts" ? { notice: DECISION_NOTICE } : movement ? { notice: movementNotice(movement, swing) } : {}),
      checks: applied.checks,
      matches: applied.matches,
      changes: changeDetailsFor(applied, ctx.evidence),
      ...(movement ? { movement: movementSummary(movement) } : {}),
      ...(chart ? { charts: [chart] } : {}),
    }),
    steps: ctx.steps,
    rewrites: revisions,
    ...(rewriteReasons ? { rewriteReasons } : {}),
    plan,
    facts,
    edit: summarizeEdit(facts, reversed.size),
    model: modelFor(depth),
    usage,
  };
}
