import { describe, expect, it } from "vitest";
import { isFlat, mergeSameCards } from "./cards";
import type { WriterOutput } from "./schema";

const card = (label: string, value: string, change: string, ref = "E1") => ({ label, value, change, asOf: "2026-11-18", ref });
const output = (numbers: WriterOutput["numbers"]): WriterOutput => ({ summary: "", numbers, why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] });

describe("같은 값의 숫자 카드 정리 (11/21)", () => {
  it("변화 칸이 비었거나 0 이면 변화 없음으로 본다. 기간 숫자는 세지 않는다", () => {
    expect(isFlat("30일 0%p")).toBe(true);
    expect(isFlat("30일 0.00%p")).toBe(true);
    expect(isFlat("변동 없음")).toBe(true);
    expect(isFlat("")).toBe(true);
    expect(isFlat("1년 +0.50%p")).toBe(false);
    expect(isFlat("2026-10-20~2026-11-19")).toBe(true);
    expect(isFlat("30일 +0.57%")).toBe(false);
  });

  it("이름과 값이 같은 카드는 변화가 있는 쪽 하나만 남긴다 (11/21 실측)", () => {
    const out = mergeSameCards(output([card("한국은행 기준금리", "3%", "30일 0%p", "E1"), card("한국은행 기준금리", "3%", "1년 +0.50%p", "E2"), card("달러당 원화 환율", "1,334.05원", "30일 +0.57%", "E3")]));
    expect(out.numbers.map((n) => n.ref)).toEqual(["E2", "E3"]);
  });

  it("기준일이 다르면 값이 같아도 둘 다 둔다 (1년 전과 지금이 모두 2.50%)", () => {
    const kept = output([{ ...card("물가 상승률 (2026-10)", "2.50%", ""), asOf: "2026-10" }, { ...card("물가 상승률 (1년 전, 2025-10)", "2.50%", ""), asOf: "2025-10" }]);
    expect(mergeSameCards(kept)).toBe(kept);
  });

  it("값이 다르거나 이름이 다르면 그대로 두고, 바뀐 것이 없으면 받은 그대로 돌려준다", () => {
    const kept = output([card("코스피 종가 (기사 보도)", "4,869.96", "전일 대비 -5.21%", "C1"), card("코스피 종가 (공식 자료)", "5,137.89", "", "E2"), card("물가 상승률 (2026-10)", "2.82%", ""), card("물가 상승률 (1년 전)", "2.38%", "")]);
    expect(mergeSameCards(kept)).toBe(kept);
  });
});
