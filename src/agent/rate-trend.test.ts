import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { ensureRateYear, flatPolicyRates, rateYearNote, yearRates } from "./rate-trend";
import type { Evidence } from "./schema";

const rate = (id: string, indicator: string, days: number, comparisonRate: number, current = 3): Evidence => ({
  id,
  tool: "get_rate_data",
  label: "금리 확인",
  values: { indicator, rate: current, unit: "%", asOf: "2026-11-18", comparisonDate: days === 365 ? "2025-11-18" : "2026-10-19", comparisonRate, changePp: current - comparisonRate, requestedDays: days },
  source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-11-18" },
});
const bok30 = rate("E1", "한국은행 기준금리", 30, 3);
const bok365 = rate("E2", "한국은행 기준금리", 365, 2.5);

describe("정책금리의 긴 기간 비교 (11/21)", () => {
  it("짧은 기간 변화가 0 인 정책금리만 고른다. 변화가 있거나, 시장금리거나, 365일 결과가 이미 있으면 아니다", () => {
    expect(flatPolicyRates([bok30])).toEqual(["한국은행 기준금리"]);
    expect(flatPolicyRates([bok30, rate("E3", "미국 실효 연방기금금리", 90, 3.88, 3.88)])).toEqual(["한국은행 기준금리", "미국 실효 연방기금금리"]);
    expect(flatPolicyRates([rate("E1", "한국은행 기준금리", 30, 3.25)])).toEqual([]);
    expect(flatPolicyRates([rate("E1", "미국 국채 10년물 금리", 30, 4.1, 4.1)])).toEqual([]);
    expect(flatPolicyRates([bok30, bok365])).toEqual([]);
    expect(flatPolicyRates([])).toEqual([]);
  });

  it("대상 지표를 365일로 한 번 더 부르고, 금리 tool 이 없거나 대상이 없으면 부르지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([bok30]);
    const invoke = vi.fn(async (...args: [unknown, string]) => (args.length ? "ok" : ""));
    expect(await ensureRateYear(ctx, [{ name: "get_rate_data", invoke }])).toEqual(["한국은행 기준금리"]);
    expect(invoke.mock.calls[0]![1]).toBe('{"series":"BOK","days":365}');
    expect(await ensureRateYear(ctx, [{ name: "get_fx_krw_rate", invoke }])).toEqual([]);
    expect(await ensureRateYear(new ResearchContext(), [{ name: "get_rate_data", invoke }])).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("조회가 실패해도 throw 하지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([bok30]);
    const failing = vi.fn(async () => { throw new Error("ECOS 실패"); });
    await expect(ensureRateYear(ctx, [{ name: "get_rate_data", invoke: failing }])).resolves.toEqual(["한국은행 기준금리"]);
  });

  it("작성에는 1년 전 값과 변화를 직접 적어 알리고, 365일 결과만 있으면(조사가 직접 받은 것) 붙이지 않는다", () => {
    const note = rateYearNote([bok30, bok365]);
    expect(note).toContain("[금리 긴 기간]");
    expect(note).toContain("- 한국은행 기준금리 (ref E2): 2025-11-18 2.5% → 2026-11-18 3%, 1년 변화 +0.50%p");
    expect(yearRates([bok30, bok365]).map((e) => e.id)).toEqual(["E2"]);
    expect(rateYearNote([bok365])).toBe("");
    expect(rateYearNote([bok30])).toBe("");
    expect(rateYearNote([bok30, rate("E2", "한국은행 기준금리", 365, 3)])).toContain("1년 변화 변동 없음");
  });
});
