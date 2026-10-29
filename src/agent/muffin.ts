/**
 * 다섯 단계 오케스트레이션. 리더 관리. 순서는 여기서 고정하고, 모델은 각 단계 파일 안에서만 판단합니다.
 *
 *   📋 plan.ts (서영)  →  🔍 research.ts (소희)  →  ✂️ edit.ts (은경)  →  ✍️ write.ts (은선) + depth.ts (하니)  →  ✅ verify.ts (코드)
 *
 * 단계 사이를 잇는 것은 증거 장부(ResearchContext.evidence)입니다. 조사의 tool 결과는 E 번호, 정제의 계산은 C 번호로 올라가고,
 * 작성은 그 번호를 인용하고, 검증은 번호로 원본과 대조합니다. 검증 실패는 작성에게만 1회 되돌립니다 (조사 · 정제로 되돌아가지 않음).
 * 네 Agent 실행은 withTrace 로 한 묶음이라 OpenAI Traces 에서 한 요청으로 보입니다.
 */
import { RunContext, withTrace, type Agent, type AgentOutputType } from "@openai/agents";
import { muffinTools } from "../tools";
import { ResearchContext, type ToolStep } from "./context";
import { createEditorAgent, editInput, runEdit } from "./edit";
import type { MuffinEvent } from "./events";
import { modelFor, modelSettingsFor, type ModelStage } from "./models";
import { createPlannerAgent, defaultPlan, normalizePlan, planInput, runPlan } from "./plan";
import { DECISION_NOTICE, OUT_OF_SCOPE_NOTICE, assembleReport, outOfScopeOutput } from "./report";
import { createResearcherAgent, runResearch } from "./research";
import { modeFor, type Area, type Depth, type FactsOutput, type PlanOutput, type Report, type ReportMode } from "./schema";
import { applyVerification, summarizeVerification, verify } from "./verify";
import { createWriterAgent, revisionNote, runWriter, writerInput } from "./write";

export { modelFor } from "./models";

/** 스트림 라우트의 마감(STREAM_TIMEOUT_MS 55초)과 같은 기본 예산. research() 를 부른 시각부터 셉니다. */
export const TIME_BUDGET_MS = 55_000;
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
  /** 조사 · 작성에 쓴 모델과 토큰 (네 단계 합계). 로그·비용 추적용 */
  model?: string;
  usage?: { requests: number; inputTokens: number; outputTokens: number };
};

/**
 * 백엔드 팀은 이 함수만 호출합니다. 입력 모양은 고정이고, 진행 이벤트는 onEvent 로 받습니다.
 *
 * 📋 분류(의도 · tool 선택 · 모드) → 범위 밖이면 고정 안내로 끝 → 🔍 조사(tool + 메모) → ✂️ 정제(사실 고르기 + 계산) →
 * ✍️ 작성(사실 목록만 보고) → ✅ 검증(코드) → 실패하면 작성에 1회 수정 요청 → 그래도 남은 실패는 리포트에서 빼고 verification.removed 에 기록.
 * 수정 때 tool 을 다시 부르지 않아 증거 번호가 유지됩니다. 분류 · 정제가 실패해도 리포트는 나옵니다 (기본 계획 · 장부 전체).
 */
export async function research(input: ResearchInput, options: ResearchOptions = {}): Promise<ResearchResult> {
  const deadline = options.deadline ?? Date.now() + TIME_BUDGET_MS;
  return withTrace("Muffin research", () => runStages(input, { ...options, deadline }));
}

async function runStages({ question, depth, area }: ResearchInput, { onEvent, deadline }: ResearchOptions & { deadline: number }): Promise<ResearchResult> {
  const emit = (event: MuffinEvent) => onEvent?.(event);
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  const addUsage = (rc: RunContext<ResearchContext>) => {
    usage.requests += rc.usage.requests;
    usage.inputTokens += rc.usage.inputTokens;
    usage.outputTokens += rc.usage.outputTokens;
  };
  // 다섯 단계가 같은 장부를 봅니다. 조사가 E 번호를, 정제의 계산이 C 번호를 쌓습니다.
  const ctx = new ResearchContext({ onStep: (step) => emit({ type: "step", step }) });

  // 📋 분류. 실패하면 규칙 기반 기본 계획. 모드는 의도로 코드가 정합니다.
  emit({ type: "stage", stage: "plan", status: "start" });
  const planCtx = new RunContext(ctx);
  const planned = await runPlan(tuned(createPlannerAgent(depth), "plan", depth), planInput(question, area, depth), planCtx, defaultPlan(question, area));
  addUsage(planCtx);
  const plan = { ...normalizePlan(planned, question, area), mode: modeFor(planned.intent) };
  emit({ type: "plan", intent: plan.intent, mode: plan.mode, tools: plan.tools });
  emit({ type: "stage", stage: "plan", status: "done" });

  if (plan.mode === "out_of_scope") {
    // 조사 · 정제 · 작성을 건너뜁니다. 숫자가 없으니 검증은 pass 이고, 어떤 tool 도 부르지 않았습니다.
    emit({ type: "stage", stage: "verify", status: "start" });
    const output = outOfScopeOutput(question);
    const verification = summarizeVerification({ output, checks: [], removed: [] }, 0);
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
  const notes = await runResearch(tuned(createResearcherAgent(depth, area, tools), "research", depth), question, researchCtx);
  addUsage(researchCtx);
  emit({ type: "stage", stage: "research", status: "done" });

  // ✂️ 정제. 장부 전체와 메모를 보고 사실만 고르고, 차이 · 변동률은 계산 tool 로 C 번호를 받습니다. 실패하면 null.
  emit({ type: "stage", stage: "edit", status: "start" });
  const editCtx = new RunContext(ctx);
  const facts = await runEdit(tuned(createEditorAgent(depth), "edit", depth), editInput(question, plan, ctx.evidence, notes), editCtx);
  addUsage(editCtx);
  emit({ type: "stage", stage: "edit", status: "done" });

  // ✍️ 작성. tool 없이 사실 목록(없으면 장부 전체)만 봅니다.
  emit({ type: "stage", stage: "write", status: "start" });
  const writer = tuned(createWriterAgent(depth, area, plan.mode), "write", depth);
  const input = writerInput(question, ctx.evidence, notes, facts);
  const writeCtx = new RunContext(ctx);
  let output = await runWriter(writer, input, writeCtx);
  addUsage(writeCtx);
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
    output = await runWriter(writer, `${input}\n\n${revisionNote(result.failures)}`, reviseCtx);
    addUsage(reviseCtx);
    result = verify(output, ctx.evidence);
  }
  const applied = applyVerification(output, result);
  const verification = summarizeVerification(applied, revisions, revisionSkipped);
  emit({ type: "verify", verification });
  emit({ type: "stage", stage: "verify", status: "done" });

  return {
    report: assembleReport(applied.output, ctx.evidence, verification, {
      mode: plan.mode,
      ...(plan.mode === "decision_facts" ? { notice: DECISION_NOTICE } : {}),
      checks: applied.checks,
    }),
    steps: ctx.steps,
    rewrites: revisions,
    plan,
    facts,
    model: modelFor(depth),
    usage,
  };
}
