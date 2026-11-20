import { describe, expect, it } from "vitest";
import { homeAreaLabel, splitAreaPrefix } from "./home-form";

describe("관심 영역 머리말 분리 (11/21 외부 G1 · 하니 2)", () => {
  it("여러 영역 머리말을 떼고 영역 이름을 돌려준다", () => {
    expect(splitAreaPrefix("관심 영역: 환율, ETF\n\n요즘 환율 왜 올라?")).toEqual({ areas: ["환율", "ETF"], question: "요즘 환율 왜 올라?" });
    expect(splitAreaPrefix("요즘 환율 왜 올라?")).toEqual({ areas: [], question: "요즘 환율 왜 올라?" });
    expect(splitAreaPrefix("관심 영역: 환율, 주식\n\n질문")).toEqual({ areas: [], question: "관심 영역: 환율, 주식\n\n질문" });
  });
  it("보관함 라벨은 같은 규칙을 쓴다", () => {
    expect(homeAreaLabel({ question: "관심 영역: 환율, ETF\n\n질문" })).toBe("환율 · ETF");
    expect(homeAreaLabel({ question: "질문" })).toBe("Auto 머핀");
    expect(homeAreaLabel({ area: "rate", question: "질문" })).toBe("금리");
  });
});
