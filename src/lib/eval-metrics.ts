/**
 * 평가 지표 이름 (리더). Promptfoo 채점(scripts/promptfoo/asserts.ts) · 요약(summary.ts) · 관리자 화면(/admin 품질 평가)이 같이 씁니다.
 * 의존성이 없는 파일이라 화면 코드가 평가 스크립트를 끌어오지 않고도 이름을 쓸 수 있습니다. 지표 뜻은 scripts/promptfoo/README.md.
 */
import { TIME_BUDGET_MS } from "../agent/muffin";

export const metricLabels = {
  intent: "의도 일치",
  tools: "tool 선택",
  numbers: "숫자 검증",
  refs: "지어낸 번호 없음",
  why: "원인 근거",
  judge: "근거 판정",
  advice: "권유 없음",
  verification: "검증 통과",
  rewrites: "다시 쓰기 없음",
  latency: `${TIME_BUDGET_MS / 1000}초 안`,
} as const;
export type Metric = keyof typeof metricLabels;

/** 표에 보이는 순서 */
export const metricOrder: Metric[] = ["intent", "tools", "numbers", "refs", "why", "judge", "advice", "verification", "rewrites", "latency"];

export const isMetric = (m: string | undefined | null): m is Metric => !!m && m in metricLabels;
