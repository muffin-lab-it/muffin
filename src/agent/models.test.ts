import { afterEach, describe, expect, it } from "vitest";
import { modelFor } from "./models";

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

  it(".env 로 바꿀 수 있다 (OPENAI_MODEL_SMALL 이 없으면 OPENAI_MODEL 을 따른다)", () => {
    process.env.OPENAI_MODEL = "test-main";
    process.env.OPENAI_MODEL_DEEP = "test-deep";
    expect(modelFor("standard")).toBe("test-main");
    expect(modelFor("deep")).toBe("test-deep");
    expect(modelFor("deep", "plan")).toBe("test-main");
    process.env.OPENAI_MODEL_SMALL = "test-small";
    expect(modelFor("deep", "edit")).toBe("test-small");
  });
});
