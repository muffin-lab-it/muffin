import { Agent, RunContext, run } from "@openai/agents";
import { muffinTools } from "../tools";
import { ResearchContext, type ToolStep } from "./context";
import type { MuffinEvent } from "./events";
import { researcherInstructions } from "./instructions";
import { modelFor } from "./models";
import { assembleReport } from "./report";
import { researchNotesSchema, type Area, type Depth, type Report, type ResearchNotes } from "./schema";
import { applyVerification, summarizeVerification, verify } from "./verify";
import { createWriterAgent, revisionNote, runWriter, writerInput } from "./writer";

export { modelFor } from "./models";

/** ② 조사 Agent. tool 을 부르고 결과마다 조사 메모를 남깁니다. 리포트는 쓰지 않습니다. */
export function createResearcherAgent(depth: Depth, area?: Area) {
  return new Agent<ResearchContext, typeof researchNotesSchema>({
    name: "Muffin Researcher",
    model: modelFor(depth),
    instructions: researcherInstructions(area),
    tools: muffinTools,
    outputType: researchNotesSchema,
  });
}

export type ResearchInput = { question: string; depth: Depth; area?: Area };
export type ResearchOptions = {
  /** 진행 이벤트 (stage · plan · step · verify). report · error 는 라우트가 요청 id 를 붙여 보냅니다 */
  onEvent?: (event: MuffinEvent) => void;
};
export type ResearchResult = {
  report: Report;
  /** 어떤 tool 을 불렀고 성공했는지. 진행상황 화면·디버깅용 */
  steps: ToolStep[];
  /** 검증 실패로 작성 Agent 가 다시 쓴 횟수 (최대 1) */
  rewrites: number;
  /** 사용한 모델과 토큰 (조사 · 작성 · 수정 합계). 로그·비용 추적용 */
  model?: string;
  usage?: { requests: number; inputTokens: number; outputTokens: number };
};

/**
 * 백엔드 팀은 이 함수만 호출합니다. 입력 모양은 고정이고, 진행 이벤트는 onEvent 로 받습니다.
 *
 * 1단계: ② 조사(tool + 조사 메모) → ③ 작성(장부 · 메모만 보고) → ④ 검증(코드) → 실패하면 ③ 에 1회 수정 요청 →
 * 그래도 남은 실패는 리포트에서 빼고 verification.removed 에 기록합니다. 수정 때 tool 을 다시 부르지 않아 증거 번호가 유지됩니다.
 * ① 접수(의도 분류 · plan 이벤트)는 2단계, 원인의 근거 판정(모델)은 3단계입니다.
 */
export async function research(
  { question, depth, area }: ResearchInput,
  { onEvent }: ResearchOptions = {},
): Promise<ResearchResult> {
  const emit = (event: MuffinEvent) => onEvent?.(event);
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  const addUsage = (rc: RunContext<ResearchContext>) => {
    usage.requests += rc.usage.requests;
    usage.inputTokens += rc.usage.inputTokens;
    usage.outputTokens += rc.usage.outputTokens;
  };

  // ② 조사. tool 결과는 defineTool 이 증거 장부(ctx.evidence)에 E 번호로 기록합니다.
  emit({ type: "stage", stage: "research", status: "start" });
  const ctx = new ResearchContext({ onStep: (step) => emit({ type: "step", step }) });
  const researchCtx = new RunContext(ctx);
  const researched = await run(createResearcherAgent(depth, area), question, { context: researchCtx });
  addUsage(researchCtx);
  const notes: ResearchNotes = researched.finalOutput ?? { notes: [], gaps: ["조사 Agent 가 조사 메모를 남기지 못했습니다."] };
  emit({ type: "stage", stage: "research", status: "done" });

  // ③ 작성. tool 없이 장부와 메모만 봅니다.
  emit({ type: "stage", stage: "write", status: "start" });
  const writer = createWriterAgent(depth, area);
  const input = writerInput(question, ctx.evidence, notes);
  const writeCtx = new RunContext(ctx);
  let output = await runWriter(writer, input, writeCtx);
  addUsage(writeCtx);
  emit({ type: "stage", stage: "write", status: "done" });

  // ④ 검증. 실패하면 실패 목록을 들고 작성에게 1회 수정 요청. 그래도 남으면 applyVerification 이 뺍니다.
  emit({ type: "stage", stage: "verify", status: "start" });
  let result = verify(output, ctx.evidence);
  let revisions = 0;
  if (!result.ok) {
    revisions = 1;
    const reviseCtx = new RunContext(ctx);
    output = await runWriter(writer, `${input}\n\n${revisionNote(result.failures)}`, reviseCtx);
    addUsage(reviseCtx);
    result = verify(output, ctx.evidence);
  }
  const applied = applyVerification(output, result);
  const verification = summarizeVerification(applied, revisions);
  emit({ type: "verify", verification });
  emit({ type: "stage", stage: "verify", status: "done" });

  return {
    report: assembleReport(applied.output, ctx.evidence, verification, { checks: applied.checks }),
    steps: ctx.steps,
    rewrites: revisions,
    model: modelFor(depth),
    usage,
  };
}
