import { describe, expect, it } from "vitest";
import { cpiBasisFor, cpiCategoryEntries, cpiCauseNote, cpiRescuedRefs, rankCategories } from "./cpi";
import type { Evidence } from "./schema";

function entry(id: string, values: Evidence["values"]): Evidence {
  return { id, tool: "get_macro_indicators", label: `물가 · 고용 지표 확인 · ${values.category}`, values: { indicator: "cpi_categories", month: "202610", previousYearMonth: "202510", previousMonth: "202609", ...values }, source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr/", asOf: "2026-10-01" } };
}
const total = entry("E5-1", { category: "총지수", code: "0", weight: 1000, index: 120.73, previousYearIndex: 117.42, yoyPct: 2.818941, contributionSumPp: 2.857609, previousMonthIndex: 120.43, momPct: 0.249107, momContributionSumPp: 0.2477 });
const transport = entry("E5-2", { category: "교통", code: "G", weight: 110.6, index: 124.32, previousYearIndex: 116.4, yoyPct: 6.804124, contributionPp: 0.752536, previousMonthIndex: 124.07, momPct: 0.2, momContributionPp: 0.0221 });
const dining = entry("E5-3", { category: "음식 및 숙박", code: "K", weight: 144.7, index: 129.28, previousYearIndex: 125.52, yoyPct: 2.995539, contributionPp: 0.433455, previousMonthIndex: 128.52, momPct: 0.5913, momContributionPp: 0.0856 });
const housing = entry("E5-4", { category: "주택, 수도, 전기 및 연료", code: "D", weight: 171.6, index: 119.27, previousYearIndex: 116.94, yoyPct: 1.992475, contributionPp: 0.341909, previousMonthIndex: 118.93, momPct: 0.2859, momContributionPp: 0.0491 });
const tobacco = entry("E5-5", { category: "주류 및 담배", code: "B", weight: 15.8, index: 105.07, previousYearIndex: 105.1, yoyPct: -0.028544, contributionPp: -0.000451, previousMonthIndex: 105.19, momPct: -0.1141, momContributionPp: -0.0018 });
const fx: Evidence = { id: "E1", tool: "get_fx_krw_rate", label: "환율", values: { pair: "USD/KRW", rate: 1333 }, source: { name: "Frankfurter", url: "https://api.frankfurter.dev", asOf: "2026-11-19" } };

describe("cpiCauseNote: 품목군 기여도를 작성의 원인 후보로", () => {
  it("총지수 등락과 기여도 상위 품목군, 규칙, 나머지 품목군을 적는다", () => {
    const note = cpiCauseNote([fx, tobacco, housing, transport, total, dining], null);
    expect(note).toContain("[물가 원인 후보] 소비자물가 총지수는 2026년 10월 기준 전년 같은 달보다 +2.82% 올랐고, 전월보다 +0.25% 올랐습니다 (E5-1). 이 질문은 전년 같은 달 대비 기준으로 답합니다.");
    expect(note).toContain("- 교통: 전년 같은 달 대비 +6.80% · 기여 +0.75%p · 가중치 110.6 (E5-2)");
    expect(note).toContain("두 기준(전년 같은 달 · 전월)을 섞지 않고");
    expect(note.indexOf("교통")).toBeLessThan(note.indexOf("음식 및 숙박"));
    expect(note).toContain("- 나머지 1개 품목군: 주류 및 담배 -0.00%p (E5-5)");
    expect(note).toContain("12개 기여도 합 +2.86%p");
    expect(note).toContain("basis data");
    expect(note).toContain("품목군 자료가 있으면 why 를 비우지 않습니다");
    expect(note).not.toContain("[덧붙인 장부 항목]");
  });

  it("정제가 사실 목록에 넣지 않은 품목군은 장부 줄로 덧붙이고, 자료가 없으면 빈 문자열", () => {
    const note = cpiCauseNote([total, transport, dining], new Set(["E5-1"]));
    expect(note).toContain("[덧붙인 장부 항목]");
    expect(note).toContain("- E5-2 · 물가 · 고용 지표 확인 · 교통 · 기준일 2026-10-01");
    expect(note).not.toContain("- E5-1 · 물가");
    expect(cpiCauseNote([fx, total], null)).toBe("");
    expect(cpiCauseNote([], null)).toBe("");
  });

  it("호출 묶음이 여럿이면 관측 월이 가장 최근인 묶음만, 같은 월이면 나중 호출만 쓴다", () => {
    const oldTotal = { ...total, id: "E3-1", values: { ...total.values, month: "202509", previousYearMonth: "202409", yoyPct: 2.1 } };
    const oldTransport = { ...transport, id: "E3-2", values: { ...transport.values, month: "202509", contributionPp: 9.9 } };
    const { total: t, categories } = cpiCategoryEntries([oldTotal, oldTransport, total, dining, transport]);
    expect(t?.id).toBe("E5-1");
    expect(categories.map((e) => e.id)).toEqual(["E5-2", "E5-3"]);
    expect(cpiCauseNote([oldTotal, oldTransport, total, dining, transport], null)).not.toContain("E3-");
    // 같은 월을 두 번 조회했으면 (E5 · E7) 나중 묶음만 — 품목군이 두 번 나오지 않는다
    const again = [total, transport, dining].map((e) => ({ ...e, id: e.id.replace("E5-", "E7-") }));
    const dup = cpiCategoryEntries([total, transport, dining, ...again]);
    expect(dup.total?.id).toBe("E7-1");
    expect(dup.categories.map((e) => e.id)).toEqual(["E7-2", "E7-3"]);
  });

  it("총지수가 내렸으면 가장 많이 끌어내린 품목군부터, 문구도 하락 기준", () => {
    const downTotal = { ...total, values: { ...total.values, yoyPct: -0.8, contributionSumPp: -0.81 } };
    const down = { ...dining, values: { ...dining.values, yoyPct: -3.1, contributionPp: -0.45 } };
    const { categories } = cpiCategoryEntries([transport, down, downTotal, tobacco]);
    expect(categories.map((e) => e.id)).toEqual(["E5-3", "E5-5", "E5-2"]);
    const note = cpiCauseNote([transport, down, downTotal, tobacco], null);
    expect(note).toContain("전년 같은 달보다 -0.80% 내렸고");
    expect(note).toContain("총지수 하락에 많이 보탠 순서");
    expect(note).toContain("상쇄한 요인");
  });

  it("지난달 대비 질문이면 전월 기여도 순으로 바꾸고 기준을 문장에 적는다", () => {
    expect(cpiBasisFor("지난달 대비 물가가 왜 올랐어?")).toBe("mom");
    expect(cpiBasisFor("이번 달 물가 왜 이래?")).toBe("mom");
    expect(cpiBasisFor("최근 우리나라 물가가 왜 올랐어?")).toBe("yoy");
    const all = [transport, dining, housing, tobacco, total];
    expect(rankCategories([transport, dining, housing, tobacco], "mom", total).map((e) => e.id)).toEqual(["E5-3", "E5-4", "E5-2", "E5-5"]);
    const note = cpiCauseNote(all, null, "지난달 대비 물가가 왜 올랐어?");
    expect(note).toContain("이 질문은 전월 대비 기준으로 답합니다");
    expect(note).toContain("- 음식 및 숙박: 전월 대비 +0.59% · 기여 +0.09%p · 가중치 144.7 (E5-3)");
    expect(note.indexOf("음식 및 숙박")).toBeLessThan(note.indexOf("- 교통"));
    expect(note).toContain("12개 기여도 합 +0.25%p");
    expect(note).toContain("yoyPct · contributionPp");
  });

  it("entries 는 기여도 큰 순이고, rescued 는 정제가 뺀 품목군 id 만", () => {
    const { total: t, categories } = cpiCategoryEntries([tobacco, dining, transport, total]);
    expect(t?.id).toBe("E5-1");
    expect(categories.map((e) => e.id)).toEqual(["E5-2", "E5-3", "E5-5"]);
    expect([...cpiRescuedRefs([total, transport, dining, fx], new Set(["E5-3", "E1"]))]).toEqual(["E5-3"]);
  });
});
