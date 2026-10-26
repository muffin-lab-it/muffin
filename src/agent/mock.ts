/**
 * Mock 모드. MUFFIN_MOCK=1 이면 OpenAI 와 tool 을 부르지 않고 저장된 샘플 리포트 v2 를 돌려줍니다.
 * 스트림 라우트에서는 plan → research(step) → edit(계산 step) → write → verify 이벤트를 지연을 두고 순서대로 보내서
 * 프론트 팀이 키 · 비용 · 대기 시간 없이 진행 화면과 리포트의 모든 상태를 만들 수 있게 합니다. 배포 환경에서는 켜지 않습니다.
 */
import sample from "./fixtures/report.v2.sample.json";
import type { ToolStep } from "./context";
import type { MuffinEvent } from "./events";
import type { ResearchInput, ResearchOptions, ResearchResult } from "./muffin";
import { DECISION_PATTERN } from "./plan";
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
  const steps = sample.steps.map((s) => ({ ...s, status: s.status as ToolStep["status"] }));
  const dataSteps = steps.filter((s) => s.tool !== "calc_metrics");
  const calcSteps = steps.filter((s) => s.tool === "calc_metrics");
  const tick = total / (steps.length + 5);

  const report = reportSchema.parse(sample.report);
  // "사도 돼?" 류 질문이면 판단 요청 모드를 흉내 냅니다. 실제 판정은 📋 분류가 합니다.
  const intent: Intent = DECISION_PATTERN.test(input.question) ? "decision" : "cause";
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
      ...(mode === "decision_facts" ? { notice: DECISION_NOTICE } : {}),
      summary: `[MOCK · ${input.depth}] ${report.summary}`,
    },
    steps,
    rewrites: sample.rewrites,
    plan: { intent, mode, tools, reason: "mock" },
    facts: null,
    model: "mock",
  };
}
