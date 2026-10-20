import { describe, expect, it } from "vitest";
import { instructionsFor } from "./instructions";
import { modelFor } from "./muffin";

describe("instructions", () => {
  it("깊이마다 다른 규칙이 들어가고 공통 규칙은 항상 포함된다", () => {
    const easy = instructionsFor("easy");
    const deep = instructionsFor("deep", "etf");
    expect(easy).toContain("Easy");
    expect(easy).not.toContain("Deep Dive");
    expect(deep).toContain("Deep Dive");
    expect(deep).toContain("관심 영역: ETF");
    for (const s of [easy, deep]) {
      expect(s).toContain("tool 을 최소 1개 호출");
      expect(s).toContain("권유 표현");
      expect(s).toContain("데이터로 확인되지 않음");
      // v2: 증거 번호 인용 규칙. 출처는 모델이 쓰지 않는다
      expect(s).toContain("numbers 의 ref");
      expect(s).toContain("why 의 refs");
      expect(s).toContain("basis");
      expect(s).toContain("출처 목록은 시스템이");
    }
  });

  it("Deep Dive 만 상위 모델을 쓰고, 기본값은 gpt-6 계열이다", () => {
    expect(modelFor("easy")).toBe(modelFor("standard"));
    expect(modelFor("deep")).not.toBe(modelFor("easy"));
    expect(modelFor("easy")).toMatch(/^gpt-6/);
    expect(modelFor("deep")).toMatch(/^gpt-6/);
  });
});
