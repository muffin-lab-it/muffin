import type { ModelSettings, RetryPolicy } from "@openai/agents";
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

/**
 * 모델 호출 한 번의 시간 제한. SDK 기본은 사실상 제한이 없어서(10분) 멈춘 호출 하나가 55초 마감을 다 쓸 수 있습니다.
 * 분류 · 조사 · 정제의 정상 호출은 가장 길어도 11.3초(2026-10-28, 조사 단계 39회 측정)라 15초면 멈춘 호출만 끊깁니다.
 */
export const CALL_TIMEOUT_MS = 15_000;
/** 작성은 출력이 길어 정상 호출이 20초까지 나와서 따로 잡습니다. */
export const WRITE_TIMEOUT_MS = 30_000;

/**
 * 시간 초과(멈춘 호출)만 한 번 다시 부릅니다. SDK 는 시간 초과 뒤 "요청이 이미 처리됐을 수 있다" 며 재시도를 막으므로
 * approveUnsafeReplay 로 허락합니다. 매 호출이 입력 전체를 다시 보내는 방식이라 대화 상태가 꼬이지 않고, 비용만 한 번 더 듭니다.
 */
export const retryTimeoutOnce: RetryPolicy = ({ normalized }) =>
  normalized.errorCode === "ETIMEDOUT" ? { retry: true, approveUnsafeReplay: true, delayMs: 0 } : false;

/**
 * 단계별 호출 설정 (시간 제한 · 시간 초과 재시도 · 추론 강도). 단계 파일은 그대로 두고 muffin.ts 가 Agent 에 덧씌웁니다.
 * 조사는 tool 을 고르고 짧은 메모를 쓰는 일이라 추론 강도를 low 로 둡니다: 평균 12.8초 → 8.6초, 뉴스 근거 수는 그대로 (39회).
 */
export function modelSettingsFor(stage: ModelStage): ModelSettings {
  const settings: ModelSettings = {
    timeoutMs: stage === "write" ? WRITE_TIMEOUT_MS : CALL_TIMEOUT_MS,
    retry: { maxRetries: 1, policy: retryTimeoutOnce },
  };
  if (stage === "research") settings.reasoning = { effort: "low" };
  return settings;
}
