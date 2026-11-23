import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { deepNote, deepPlan, deepRefs, ensureDeep, withDeepNumbers } from "./deep";
import type { Evidence, WriterOutput } from "./schema";
import { verify } from "./verify";

const fx: Evidence = { id: "E5", tool: "get_fx_krw_rate", label: "환율", values: { pair: "USD/KRW", rate: 1336.65, asOf: "2026-11-23", "comparison.rate": 1472.3, "comparison.asOf": "2025-11-24", changePct: -9.21 }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-11-23" } };
const fx30: Evidence = { ...fx, id: "E1", values: { ...fx.values, "comparison.rate": 1324.49, "comparison.asOf": "2026-10-24", changePct: 0.92 } };
const kospi: Evidence = { id: "E8", tool: "get_kr_stock_index", label: "코스피", values: { index: "코스피", "latest.date": "2026-11-20", "latest.close": 4869.96, "period.from": "2025-11-20", "period.to": "2026-11-20", "period.closeFrom": 4004.85, "period.returnPct": 21.6 }, source: { name: "금융위원회", url: "https://www.data.go.kr/data/15094807/openapi.do", asOf: "2026-11-20" } };
const cpi = (id: string, monthKey: string, change: number): Evidence => ({
  id,
  tool: "get_macro_indicators",
  label: "물가",
  values: { country: "KR", indicator: "cpi", "latest.month": monthKey, "latest.value": 120.73, "latest.previousYear.change": change, changeUnit: "percent" },
  source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: `${monthKey.slice(0, 4)}-${monthKey.slice(4)}-01` },
});
const output = (numbers: WriterOutput["numbers"]): WriterOutput => ({ summary: "", numbers, why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] });
const keys = (q: string, depth: "easy" | "standard" | "deep" = "deep") => deepPlan(q, depth)?.nodes.map((n) => n.key) ?? null;

describe("Deep Dive 의 긴 기간 비교 (11/23)", () => {
  it("Deep 일 때만, 질문이 말한 환율 · 지수 · 물가 · 실업률을 고른다. 정책금리는 rate-trend 가 맡는다", () => {
    expect(keys("환율 왜 올라?")).toEqual(["fx:USD"]);
    expect(keys("요즘 코스피 어때?")).toEqual(["stock:코스피"]);
    expect(keys("요즘 물가 어때?")).toEqual(["cpi:KR"]);
    expect(keys("엔화 환율 지금 얼마야?")).toEqual(["fx:JPY"]);
    expect(keys("기준금리 얼마야?")).toBeNull();
    expect(keys("환율 왜 올라?", "standard")).toBeNull();
    expect(keys("환율 왜 올라?", "easy")).toBeNull();
  });

  it("관계 질문(relation.ts 가 1년으로 봄), 기간을 정한 질문, 지표가 없는 질문은 대상이 아니다", () => {
    expect(keys("환율이 오르면 코스피는 어떻게 돼?")).toBeNull();
    expect(keys("오늘 환율 얼마야?")).toBeNull();
    expect(keys("최근 한 달 코스피 어땠어?")).toBeNull();
    expect(keys("etf 요즘 뭐가 좋아?")).toBeNull();
    expect(keys("오늘 경제 뉴스 알려줘")).toBeNull();
  });

  it("1년 자료가 없는 지표만 받고, 받은 것이 없으면 null", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([fx30]);
    const invoke = vi.fn(async (...args: [unknown, string]) => {
      if (args.length) ctx.addEvidence([fx]);
      return "ok";
    });
    const plan = await ensureDeep(ctx, "환율 왜 올라?", "deep", [{ name: "get_fx_krw_rate", invoke }]);
    expect(invoke.mock.calls[0]![1]).toBe('{"currency":"USD","days":365}');
    expect(plan?.nodes.map((n) => n.key)).toEqual(["fx:USD"]);
    // 이미 있으면 부르지 않는다
    await ensureDeep(ctx, "환율 왜 올라?", "deep", [{ name: "get_fx_krw_rate", invoke }]);
    expect(invoke).toHaveBeenCalledTimes(1);
    // 지수는 지수 tool 을 직접 부른다
    const idx = new ResearchContext();
    const kr = { name: "get_kr_stock_index", invoke: vi.fn(async (...args: [unknown, string]) => { if (args.length) idx.addEvidence([kospi]); return "ok"; }) };
    expect(await ensureDeep(idx, "요즘 코스피 어때?", "deep", [], { kr, us: kr })).not.toBeNull();
    expect(kr.invoke.mock.calls[0]![1]).toBe('{"index":"코스피","days":365}');
    // 조회가 실패하면 null (throw 하지 않음)
    const failed = new ResearchContext();
    const failing = vi.fn(async () => { throw new Error("실패"); });
    await expect(ensureDeep(failed, "환율 왜 올라?", "deep", [{ name: "get_fx_krw_rate", invoke: failing }])).resolves.toBeNull();
    expect(await ensureDeep(new ResearchContext(), "환율 왜 올라?", "standard", [{ name: "get_fx_krw_rate", invoke }])).toBeNull();
  });

  it("작성에는 1년 비교 줄과 짧은 기간과의 방향을 쓰라는 안내를 붙인다", () => {
    const plan = deepPlan("환율 왜 올라?", "deep")!;
    const note = deepNote([fx30, fx], plan);
    expect(note).toContain("[긴 기간 비교]");
    expect(note).toContain("- 원/달러 환율: 2025-11-24 1,472.30원 → 2026-11-23 1,336.65원 (ref E5), 1년 변화 -9.21%. 1년 사이 내렸습니다 (원화가 강해진 방향)");
    expect(note).toContain("짧은 기간(30일 · 전월 등) 변화와 방향이 같은지 다른지");
    expect(deepRefs([fx30, fx], plan)).toEqual(["E5"]);
    expect(deepNote([fx30], plan)).toBe("");
  });

  it("1년 카드는 작성의 카드 뒤에 붙고, 1년 전용 항목으로 쓴 카드는 바꾸며, 검증을 통과한다", () => {
    const fxPlan = deepPlan("환율 왜 올라?", "deep")!;
    const writer = output([
      { label: "달러당 원화 환율", value: "1,336.65원", change: "30일 +0.92%", asOf: "2026-11-23", ref: "E1" },
      { label: "원/달러 1년", value: "1,336.65원", change: "", asOf: "2026-11-23", ref: "E5" },
    ]);
    const out = withDeepNumbers(writer, [fx30, fx], fxPlan);
    expect(out.numbers.map((n) => [n.label, n.value, n.change])).toEqual([
      ["달러당 원화 환율", "1,336.65원", "30일 +0.92%"],
      ["달러당 원화 환율 1년 변화", "-9.21%", "2025-11-24~2026-11-23"],
    ]);
    expect(verify(out, [fx30, fx]).ok).toBe(true);

    const idx = withDeepNumbers(output([]), [kospi], deepPlan("요즘 코스피 어때?", "deep")!);
    expect(idx.numbers[0]).toMatchObject({ label: "코스피 1년 수익률", value: "+21.60%", change: "2025-11-20~2026-11-20" });
    expect(verify(idx, [kospi]).ok).toBe(true);

    // 물가는 1년 전 달의 상승률 카드 (지금 상승률 카드는 작성이 씀)
    const now = cpi("E2", "202610", 2.818941);
    const before = cpi("E6", "202510", 2.38033);
    const prices = withDeepNumbers(output([{ label: "소비자물가 전년 동월 대비", value: "2.82%", change: "", asOf: "2026-10-01", ref: "E2" }]), [now, before], deepPlan("요즘 물가 어때?", "deep")!);
    expect(prices.numbers.map((n) => [n.label, n.value])).toEqual([
      ["소비자물가 전년 동월 대비", "2.82%"],
      ["물가 상승률 (1년 전, 2025-10)", "2.38%"],
    ]);
    expect(verify(prices, [now, before]).ok).toBe(true);
    expect(withDeepNumbers(writer, [fx30], fxPlan)).toBe(writer);
  });
});
