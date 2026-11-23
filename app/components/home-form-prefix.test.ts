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

describe("질문 글자 수 (11/21 QA-09)", () => {
  it("영역을 둘 이상 고르면 머리말 길이만큼 허용 길이가 줄어든다", async () => {
    const { questionAllowance, buildHomeInput } = await import("./home-form");
    expect(questionAllowance([])).toBe(500);
    expect(questionAllowance(["fx"])).toBe(500);
    const prefix = buildHomeInput("", "easy", ["fx", "etf"]).question.length;
    expect(prefix).toBeGreaterThan(0);
    expect(questionAllowance(["fx", "etf"])).toBe(500 - prefix);
  });
});

describe("다섯 영역 모두 고르기 (11/23 외부 1번 G1)", () => {
  it("다섯 번째 영역을 고르면 Auto(빈 선택)로 돌아가고 안내가 바뀐다", async () => {
    const { toggleHomeArea, areaHint } = await import("./home-form");
    expect(toggleHomeArea(["fx", "etf", "news", "rate"], "macro")).toEqual([]);
    expect(toggleHomeArea(["fx", "etf"], "rate")).toEqual(["fx", "etf", "rate"]);
    expect(areaHint([], true)).toContain("Auto 머핀과 같아서 Auto 로 바꿨어요");
    expect(areaHint([], false)).toContain("Auto 머핀은 질문을 보고");
    expect(areaHint(["fx"], false)).toBe("환율 자료를 중심으로 리포트를 만들어요.");
    expect(areaHint(["fx", "rate"], false)).toContain("환율 · 금리 자료를 함께 살펴보고");
  });
});
