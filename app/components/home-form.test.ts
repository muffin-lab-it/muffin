import { describe, expect, it } from "vitest";
import { buildHomeInput, homeAreaLabel, toggleHomeArea } from "./home-form";

describe("홈 다중 영역과 기존 API", () => {
  it("Auto는 area를 보내지 않고 단독 선택은 기존 area를 사용한다", () => {
    expect(buildHomeInput(" 질문 ", "standard", [])).toEqual({ question: "질문", depth: "standard" });
    expect(buildHomeInput("질문", "easy", ["fx"])).toEqual({ question: "질문", depth: "easy", area: "fx" });
  });
  it("여러 영역은 질문에 모두 포함하며 단일 영역으로 축소하지 않는다", () => {
    expect(buildHomeInput("금리와 물가의 관계는?", "deep", ["rate", "macro"])).toEqual({ question: "관심 영역: 금리, 물가\n\n금리와 물가의 관계는?", depth: "deep" });
  });
  it("영역 추가와 해제가 가능하고 마지막 영역 해제는 Auto로 돌아간다", () => {
    expect(toggleHomeArea(["fx"], "rate")).toEqual(["fx", "rate"]);
    expect(toggleHomeArea(["fx", "rate"], "fx")).toEqual(["rate"]);
    expect(toggleHomeArea(["rate"], "rate")).toEqual([]);
  });
  it("중복 영역은 질문에 반복해서 포함하지 않는다", () => {
    expect(buildHomeInput("질문", "standard", ["fx", "fx"])).toEqual({ question: "질문", depth: "standard", area: "fx" });
  });
});

describe("보관함 관심 영역 배지", () => {
  it("저장한 다중 선택 기록에서 모든 영역을 표시한다", () => {
    expect(homeAreaLabel(buildHomeInput("질문", "easy", ["fx", "rate"]))).toBe("환율 · 금리");
    expect(homeAreaLabel(buildHomeInput("질문", "easy", ["fx", "etf", "news", "rate", "macro"]))).toBe("환율 · ETF · 경제뉴스 · 금리 · 물가");
  });
  it("Auto와 단일 영역 기록은 기존 표시를 유지한다", () => {
    expect(homeAreaLabel(buildHomeInput("질문", "easy", []))).toBe("Auto 머핀");
    expect(homeAreaLabel(buildHomeInput("질문", "easy", ["etf"]))).toBe("ETF");
  });
  it("일반 질문이나 잘못된 접두어는 다중 선택으로 해석하지 않는다", () => {
    expect(homeAreaLabel({question: "관심 영역: 환율, 금리 관계가 궁금해"})).toBe("Auto 머핀");
    expect(homeAreaLabel({question: "관심 영역: 환율, 날씨\n\n질문"})).toBe("Auto 머핀");
    expect(homeAreaLabel({question: "관심 영역: 환율, 금리\r\n\r\n질문"})).toBe("환율 · 금리");
  });
});
