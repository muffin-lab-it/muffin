import { describe, expect, it } from "vitest";
import { researcherInstructions, writerInstructions } from "./instructions";
import { modelFor } from "./muffin";

describe("instructions", () => {
  it("조사 규칙에는 tool 호출과 조사 메모가 들어가고, 리포트 작성 규칙은 들어가지 않는다", () => {
    const research = researcherInstructions("etf");
    expect(research).toContain("tool 을 최소 1개 호출");
    expect(research).toContain("[조사 메모]");
    expect(research).toContain("관심 영역: ETF");
    expect(research).toContain("권유 표현");
    expect(research).not.toContain("numbers 의 ref");
    expect(research).not.toContain("설명 깊이");
  });

  it("작성 규칙에는 깊이별 규칙과 공통 규칙(증거 번호 인용 · 근거 종류 · 권유 금지)이 들어간다", () => {
    const easy = writerInstructions("easy");
    const deep = writerInstructions("deep", "etf");
    expect(easy).toContain("Easy");
    expect(easy).not.toContain("Deep Dive");
    expect(deep).toContain("Deep Dive");
    expect(deep).toContain("관심 영역: ETF");
    for (const s of [easy, deep]) {
      expect(s).toContain("tool 을 부르지 않습니다");
      expect(s).toContain("권유 표현");
      expect(s).toContain("데이터로 확인되지 않음");
      // v2: 증거 번호 인용 규칙. 출처는 모델이 쓰지 않는다
      expect(s).toContain("numbers 의 ref");
      expect(s).toContain("why 의 refs");
      expect(s).toContain("basis");
      expect(s).toContain("출처 목록은 시스템이");
      expect(s).not.toContain("tool 을 최소 1개 호출");
    }
  });

  it("Deep Dive 만 상위 모델을 쓰고, 기본값은 gpt-6 계열이다", () => {
    expect(modelFor("easy")).toBe(modelFor("standard"));
    expect(modelFor("deep")).not.toBe(modelFor("easy"));
    expect(modelFor("easy")).toMatch(/^gpt-6/);
    expect(modelFor("deep")).toMatch(/^gpt-6/);
  });
});
