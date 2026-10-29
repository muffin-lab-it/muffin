import { afterEach, describe, expect, it } from "vitest";
import type { RetryPolicyContext } from "@openai/agents";
import { CALL_TIMEOUT_MS, SMALL_MODEL, WRITE_TIMEOUT_MS, modelFor, modelSettingsFor, retryTimeoutOnce } from "./models";

afterEach(() => {
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_MODEL_DEEP;
  delete process.env.OPENAI_MODEL_SMALL;
});

describe("modelFor", () => {
  it("조사 · 작성은 Deep Dive 만 상위 모델을 쓰고, 기본값은 gpt-6 계열이다", () => {
    expect(modelFor("easy")).toBe(modelFor("standard"));
    expect(modelFor("deep")).not.toBe(modelFor("easy"));
    expect(modelFor("easy")).toMatch(/^gpt-6/);
    expect(modelFor("deep")).toMatch(/^gpt-6/);
    expect(modelFor("deep", "research")).toBe(modelFor("deep", "write"));
  });

  it("분류 · 정제는 깊이와 상관없이 작은 모델을 쓴다", () => {
    expect(modelFor("deep", "plan")).toBe(modelFor("easy", "plan"));
    expect(modelFor("deep", "edit")).toBe(modelFor("easy", "edit"));
    expect(modelFor("deep", "plan")).not.toBe(modelFor("deep", "write"));
  });

  it(".env 로 바꿀 수 있다. 분류 · 정제는 OPENAI_MODEL 을 따르지 않고, OPENAI_MODEL_SMALL 이 없으면 gpt-5.4-mini", () => {
    expect(modelFor("standard", "plan")).toBe(SMALL_MODEL);
    expect(SMALL_MODEL).toBe("gpt-5.4-mini");
    process.env.OPENAI_MODEL = "test-main";
    process.env.OPENAI_MODEL_DEEP = "test-deep";
    expect(modelFor("standard")).toBe("test-main");
    expect(modelFor("deep")).toBe("test-deep");
    expect(modelFor("deep", "plan")).toBe(SMALL_MODEL);
    process.env.OPENAI_MODEL_SMALL = "test-small";
    expect(modelFor("deep", "edit")).toBe("test-small");
  });
});

describe("modelSettingsFor", () => {
  it("모든 단계에 호출 한 번의 시간 제한을 두고(작성만 길게), 조사 · 작성(Deep 제외)은 추론 강도를 low 로 둔다", () => {
    expect(modelSettingsFor("plan", "standard")).toMatchObject({ timeoutMs: CALL_TIMEOUT_MS, retry: { maxRetries: 1 } });
    expect(modelSettingsFor("edit", "standard")).toMatchObject({ timeoutMs: CALL_TIMEOUT_MS });
    expect(modelSettingsFor("research", "deep")).toMatchObject({ timeoutMs: CALL_TIMEOUT_MS, reasoning: { effort: "low" } });
    expect(modelSettingsFor("write", "easy")).toMatchObject({ timeoutMs: WRITE_TIMEOUT_MS, reasoning: { effort: "low" } });
    expect(modelSettingsFor("write", "standard")).toMatchObject({ reasoning: { effort: "low" } });
    // Deep 은 숫자 카드가 줄어 "4개 이상" 규칙을 못 지켜서 작성 추론 강도는 기본값
    expect(modelSettingsFor("write", "deep")).toMatchObject({ timeoutMs: WRITE_TIMEOUT_MS });
    expect(modelSettingsFor("write", "deep")).not.toHaveProperty("reasoning");
    expect(modelSettingsFor("plan", "standard")).not.toHaveProperty("reasoning");
  });

  it("시간 초과만 한 번 다시 부르고(재전송 허락), 다른 오류는 다시 부르지 않는다", () => {
    const ctx = (errorCode?: string) => ({ normalized: { errorCode, isNetworkError: false, isAbort: false } }) as unknown as RetryPolicyContext;
    expect(retryTimeoutOnce(ctx("ETIMEDOUT"))).toEqual({ retry: true, approveUnsafeReplay: true, delayMs: 0 });
    expect(retryTimeoutOnce(ctx("rate_limit_exceeded"))).toBe(false);
    expect(retryTimeoutOnce(ctx(undefined))).toBe(false);
  });
});
