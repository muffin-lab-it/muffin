import { Agent, RunContext, run } from "@openai/agents";
import { muffinTools } from "../tools";
import { ResearchContext, type ToolStep } from "./context";
import type { MuffinEvent } from "./events";
import { findAdvice } from "./guard";
import { instructionsFor } from "./instructions";
import { assembleReport, summarizeWhy } from "./report";
import { writerSchema, type Area, type Depth, type Report, type Verification, type WriterOutput } from "./schema";

/**
 * 깊이별 모델. Deep Dive 만 상위 모델을 씁니다. .env 로 바꿀 수 있습니다.
 * OpenAI 가 gpt-4.1 계열 폐기를 공지(2026-10-14, 2027-01-14 종료)해서 기본값은 gpt-6 계열입니다. 3단계 모델 비교로 확정합니다.
 */
export function modelFor(depth: Depth): string {
  if (depth === "deep") return process.env.OPENAI_MODEL_DEEP || process.env.OPENAI_MODEL || "gpt-6-sol";
  return process.env.OPENAI_MODEL || "gpt-6-luna";
}

export function createMuffinAgent(depth: Depth, area?: Area, extraInstructions = "") {
  return new Agent<ResearchContext, typeof writerSchema>({
    name: "Muffin Research Agent",
    model: modelFor(depth),
    instructions: [instructionsFor(depth, area), extraInstructions].filter(Boolean).join("\n\n"),
    tools: muffinTools,
    outputType: writerSchema,
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
  /** 권유 표현 검사에 걸려 다시 쓴 횟수 */
  rewrites: number;
  /** 사용한 모델과 토큰 (재작성 포함 합계). 로그·비용 추적용 */
  model?: string;
  usage?: { requests: number; inputTokens: number; outputTokens: number };
};

/**
 * 백엔드 팀은 이 함수만 호출합니다. 입력 모양은 고정이고, 진행 이벤트는 onEvent 로 받습니다.
 *
 * 0단계: 조사와 작성을 한 Agent 가 합니다 (1단계에서 작성 · 검증을 분리). 검증은 권유 표현만 세고
 * 숫자 대조 · 근거 판정은 아직 없어서 verification.status 는 skipped, 숫자는 모두 unverified 로 나갑니다.
 */
export async function research(
  { question, depth, area }: ResearchInput,
  { onEvent }: ResearchOptions = {},
): Promise<ResearchResult> {
  const emit = (event: MuffinEvent) => onEvent?.(event);
  const steps: ToolStep[] = [];
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  let extra = "";
  let rewrites = 0;
  let output: WriterOutput | undefined;
  let ctx: ResearchContext | undefined;

  emit({ type: "stage", stage: "research", status: "start" });
  // 권유 표현이 걸리면 한 번만 다시 씁니다. 두 번째도 걸리면 그대로 내보내고 rewrites 로 표시합니다.
  // 재작성은 tool 을 다시 부르므로 증거 번호가 새로 시작되고, 진행 화면에는 첫 실행의 step 만 보냅니다.
  for (let attempt = 0; attempt < 2; attempt++) {
    const first = attempt === 0;
    ctx = new ResearchContext({ onStep: (step) => (first ? emit({ type: "step", step }) : undefined) });
    const runCtx = new RunContext(ctx);
    const agent = createMuffinAgent(depth, area, extra);
    const result = await run(agent, question, { context: runCtx });
    if (!result.finalOutput) throw new Error("Agent 가 리포트를 생성하지 못했습니다.");
    output = result.finalOutput;
    steps.push(...ctx.steps);
    usage.requests += runCtx.usage.requests;
    usage.inputTokens += runCtx.usage.inputTokens;
    usage.outputTokens += runCtx.usage.outputTokens;

    const flagged = findAdvice(output);
    if (flagged.length === 0) break;
    rewrites++;
    extra = `[재작성] 아래 문장에 투자 권유 표현이 있습니다. 같은 데이터로 리포트를 다시 쓰되, 행동 지시 없이 "무엇을 뜻하는지" 까지만 쓰세요.\n- ${flagged.join("\n- ")}`;
  }
  emit({ type: "stage", stage: "research", status: "done" });

  emit({ type: "stage", stage: "verify", status: "start" });
  const final = output!;
  const verification: Verification = {
    status: "skipped",
    numbers: { total: final.numbers.length, verified: 0, derived: 0, unverified: final.numbers.length },
    why: summarizeWhy(final.why),
    advice: findAdvice(final).length,
    revisions: rewrites,
    removed: [],
  };
  emit({ type: "verify", verification });
  emit({ type: "stage", stage: "verify", status: "done" });

  return {
    report: assembleReport(final, ctx!.evidence, verification),
    steps,
    rewrites,
    model: modelFor(depth),
    usage,
  };
}
