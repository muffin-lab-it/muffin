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
    // 물가 품목군은 같은 지표 이름이라도 품목군이 다르면 다른 카드 (#157 Codex 리뷰)
    const category = (id: string, name: string, code: string): Evidence => ({ id, tool: "get_macro_indicators", label: "품목군", values: { indicator: "cpi_categories", category: name, code, contributionPp: 0.2 }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-11-18" } });
    const cats = [category("E3-2", "교통", "7"), category("E3-3", "음식 및 숙박", "11")];
    expect(mergeSameCards(output([card("교통 기여도", "0.2%p", "", "E3-2"), card("음식 및 숙박 기여도", "0.2%p", "", "E3-3")]), cats).numbers).toHaveLength(2);
    // 같은 값이어도 비교 기준이 다른 변화가 둘이면(전월 대비 · 전년 동월 대비) 둘 다 둔다 (#157 Codex 리뷰)
    const cpiIndex: Evidence = { id: "E1", tool: "get_macro_indicators", label: "물가", values: { indicator: "cpi", country: "KR", "latest.value": 118.2 }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-11-18" } };
    expect(mergeSameCards(output([card("소비자물가지수 (전월 대비)", "118.2", "전월 대비 +0.2%", "E1"), card("소비자물가지수 (전년 동월 대비)", "118.2", "전년 동월 대비 +2.8%", "E1")]), [cpiIndex]).numbers).toHaveLength(2);
    // ETF 종가와 순자산가치가 같은 값이어도 다른 지표라 둘 다 둔다 (#157 Codex 리뷰)
    const etf: Evidence = { id: "E5", tool: "get_etf_kr_price", label: "ETF", values: { name: "KODEX 200", "latest.close": 10000, "latest.nav": 10000 }, source: { name: "금융위", url: "https://www.data.go.kr", asOf: "2026-11-18" } };
    expect(mergeSameCards(output([card("KODEX 200 종가", "10,000원", "", "E5"), card("KODEX 200 순자산가치", "10,000원", "", "E5")]), [etf]).numbers).toHaveLength(2);
    // 같은 항목의 같은 칸(전년 동월 대비 2.818941)을 이름만 달리 쓴 카드는 한 장 (11/23 운영)
    const cpiYoy: Evidence = { id: "E1", tool: "get_macro_indicators", label: "물가", values: { indicator: "cpi", country: "KR", "latest.value": 120.73, "latest.previousMonth.change": 0.249107, "latest.previousYear.change": 2.818941 }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-10-01" } };
    const dup = mergeSameCards(output([card("소비자물가지수 총지수", "120.73", "", "E1"), card("전년 동월 대비 물가 변화", "2.82%", "2025-10 대비 상승", "E1"), card("전월 대비 물가 변화", "0.25%", "", "E1"), card("전년 동월 대비 상승률", "2.82%", "최근 3개월 낮아짐", "E1")]), [cpiYoy]);
    expect(dup.numbers.map((n) => n.label)).toEqual(["소비자물가지수 총지수", "전년 동월 대비 물가 변화", "전월 대비 물가 변화"]);
    // 달 단위 기준일 "2025-10-01" 과 "2025-10" 은 같은 날 (11/24 운영 Deep: 작성 카드와 1년 전 카드가 두 장)
    const before: Evidence = { id: "E2", tool: "get_macro_indicators", label: "물가", values: { indicator: "cpi", country: "KR", "latest.value": 117.42, "latest.previousYear.change": 2.38033 }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2025-10-01" } };
    const twice = mergeSameCards(output([{ ...card("한국 소비자물가 상승률·전년 동월 대비", "2.38%", "", "E2"), asOf: "2025-10-01" }, { ...card("물가 상승률 (1년 전, 2025-10)", "2.38%", "", "E2"), asOf: "2025-10" }]), [before]);
    expect(twice.numbers).toHaveLength(1);
    // 이름이 같으면 3.00% 와 3% 도 같은 값
    expect(mergeSameCards(output([card("한국은행 기준금리", "3.00%", "30일 0%p", "E9"), card("한국은행 기준금리", "3%", "1년 +0.50%p", "E8")])).numbers.map((n) => n.ref)).toEqual(["E8"]);
  });
});

