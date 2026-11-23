import { describe, expect, it } from "vitest";
import { factOf, withEnsuredFacts } from "./extra-facts";
import type { Evidence, FactsOutput } from "./schema";

const src = { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-11-18" };
const bok: Evidence = { id: "E3", tool: "get_rate_data", label: "금리", values: { indicator: "한국은행 기준금리", rate: 3, asOf: "2026-11-18", comparisonDate: "2025-11-18", comparisonRate: 2.5, changePp: 0.5, requestedDays: 365 }, source: src };
const cpi: Evidence = { id: "E4", tool: "get_macro_indicators", label: "물가", values: { country: "KR", indicator: "cpi", "latest.month": "202510", "latest.previousYear.change": 2.38033 }, source: src };
const kospi: Evidence = { id: "E5", tool: "get_kr_stock_index", label: "지수", values: { index: "코스피", "latest.date": "2026-11-19", "latest.close": 5137.89, "latest.changePct": 1.39, "period.from": "2026-10-20", "period.closeFrom": 5552.74, "period.returnPct": -7.47 }, source: src };
const today: Evidence = { id: "C1", tool: "calc_index_today", label: "당일", values: { index: "코스피", date: "2026-11-20", close: 4869.96, changePct: -5.21 }, source: { ...src, name: "연합뉴스" } };
const etf: Evidence = { id: "E6", tool: "get_etf_kr_price", label: "ETF", values: { name: "KODEX 200", "period.from": "2026-10-20", "period.to": "2026-11-19", "period.returnPct": -7.060111 }, source: src };
const news: Evidence = { id: "E7-1", tool: "get_korean_economic_news", label: "뉴스", values: { title: "코스피 5%대 급락 마감" }, source: { ...src, name: "연합뉴스" } };
const fx: Evidence = { id: "E1", tool: "get_fx_krw_rate", label: "환율", values: { rate: 1332.14 }, source: src };
const facts = (...refs: string[]): FactsOutput => ({ facts: refs.map((ref) => ({ ref, fact: `${ref} 사실` })), dropped: [], unverified: [] });

describe("코드가 채운 장부 항목을 작성의 사실 목록에 넣기 (11/21)", () => {
  it("항목 종류별로 사실 한 줄을 만든다", () => {
    expect(factOf(bok)).toBe("한국은행 기준금리 3% (2026-11-18), 2025-11-18 2.5% 대비 +0.50%p");
    expect(factOf(cpi)).toBe("한국 소비자물가 상승률(전년 같은 달 대비) 2.38% (2025-10)");
    expect(factOf(kospi)).toBe("코스피 종가 5,137.89 (2026-11-19), 전일 대비 +1.39%, 2026-10-20 종가 5,552.74 대비 -7.47%");
    expect(factOf(today)).toBe("코스피 종가 4,869.96 (2026-11-20, 연합뉴스 보도 · 공식 전일 종가로 검산), 전일 대비 -5.21%");
    expect(factOf(etf)).toBe("KODEX 200 가격 수익률 -7.06% (2026-10-20 → 2026-11-19)");
    expect(factOf(news)).toBe("연합뉴스 기사 제목: 코스피 5%대 급락 마감");
    expect(factOf(fx)).toBeNull();
    const jpy: Evidence = { ...fx, id: "E5", values: { pair: "JPY(100)/KRW", rate: 839.31, asOf: "2026-11-23", "comparison.rate": 937.66, "comparison.asOf": "2025-11-23", changePct: -10.49 } };
    expect(factOf(jpy)).toBe("100엔당 원화 환율 839.31원 (2026-11-23), 2025-11-23 937.66원 대비 -10.49%");
    expect(factOf({ ...jpy, values: { ...jpy.values, pair: "USD/KRW", rate: 1336.36 } })).toContain("달러당 원화 환율 1,336.36원");
    const jobs: Evidence = { id: "E8", tool: "get_macro_indicators", label: "실업률", values: { country: "KR", indicator: "unemployment", "latest.month": "202610", "latest.value": 2.5, "latest.previousYear.month": "202510", "latest.previousYear.value": 2.7, "latest.previousYear.change": -0.2 }, source: src };
    expect(factOf(jobs)).toBe("한국 실업률 2.5% (2026-10), 2025-10 2.7% 대비 -0.20%p");
  });

  it("정제가 고르지 않은 것만 사실 목록 뒤에 붙인다", () => {
    const out = withEnsuredFacts(facts("E1", "E3"), [fx, bok, cpi, kospi], ["E3", "E4"]);
    expect(out!.facts.map((f) => f.ref)).toEqual(["E1", "E3", "E4"]);
    expect(out!.facts[1]!.fact).toBe("E3 사실");
    expect(out!.facts[2]!.fact).toContain("2.38%");
  });

  it("정제가 실패했거나 사실이 없거나 붙일 것이 없으면 받은 그대로 돌려준다", () => {
    expect(withEnsuredFacts(null, [bok], ["E3"])).toBeNull();
    const none = facts();
    expect(withEnsuredFacts(none, [bok], ["E3"])).toBe(none);
    const all = facts("E3");
    expect(withEnsuredFacts(all, [bok], ["E3"])).toBe(all);
    expect(withEnsuredFacts(all, [bok, fx], ["E1"])).toBe(all);
  });
});
