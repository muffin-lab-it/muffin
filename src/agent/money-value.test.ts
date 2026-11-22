import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { ensureMoneyValue, isMoneyValueQuestion, moneyValueNote, moneyValueRows } from "./money-value";
import type { Evidence } from "./schema";

const src = { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-10-01" };
const cpi: Evidence = { id: "E1", tool: "get_macro_indicators", label: "물가", values: { country: "KR", indicator: "cpi", "latest.month": "202610", "latest.previousYear.change": 2.818941 }, source: src };
const fx: Evidence = { id: "E2", tool: "get_fx_krw_rate", label: "환율", values: { pair: "USD/KRW", rate: 1335.94, changePct: 0.87, "comparison.asOf": "2026-10-23" }, source: src };

describe("돈의 가치 질문 (11/22)", () => {
  it("돈값 · 구매력을 묻는 질문만 대상이다", () => {
    expect(isMoneyValueQuestion("요즘 돈값이 떨어졌다는데 무슨 말이야?")).toBe(true);
    expect(isMoneyValueQuestion("원화 가치가 왜 떨어져?")).toBe(true);
    expect(isMoneyValueQuestion("오늘 달러 환율 얼마야?")).toBe(false);
    expect(isMoneyValueQuestion("미국 물가 때문에 달러 구매력이 얼마나 줄었어?")).toBe(false);
  });

  it("물가와 환율 중 없는 것만 채우고, 대상이 아니면 부르지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([fx]);
    const macro = vi.fn(async (...args: [unknown, string]) => (args.length ? "ok" : ""));
    const fxTool = vi.fn(async (...args: [unknown, string]) => (args.length ? "ok" : ""));
    const tools = [{ name: "get_macro_indicators", invoke: macro }, { name: "get_fx_krw_rate", invoke: fxTool }];
    expect(await ensureMoneyValue(ctx, "요즘 돈값이 떨어졌다는데 무슨 말이야?", tools)).toBe(true);
    expect(macro.mock.calls[0]![1]).toBe('{"country":"KR","indicator":"cpi","endMonth":null,"months":1}');
    expect(fxTool).not.toHaveBeenCalled();
    expect(await ensureMoneyValue(ctx, "오늘 달러 환율 얼마야?", tools)).toBe(false);
    expect(macro).toHaveBeenCalledTimes(1);
  });

  it("작성에는 두 뜻과 각각의 값을 알린다", () => {
    expect(moneyValueRows([cpi, fx]).map((e) => e.id)).toEqual(["E1", "E2"]);
    const note = moneyValueNote([cpi, fx]);
    expect(note).toContain("[돈의 가치]");
    expect(note).toContain("소비자물가가 1년 전보다 2.82% 올랐습니다 (2026-10, ref E1)");
    expect(note).toContain("+0.87% 움직였습니다 (ref E2)");
    expect(moneyValueNote([])).toBe("");
  });
});
