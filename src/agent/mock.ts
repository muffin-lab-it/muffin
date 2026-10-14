/**
 * Mock 모드. MUFFIN_MOCK=1 이면 OpenAI 와 tool 을 부르지 않고 저장된 샘플 리포트를 돌려줍니다.
 * 프론트 팀이 키·비용·대기 시간 없이 화면을 만들 때 씁니다. 배포 환경에서는 켜지 않습니다.
 */
import sample from "./fixtures/report.sample.json";
import type { ResearchInput, ResearchResult } from "./muffin";
import { reportSchema } from "./schema";

export function isMockMode(): boolean {
  return process.env.MUFFIN_MOCK === "1";
}

export async function mockResearch(input: ResearchInput): Promise<ResearchResult> {
  // 실제 호출처럼 잠깐 기다려서 로딩 화면도 만들 수 있게 합니다.
  await new Promise((r) => setTimeout(r, Number(process.env.MUFFIN_MOCK_DELAY_MS ?? 1200)));
  const report = reportSchema.parse(sample.report);
  return {
    report: { ...report, summary: `[MOCK · ${input.depth}] ${report.summary}` },
    steps: sample.steps.map((s) => ({ ...s, status: s.status as "ok" | "error" })),
    rewrites: 0,
  };
}
