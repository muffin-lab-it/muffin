import type { Depth } from "./schema";

/**
 * 깊이별 모델. Deep Dive 만 상위 모델을 씁니다. 조사 · 작성 Agent 가 같은 모델을 씁니다. .env 로 바꿀 수 있습니다.
 * OpenAI 가 gpt-4.1 계열 폐기를 공지(2026-10-14, 2027-01-14 종료)해서 기본값은 gpt-6 계열입니다. 3단계 모델 비교로 확정합니다.
 */
export function modelFor(depth: Depth): string {
  if (depth === "deep") return process.env.OPENAI_MODEL_DEEP || process.env.OPENAI_MODEL || "gpt-6-sol";
  return process.env.OPENAI_MODEL || "gpt-6-luna";
}
