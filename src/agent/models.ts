import type { Depth } from "./schema";

/** 모델을 쓰는 네 단계. 검증은 코드라 모델이 없습니다. */
export type ModelStage = "plan" | "research" | "edit" | "write";

/**
 * 분류 · 정제의 기본 모델. 2026-10-28 같은 시각에 32회 비교: gpt-6-luna 대비 두 단계 합이 평균 23.7초 → 4.9초,
 * 전체 평균 58.2초 → 34.8초(55초 초과 8회 중 5회 → 0회)이고, 질문 의도는 32회 모두 같게 분류했습니다.
 */
export const SMALL_MODEL = "gpt-5.4-mini";

/**
 * 단계 · 깊이별 모델. 분류 · 정제는 입력이 짧고 판단이 단순해 빠른 작은 모델을 쓰고(OPENAI_MODEL_SMALL, 기본 SMALL_MODEL),
 * 조사 · 작성은 깊이를 따릅니다 (Deep Dive 만 상위 모델). .env 로 바꿀 수 있습니다.
 * OpenAI 가 gpt-4.1 계열 폐기를 공지(2026-10-14, 2027-01-14 종료)해서 조사 · 작성 기본값은 gpt-6 계열입니다. 3단계 모델 비교로 확정합니다.
 */
export function modelFor(depth: Depth, stage: ModelStage = "write"): string {
  if (stage === "plan" || stage === "edit") return process.env.OPENAI_MODEL_SMALL || SMALL_MODEL;
  if (depth === "deep") return process.env.OPENAI_MODEL_DEEP || process.env.OPENAI_MODEL || "gpt-6-sol";
  return process.env.OPENAI_MODEL || "gpt-6-luna";
}
