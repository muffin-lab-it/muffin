/**
 * Mock 모드. MUFFIN_MOCK=1 이면 OpenAI 와 tool 을 부르지 않고 저장된 샘플 리포트 v2 를 돌려줍니다.
 * 스트림 라우트에서는 stage → plan → step → write → verify 이벤트를 지연을 두고 순서대로 보내서
 * 프론트 팀이 키 · 비용 · 대기 시간 없이 진행 화면과 리포트의 모든 상태를 만들 수 있게 합니다. 배포 환경에서는 켜지 않습니다.
 */
import sample from "./fixtures/report.v2.sample.json";
import type { ToolStep } from "./context";
import type { MuffinEvent } from "./events";
import type { ResearchInput, ResearchOptions, ResearchResult } from "./muffin";
import { reportSchema, type ReportMode } from "./schema";

export function isMockMode(): boolean {
  return process.env.MUFFIN_MOCK === "1";
}

/** "사도 돼?" 류 질문이면 판단 요청 모드를 흉내 냅니다. 실제 감지는 2단계 접수가 합니다. */
const DECISION_QUESTION = /(사도|살까|팔까|팔아야|매수|매도|들어가도|투자해도)/;

export async function mockResearch(input: ResearchInput, { onEvent }: ResearchOptions = {}): Promise<ResearchResult> {
  const emit = (event: MuffinEvent) => onEvent?.(event);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // 실제 호출처럼 잠깐 기다려서 로딩 화면도 만들 수 있게 합니다. 전체 시간을 단계에 나눠 씁니다.
  const total = Number(process.env.MUFFIN_MOCK_DELAY_MS ?? 1200);
  const steps = sample.steps.map((s) => ({ ...s, status: s.status as ToolStep["status"] }));
  const tick = total / (steps.length + 4);

  const report = reportSchema.parse(sample.report);
  const decision = DECISION_QUESTION.test(input.question);
  const mode: ReportMode = decision ? "decision_facts" : report.mode;
  const tools = [...new Set(steps.map((s) => s.tool))];

  emit({ type: "stage", stage: "plan", status: "start" });
  await wait(tick);
  emit({ type: "plan", intent: decision ? "decision" : "cause", mode, tools });
  emit({ type: "stage", stage: "plan", status: "done" });

  emit({ type: "stage", stage: "research", status: "start" });
  for (const step of steps) {
    await wait(tick);
    emit({ type: "step", step });
  }
  emit({ type: "stage", stage: "research", status: "done" });

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
      ...(decision ? { notice: sample.decisionNotice } : {}),
      summary: `[MOCK · ${input.depth}] ${report.summary}`,
    },
    steps,
    rewrites: sample.rewrites,
    model: "mock",
  };
}
