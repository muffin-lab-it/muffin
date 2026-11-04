/**
 * Mock 모드. MUFFIN_MOCK=1 이면 OpenAI 와 tool 을 부르지 않고 저장된 샘플 리포트 v2 를 돌려줍니다.
 * 스트림 라우트에서는 plan → research(step) → edit(계산 · 움직임 비교 step) → write → verify 이벤트를 지연을 두고 순서대로 보내서
 * 프론트 팀이 키 · 비용 · 대기 시간 없이 진행 화면과 리포트의 모든 상태를 만들 수 있게 합니다. 배포 환경에서는 켜지 않습니다.
 */
import sample from "./fixtures/report.v2.sample.json";
import type { ToolStep } from "./context";
import type { MuffinEvent } from "./events";
import { MOVEMENT_TOOL, isFxQuestion } from "./movement";
import type { ResearchInput, ResearchOptions, ResearchResult } from "./muffin";
import { DECISION_PATTERN, defaultPlan } from "./plan";
import { DECISION_NOTICE } from "./report";
import { modeFor, reportSchema, type Intent } from "./schema";

export function isMockMode(): boolean {
  return process.env.MUFFIN_MOCK === "1";
}

export async function mockResearch(input: ResearchInput, { onEvent }: ResearchOptions = {}): Promise<ResearchResult> {
  const emit = (event: MuffinEvent) => onEvent?.(event);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // 실제 호출처럼 잠깐 기다려서 로딩 화면도 만들 수 있게 합니다. 전체 시간을 단계에 나눠 씁니다.
  const total = Number(process.env.MUFFIN_MOCK_DELAY_MS ?? 1200);
  // "사도 돼?" 류 질문이면 판단 요청 모드를 흉내 냅니다. 실제 판정은 📋 분류가 합니다.
  const intent: Intent = DECISION_PATTERN.test(input.question) ? "decision" : "cause";
  // 샘플은 원인 질문이라 움직임 크기(movement · 안내 · calc_movement 단계와 장부 항목)가 들어 있습니다.
  // 유의성 게이트는 환율이 주제인 원인 질문에서만 돌므로, 판단 요청 · 현황 · 비교 질문이나 ETF · 금리 · 물가 질문이면 그 흔적을 모두 뺍니다.
  // 원인 질문인지는 분류 Agent 없이 쓰는 규칙(defaultPlan)으로 봅니다 ("원달러 환율 얼마야?" 는 현황).
  const gate = intent === "cause" && defaultPlan(input.question, input.area).intent === "cause" && isFxQuestion(input.question, input.area);
  const steps = sample.steps.map((s) => ({ ...s, status: s.status as ToolStep["status"] })).filter((s) => gate || s.tool !== MOVEMENT_TOOL);
  // 계산(calc_metrics)과 원인 질문의 움직임 비교(calc_movement)는 정제 단계에서 옵니다.
  const isEditStep = (s: ToolStep) => s.tool.startsWith("calc_");
  const dataSteps = steps.filter((s) => !isEditStep(s));
  const calcSteps = steps.filter(isEditStep);
  const tick = total / (steps.length + 5);

  const { movement, notice, ...sampleReport } = reportSchema.parse(sample.report);
  const gateIds = new Set(sampleReport.evidence.filter((e) => e.tool === MOVEMENT_TOOL).map((e) => e.id));
  const report = gate
    ? sampleReport
    : { ...sampleReport, evidence: sampleReport.evidence.filter((e) => !gateIds.has(e.id)), sources: sampleReport.sources.filter((s) => !gateIds.has(s.id)) };
  const mode = intent === "decision" ? modeFor(intent) : report.mode;
  const tools = [...new Set(dataSteps.map((s) => s.tool))];

  emit({ type: "stage", stage: "plan", status: "start" });
  await wait(tick);
  emit({ type: "plan", intent, mode, tools });
  emit({ type: "stage", stage: "plan", status: "done" });

  emit({ type: "stage", stage: "research", status: "start" });
  for (const step of dataSteps) {
    await wait(tick);
    emit({ type: "step", step });
  }
  emit({ type: "stage", stage: "research", status: "done" });

  emit({ type: "stage", stage: "edit", status: "start" });
  for (const step of calcSteps) {
    await wait(tick);
    emit({ type: "step", step });
  }
  emit({ type: "stage", stage: "edit", status: "done" });

  emit({ type: "stage", stage: "write", status: "start" });
  await wait(tick);
  emit({ type: "stage", stage: "write", status: "done" });

  emit({ type: "stage", stage: "verify", status: "start" });
  await wait(tick);
  emit({ type: "verify", verification: report.verification });
  emit({ type: "stage", stage: "verify", status: "done" });

  return {
    report: {
      ...report,
      mode,
      ...(mode === "decision_facts" ? { notice: DECISION_NOTICE } : gate ? { notice, movement } : {}),
      summary: `[MOCK · ${input.depth}] ${report.summary}`,
    },
    steps,
    rewrites: sample.rewrites,
    plan: { intent, mode, tools, reason: "mock" },
    facts: null,
    model: "mock",
  };
}
