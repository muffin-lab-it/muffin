import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { cpiPair, ensureRateInflation, isRateInflationQuestion, relationNote, relationRows, withRelationNumbers } from "./relation";
import type { Evidence, WriterOutput } from "./schema";

const cpi = (id: string, monthKey: string, change: number): Evidence => ({
  id,
  tool: "get_macro_indicators",
  label: "물가·고용 지표 확인",
  values: { country: "KR", indicator: "cpi", "latest.month": monthKey, "latest.value": 120.73, "latest.previousYear.change": change },
  source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: `${monthKey.slice(0, 4)}-${monthKey.slice(4)}-01` },
});
const bok = (id: string, days: number, comparisonRate: number): Evidence => ({
  id,
  tool: "get_rate_data",
  label: "금리 확인",
  values: { indicator: "한국은행 기준금리", rate: 3, asOf: "2026-11-18", comparisonDate: days === 365 ? "2025-11-18" : "2026-10-19", comparisonRate, changePp: 3 - comparisonRate, requestedDays: days },
  source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-11-18" },
});
const now = cpi("E1", "202610", 2.818941);
const before = cpi("E4", "202510", 2.38033);
const year = bok("E3", 365, 2.5);
const output = (numbers: WriterOutput["numbers"]): WriterOutput => ({ summary: "", numbers, why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] });

describe("물가와 금리의 관계 질문 (11/21)", () => {
  it("한국 물가와 금리의 관계를 묻는 질문만 대상이다", () => {
    expect(isRateInflationQuestion("물가와 금리, cpi 상관관계 알려줘")).toBe(true);
    expect(isRateInflationQuestion("금리가 물가에 어떤 영향을 줘?")).toBe(true);
    expect(isRateInflationQuestion("요즘 물가 상승률 얼마야?")).toBe(false);
    expect(isRateInflationQuestion("금리와 환율의 관계는?")).toBe(false);
    expect(isRateInflationQuestion("미국 금리와 물가의 관계는?")).toBe(false);
    expect(isRateInflationQuestion("한국 물가와 일본 금리 관계 알려줘")).toBe(false);
    expect(isRateInflationQuestion("2020년 한국 물가와 금리 관계 분석해줘")).toBe(false);
  });

  it("모자란 자료만 채운다: 12개월 전 CPI 와 기준금리 365일", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([now, bok("E2", 30, 3)]);
    const macro = vi.fn(async (...args: [unknown, string]) => (args.length ? "ok" : ""));
    const rate = vi.fn(async (...args: [unknown, string]) => (args.length ? "ok" : ""));
    const tools = [{ name: "get_macro_indicators", invoke: macro }, { name: "get_rate_data", invoke: rate }];
    expect(await ensureRateInflation(ctx, "물가와 금리, cpi 상관관계 알려줘", tools)).toBe(true);
    expect(macro.mock.calls.map((c) => c[1])).toEqual(['{"country":"KR","indicator":"cpi","endMonth":"202510","months":1}']);
    expect(rate.mock.calls.map((c) => c[1])).toEqual(['{"series":"BOK","days":365}']);

    const full = new ResearchContext();
    full.addEvidence([now, before, year]);
    macro.mockClear();
    rate.mockClear();
    await ensureRateInflation(full, "물가와 금리, cpi 상관관계 알려줘", tools);
    expect(macro).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
    expect(await ensureRateInflation(full, "요즘 물가 상승률 얼마야?", tools)).toBe(false);
  });

  it("최신 CPI 가 없으면 먼저 받고, 실패해도 throw 하지 않는다", async () => {
    const ctx = new ResearchContext();
    const macro = vi.fn(async (...args: [unknown, string]) => { if (ctx.evidence.length === 0) ctx.addEvidence([now]); return args.length ? "ok" : ""; });
    const rate = vi.fn(async () => { throw new Error("ECOS 실패"); });
    await expect(ensureRateInflation(ctx, "물가와 금리 관계 알려줘", [{ name: "get_macro_indicators", invoke: macro }, { name: "get_rate_data", invoke: rate }])).resolves.toBe(true);
    expect(macro.mock.calls.map((c) => c[1])).toEqual(['{"country":"KR","indicator":"cpi","endMonth":null,"months":1}', '{"country":"KR","indicator":"cpi","endMonth":"202510","months":1}']);
  });

  it("세 항목이 다 있을 때만 두 지표를 나란히 적는다", () => {
    expect(cpiPair([before, now])).toEqual({ now, before });
    expect(relationRows([now, before])).toBeNull();
    // 과거 물가(2020-10)에 지금 금리를 나란히 놓지 않는다
    expect(relationRows([cpi("E1", "202010", 0.1), cpi("E4", "201910", 0.0), year])).toBeNull();
    expect(relationNote([now, year])).toBe("");
    const note = relationNote([now, before, year, bok("E2", 30, 3)]);
    expect(note).toContain("[두 지표 나란히]");
    expect(note).toContain("2025-10 2.38% (ref E4) → 2026-10 2.82% (ref E1). 1년 사이 높아짐");
    expect(note).toContain("2025-11-18 2.5% → 2026-11-18 3% (ref E3). 1년 사이 높아짐");
    expect(note).toContain("두 지표가 같은 방향으로 움직였습니다");
    expect(relationNote([now, before, bok("E3", 365, 3)])).toContain("한 지표만 움직였습니다");
    expect(relationNote([now, cpi("E4", "202510", 3.5), year])).toContain("두 지표가 반대 방향으로 움직였습니다");
  });

  it("두 시점의 숫자 카드를 맞추어 넣고, 같은 지표의 다른 기준 카드와 그 항목으로 만든 계산 카드는 뺀다", () => {
    const calc: Evidence = { id: "C1", tool: "calc_metrics", label: "계산", values: { value: -0.62 }, source: { name: "계산", url: "", asOf: "2026-11-18" }, lineage: { op: "diff", inputs: ["E4", "E3"] } };
    const fx: Evidence = { id: "E9", tool: "get_fx_krw_rate", label: "환율", values: { rate: 1332.14 }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-11-20" } };
    const card = (ref: string, value: string) => ({ label: "x", value, change: "", asOf: "2026-11-18", ref });
    const out = withRelationNumbers(output([card("E1", "120.73"), card("E2", "3%"), card("C1", "-0.62%p"), card("E9", "1,332.14원")]), [now, before, year, bok("E2", 30, 3), calc, fx]);
    expect(out.numbers).toEqual([
      { label: "물가 상승률 (2026-10, 전년 같은 달 대비)", value: "2.82%", change: "", asOf: "2026-10", ref: "E1" },
      { label: "물가 상승률 (1년 전, 2025-10)", value: "2.38%", change: "", asOf: "2025-10", ref: "E4" },
      { label: "한국은행 기준금리", value: "3%", change: "1년 +0.50%p", asOf: "2026-11-18", ref: "E3" },
      card("E9", "1,332.14원"),
    ]);
    const kept = output([card("E1", "120.73")]);
    expect(withRelationNumbers(kept, [now])).toBe(kept);
  });
});
