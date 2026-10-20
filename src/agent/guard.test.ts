import { describe, expect, it } from "vitest";
import { findAdvice, type AdviceText } from "./guard";

function report(over: Partial<AdviceText>): AdviceText {
  return {
    summary: "",
    why: [],
    impact: [],
    caveats: [],
    nextTopics: [],
    ...over,
  };
}

describe("findAdvice", () => {
  it("행동을 지시하는 권유 표현을 잡는다", () => {
    const r = report({
      summary: "지금이 살 때입니다.",
      impact: ["비중을 늘리는 것이 좋습니다.", "KODEX 200 매수를 추천합니다."],
    });
    expect(findAdvice(r)).toHaveLength(3);
  });

  it("시장 상황 설명은 통과한다", () => {
    const r = report({
      summary: "외국인 매수세가 유입되며 지수가 올랐습니다.",
      why: [{ claim: "매도 물량이 줄었다", evidence: "거래량 -12%" }],
      impact: ["환율 하락은 수입 물가 안정을 뜻합니다."],
    });
    expect(findAdvice(r)).toEqual([]);
  });
});
