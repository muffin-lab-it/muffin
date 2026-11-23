import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { ensureRateReference, ensureRateYear, flatPolicyRates, isTrendQuestion, rateReferenceNote, rateYearNote, withRateReference, yearRates } from "./rate-trend";
import type { Evidence, WriterOutput } from "./schema";
import { verify } from "./verify";

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
    expect(await ensureRateYear(ctx, [{ name: "get_rate_data", invoke }], "한국 기준금리 지금 몇 %야?")).toEqual(["한국은행 기준금리"]);
    // 금리가 주제가 아닌 질문(환율 원인 질문이 보조로 받은 금리)은 대상이 아니다
    expect(await ensureRateYear(ctx, [{ name: "get_rate_data", invoke }], "환율 변동이 왜이렇게 심해?")).toEqual([]);
    expect(invoke.mock.calls[0]![1]).toBe('{"series":"BOK","days":365}');
    expect(await ensureRateYear(ctx, [{ name: "get_fx_krw_rate", invoke }], "기준금리 얼마야?")).toEqual([]);
    expect(await ensureRateYear(new ResearchContext(), [{ name: "get_rate_data", invoke }], "기준금리 얼마야?")).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("추세를 묻는 질문이면 짧은 기간에 변화가 있었어도 365일로 받는다 (11/21 실측: 90일 +0.25%p 만으로 답함)", async () => {
    expect(isTrendQuestion("금리 내려가는 추세야?")).toBe(true);
    expect(isTrendQuestion("한국 기준금리 지금 몇 %야?")).toBe(false);
    const moved = rate("E1", "한국은행 기준금리", 90, 2.75);
    expect(flatPolicyRates([moved])).toEqual([]);
    expect(flatPolicyRates([moved], true)).toEqual(["한국은행 기준금리"]);
    const ctx = new ResearchContext();
    ctx.addEvidence([moved]);
    const invoke = vi.fn(async (...args: [unknown, string]) => (args.length ? "ok" : ""));
    expect(await ensureRateYear(ctx, [{ name: "get_rate_data", invoke }], "금리 내려가는 추세야?")).toEqual(["한국은행 기준금리"]);
    expect(await ensureRateYear(ctx, [{ name: "get_rate_data", invoke }], "한국 기준금리 지금 몇 %야?")).toEqual([]);
  });

  it("조회가 실패해도 throw 하지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([bok30]);
    const failing = vi.fn(async () => { throw new Error("ECOS 실패"); });
    await expect(ensureRateYear(ctx, [{ name: "get_rate_data", invoke: failing }], "기준금리 얼마야?")).resolves.toEqual(["한국은행 기준금리"]);
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

describe("다른 나라 금리 참고 (베타 B2, 11/23)", () => {
  const dff = rate("E3", "미국 실효 연방기금금리", 365, 4.58, 3.88);
  const tools = (ctx: ResearchContext, added: Evidence | null = dff) => {
    const invoke = vi.fn(async (...args: [unknown, string]) => {
      if (added && args.length) ctx.addEvidence([added]);
      return "ok";
    });
    return { invoke, list: [{ name: "get_rate_data", invoke }] };
  };
  const withBok = () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([bok30, bok365]);
    return ctx;
  };

  it("나라를 말하지 않은 정책금리 질문이면 미국 정책금리를 365일로 받는다", async () => {
    const ctx = withBok();
    const { invoke, list } = tools(ctx);
    expect(await ensureRateReference(ctx, list, "금리 내려가는 추세야?")).toBe("E3");
    expect(invoke.mock.calls[0]![1]).toBe('{"series":"DFF","days":365}');
    // 이미 받았으면 다시 부르지 않는다
    expect(await ensureRateReference(ctx, list, "기준금리 얼마야?")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("나라를 말했거나, 정책금리가 아닌 금리를 물었거나, 금리 질문이 아니면 부르지 않는다", async () => {
    for (const q of ["한국 기준금리 지금 몇 %야?", "미국 금리 내려가?", "연준 금리 동결했어?", "금통위 금리 결정 언제야?", "해외 금리 흐름은?", "대출 금리 내려가는 추세야?", "예금 금리 언제 내려?", "채권 금리 추세", "환율 오르는 추세야?"]) {
      const ctx = withBok();
      const { invoke, list } = tools(ctx);
      expect(await ensureRateReference(ctx, list, q), q).toBeNull();
      expect(invoke, q).not.toHaveBeenCalled();
    }
  });

  it("한국 기준금리가 장부에 없거나, 미국 정책금리를 조사가 이미 받았거나, 금리 tool 이 없으면 부르지 않는다. 조회가 실패하면 null", async () => {
    const empty = new ResearchContext();
    expect(await ensureRateReference(empty, tools(empty).list, "금리 내려가는 추세야?")).toBeNull();
    const hasUs = withBok();
    hasUs.addEvidence([rate("E3", "미국 실효 연방기금금리", 30, 3.88, 3.88)]);
    expect(await ensureRateReference(hasUs, tools(hasUs).list, "금리 내려가는 추세야?")).toBeNull();
    const noTool = withBok();
    expect(await ensureRateReference(noTool, [{ name: "get_fx_krw_rate", invoke: vi.fn() }], "금리 내려가는 추세야?")).toBeNull();
    const failed = withBok();
    const failing = vi.fn(async () => { throw new Error("FRED 실패"); });
    await expect(ensureRateReference(failed, [{ name: "get_rate_data", invoke: failing }], "금리 내려가는 추세야?")).resolves.toBeNull();
  });

  it("작성에는 미국 금리의 1년 비교와 두 나라 금리 폭의 방향만 알리고(숫자 없이), 답은 한국 기준금리로 하게 한다", () => {
    const note = rateReferenceNote([bok30, bok365, dff], "E3");
    expect(note).toContain("[다른 나라 금리 참고]");
    expect(note).toContain("- 미국 실효 연방기금금리 (ref E3): 2025-11-18 4.58% → 2026-11-18 3.88%, 1년 변화 -0.70%p");
    // 1년 전 2.08%p → 지금 0.88%p
    expect(note).toContain("미국 금리가 한국보다 높은 폭은 1년 사이 좁혀졌습니다");
    expect(note).toContain("한국 기준금리로 답합니다");
    expect(rateReferenceNote([bok30, bok365, dff], null)).toBe("");
    // 한국 기준금리의 1년 비교가 없으면 폭 줄은 쓰지 않는다
    expect(rateReferenceNote([bok30, dff], "E3")).not.toContain("높은 폭");
    // 높고 낮음이 바뀐 경우
    expect(rateReferenceNote([bok365, rate("E3", "미국 실효 연방기금금리", 365, 3.5, 2.5)], "E3")).toContain("지금은 한국 금리가 더 높습니다");
  });

  it("참고 카드는 맨 뒤에 붙고, 작성이 같은 항목으로 쓴 카드를 바꾸며, 검증을 통과한다", () => {
    const evidence = [bok30, bok365, dff];
    const base: WriterOutput = { summary: "", numbers: [{ label: "한국은행 기준금리", value: "3%", change: "1년 +0.50%p", asOf: "2026-11-18", ref: "E2" }, { label: "미국 금리", value: "3.88%", change: "", asOf: "2026-11-18", ref: "E3" }], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] };
    const out = withRateReference(base, evidence, "E3");
    expect(out.numbers.map((n) => n.label)).toEqual(["한국은행 기준금리", "미국 실효 연방기금금리 (참고)"]);
    expect(out.numbers[1]).toMatchObject({ value: "3.88%", change: "1년 -0.70%p", asOf: "2026-11-18", ref: "E3" });
    expect(verify(out, evidence).ok).toBe(true);
    expect(withRateReference(base, evidence, null)).toBe(base);
  });
});
