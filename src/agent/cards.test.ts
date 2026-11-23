import { describe, expect, it } from "vitest";
import { isFlat, mergeSameCards } from "./cards";
import type { Evidence, WriterOutput } from "./schema";

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

  it("괄호 안의 대상이 다르면 값과 기준일이 같아도 둘 다 둔다 (한국 · 미국)", () => {
    const kept = output([card("소비자물가 상승률 (한국)", "2.50%", "", "E1"), card("소비자물가 상승률 (미국)", "2.50%", "", "E2")]);
    expect(mergeSameCards(kept)).toBe(kept);
  });

  it("값이 다르거나 이름이 다르면 그대로 두고, 바뀐 것이 없으면 받은 그대로 돌려준다", () => {
    const kept = output([card("코스피 종가 (기사 보도)", "4,869.96", "전일 대비 -5.21%", "C1"), card("코스피 종가 (공식 자료)", "5,137.89", "", "E2"), card("물가 상승률 (2026-10)", "2.82%", ""), card("물가 상승률 (1년 전)", "2.38%", "")]);
    expect(mergeSameCards(kept)).toBe(kept);
  });

  it("같은 장부 지표 · 같은 값 · 같은 기준일이면 이름이 달라도 하나로, 값은 3.00% 와 3% 를 같게 본다 (11/23 녹화)", () => {
    const rate = (id: string, days: number): Evidence => ({ id, tool: "get_rate_data", label: "금리", values: { indicator: "한국은행 기준금리", rate: 3, requestedDays: days }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-11-18" } });
    const evidence = [rate("E1", 30), rate("E4", 365)];
    const out = mergeSameCards(output([card("한국 기준금리", "3%", "30일 변동 없음(0%p)", "E1"), card("미국 실효 연방기금금리", "3.88%", "30일 0%p", "E2"), card("한국 기준금리 1년 변화", "3.00%", "1년 +0.50%p", "E4")]), evidence);
    // 남긴 카드(1년 비교)는 무리에서 처음 나온 자리(한국 금리 카드 자리)에 둔다
    expect(out.numbers.map((n) => n.ref)).toEqual(["E4", "E2"]);
    // 장부를 주지 않으면 이름이 다른 카드는 그대로 (예전 동작)
    expect(mergeSameCards(output([card("한국 기준금리", "3%", "30일 0%p", "E1"), card("한국 기준금리 1년 변화", "3%", "1년 +0.50%p", "E4")])).numbers).toHaveLength(2);
    // 값이 다르면(1년 변화 +0.50%p 를 값으로 쓴 카드) 둘 다 둔다
    expect(mergeSameCards(output([card("한국은행 기준금리", "3%", "30일 0%p", "E1"), card("한국은행 기준금리 1년 변화", "+0.50%p", "1년", "E4")]), evidence).numbers).toHaveLength(2);
    // 이름이 같으면 3.00% 와 3% 도 같은 값
    expect(mergeSameCards(output([card("한국은행 기준금리", "3.00%", "30일 0%p", "E9"), card("한국은행 기준금리", "3%", "1년 +0.50%p", "E8")])).numbers.map((n) => n.ref)).toEqual(["E8"]);
  });
});

