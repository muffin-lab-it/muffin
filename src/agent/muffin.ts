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
import { fxChart } from "./chart";
import { ResearchContext, type ToolStep } from "./context";
import { createEditorAgent, editInput, reversedCalcIds, runEdit } from "./edit";
import type { MuffinEvent } from "./events";
import { modelFor, modelSettingsFor, type ModelStage } from "./models";
import { areaTools, createPlannerAgent, defaultPlan, normalizePlan, planInput, runPlan } from "./plan";
import { changeDetailsFor } from "./change";
import { droppedNote } from "./dropped";
import { addModelUsage, type UsageSummary } from "../lib/pricing";
import { ensureCpiCategories, ensureOtherPairs } from "./supplement";
import { cpiCauseNote, cpiRescuedRefs } from "./cpi";
import { DECISION_NOTICE, OUT_OF_SCOPE_NOTICE, assembleReport, fallbackGaps, outOfScopeOutput } from "./report";
import { measureMovement, movementEvidence, movementNote, movementNotice, movementSummary, pickTarget, rescuedRefs, type MovementResult } from "./movement";
import { createResearcherAgent, runResearch } from "./research";
import { modeFor, type Area, type Depth, type FactsOutput, type PlanOutput, type Report, type ReportMode, type WriterOutput } from "./schema";
import { applyVerification, summarizeVerification, verify } from "./verify";
import { createWriterAgent, revisionNote, runWriter, writerInput } from "./write";

export { modelFor } from "./models";

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

async function runStages({ question, depth, area }: ResearchInput, { onEvent, deadline }: ResearchOptions & { deadline: number }): Promise<ResearchResult> {
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
  const planned = await runPlan(tuned(createPlannerAgent(depth), "plan", depth), planInput(question, area, depth), planCtx, defaultPlan(question, area));
  addUsage(planCtx, "plan");
  const plan = { ...normalizePlan(planned, question, area), mode: modeFor(planned.intent) };
  emit({ type: "plan", intent: plan.intent, mode: plan.mode, tools: plan.tools });
  emit({ type: "stage", stage: "plan", status: "done" });

  if (plan.mode === "out_of_scope") {
    // 조사 · 정제 · 작성을 건너뜁니다. 숫자가 없으니 검증은 pass 이고, 어떤 tool 도 부르지 않았습니다.
    emit({ type: "stage", stage: "verify", status: "start" });
    const output = outOfScopeOutput(question);
    const verification = summarizeVerification({ output, checks: [], matches: [], removed: [] }, 0);
    emit({ type: "verify", verification });
    emit({ type: "stage", stage: "verify", status: "done" });
    return {
      report: assembleReport(output, [], verification, { mode: "out_of_scope", notice: OUT_OF_SCOPE_NOTICE }),
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
  const fxTarget = plan.intent === "cause" ? pickTarget(ctx.evidence, question, area) : undefined;
  if (plan.intent === "cause") {
    await ensureOtherPairs(ctx, question, area, tools, fxTarget);
    // 물가 원인 질문이면 품목군별 등락률 · 기여도를 채웁니다 (src/agent/supplement.ts, 11/19 페르소나 테스트: 물가 "왜" 에 원인 0개)
    await ensureCpiCategories(ctx, question, tools);
  }
  emit({ type: "stage", stage: "research", status: "done" });

  // ✂️ 정제. 장부 전체와 메모를 보고 사실만 고르고, 차이 · 변동률은 계산 tool 로 C 번호를 받습니다. 실패하면 null.
  // 원인 질문이면 같은 시간에 유의성 게이트가 일별 환율을 받아 이번 움직임이 평소 범위인지 잽니다. 실패해도 리포트는 이어 갑니다.
  emit({ type: "stage", stage: "edit", status: "start" });
  const gate: Promise<MovementResult> = plan.intent === "cause" ? measureMovement(ctx.evidence, { question, area, target: fxTarget }) : Promise.resolve({ movement: null });
  const editCtx = new RunContext(ctx);
  const facts = await runEdit(tuned(createEditorAgent(depth), "edit", depth), editInput(question, plan, ctx.evidence, notes), editCtx);
  addUsage(editCtx, "edit");
  // 게이트 결과는 정제가 끝난 뒤 장부에 올려서 C 번호가 정제의 계산 다음에 오게 합니다.
  const { movement, step: gateStep } = await gate;
  if (gateStep) ctx.addStep(gateStep);
  const movementId = movement ? ctx.nextCalcId() : "";
  if (movement) ctx.addEvidence([movementEvidence(movement, movementId)]);
  // 게이트가 받은 일별 환율로 차트 (최근 30일 선 · 평소 폭 띠 · 기간 안의 뉴스 점). 코드가 만든 것이라 검증 대상이 아닙니다
  const chart = movement ? fxChart(movement, movementId, ctx.evidence) : null;
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
  // 정제가 뺀 자료는 작성이 못 보므로(writerInput), 이름 · 기준일 · 이유만 따로 알려 "자료 없음" 으로 적지 않게 합니다 (dropped.ts)
  // 방향이 반대라 정제가 거른 계산(edit.ts reversedCalcIds)은 작성에 보이지 않게 합니다. 사실 목록이 비거나 정제가 실패해 작성이 장부 전체를 볼 때도
  // 뒤집힌 부호의 숫자가 되살아나지 않습니다 (#117 Codex 리뷰). 검증은 장부 전체로 그대로 합니다.
  const reversed = reversedCalcIds(ctx.evidence);
  const writerLedger = reversed.size > 0 ? ctx.evidence.filter((e) => !reversed.has(e.id)) : ctx.evidence;
  const input = [writerInput(question, writerLedger, notes, facts), droppedNote(facts, ctx.evidence, rescued), movement ? movementNote(movement, movementId, ctx.evidence, shown, dropped) : "", plan.intent === "cause" ? cpiCauseNote(ctx.evidence, shown, question) : ""]
    .filter(Boolean)
    .join("\n\n");
  const writeCtx = new RunContext(ctx);
  let output = await runWriter(writer, input, writeCtx);
  addUsage(writeCtx, "write");
  emit({ type: "stage", stage: "write", status: "done" });

  // ✅ 검증. 실패하면 실패 목록을 들고 작성에게 1회 수정 요청. 그래도 남으면 applyVerification 이 뺍니다.
  // 다시 쓰기는 10초 남짓 걸립니다. 마감이 가까우면 다시 쓰지 않고 바로 뺍니다 (시간 초과로 리포트가 아예 안 나가는 것보다 낫습니다).
  emit({ type: "stage", stage: "verify", status: "start" });
  let result = verify(output, ctx.evidence);
  let revisions = 0;
  const revisionSkipped = !result.ok && Date.now() + REVISION_RESERVE_MS > deadline;
  if (!result.ok && !revisionSkipped) {
    revisions = 1;
    const reviseCtx = new RunContext(ctx);
    output = await runWriter(writer, `${input}\n\n${draftNote(output)}\n\n${revisionNote(result.failures)}`, reviseCtx);
    addUsage(reviseCtx, "write");
    result = verify(output, ctx.evidence);
  }
  const applied = applyVerification(output, result);
  const verification = summarizeVerification(applied, revisions, revisionSkipped);
  emit({ type: "verify", verification });
  emit({ type: "stage", stage: "verify", status: "done" });
  // 조회가 실패해 저장된 응답을 쓴 tool 은 코드가 "확인하지 못한 것" 에 적습니다 (검증 뒤라 검증 대상이 아님)
  const gaps = fallbackGaps(ctx.steps);
  const finalOutput = gaps.length ? { ...applied.output, dataGaps: [...applied.output.dataGaps, ...gaps] } : applied.output;

  return {
    report: assembleReport(finalOutput, ctx.evidence, verification, {
      mode: plan.mode,
      ...(plan.mode === "decision_facts" ? { notice: DECISION_NOTICE } : movement ? { notice: movementNotice(movement) } : {}),
      checks: applied.checks,
      matches: applied.matches,
      changes: changeDetailsFor(applied, ctx.evidence),
      ...(movement ? { movement: movementSummary(movement) } : {}),
      ...(chart ? { charts: [chart] } : {}),
    }),
    steps: ctx.steps,
    rewrites: revisions,
    plan,
    facts,
    edit: summarizeEdit(facts, reversed.size),
    model: modelFor(depth),
    usage,
  };
}
