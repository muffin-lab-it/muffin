import { describe, expect, it } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import { reportSchema, type Report } from "@/src/agent/schema";
import { cardArea, cardLine } from "./card";

const report = (): Report => reportSchema.parse(structuredClone(sample.report));

describe("보관함 카드 (11/25 정리)", () => {
  it("한 줄 요약은 머리말, 없으면 요약 첫 문장이고 문장 속 날짜는 한국어로", () => {
    const r = report();
    r.headline = "환율이 2026-11-20 기준 1,392원이에요";
    expect(cardLine(r)).toBe("환율이 2026년 11월 20일 기준 1,392원이에요");
    delete r.headline;
    r.summary = "환율이 30일간 2% 올랐어요. 평소 범위 안이에요.";
    expect(cardLine(r)).toBe("환율이 30일간 2% 올랐어요.");
  });

  it("고른 영역이 있으면 그 이름, Auto 로 물었으면 쓴 자료의 영역(둘까지), 쓴 자료가 없으면 칩을 뺀다", () => {
    const r = report();
    expect(cardArea({ input: { question: "환율 왜 올라?", depth: "easy", area: "fx" }, report: r })).toBe("환율");
    const auto = cardArea({ input: { question: "요즘 경제 어때?", depth: "easy" }, report: r });
    expect(auto).not.toBe("Auto 머핀");
    expect(auto).toMatch(/^(환율|금리|물가|ETF|뉴스|지수)( · (환율|금리|물가|ETF|뉴스|지수))?$/);
    expect(cardArea({ input: { question: "요즘 경제 어때?", depth: "easy" }, report: { ...r, evidence: [] } })).toBeNull();
  });
});
