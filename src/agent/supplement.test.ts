import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import type { Evidence } from "./schema";
import { CPI_CATEGORIES_INPUT, ensureCpiCategories, ensureOtherPairs, isPriceQuestion, type InvokableTool } from "./supplement";

const usd: Evidence = {
  id: "E1",
  tool: "get_fx_krw_rate",
  label: "환율 확인 · Frankfurter v2",
  values: { pair: "USD/KRW", unit: "KRW per 1 USD", rate: 1335.29, asOf: "2026-11-15", "comparison.rate": 1413.2, "comparison.asOf": "2026-08-17", change: -77.91, changePct: -5.51 },
  source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-11-15" },
};
const fxTool = (invoke = vi.fn(async () => "ok")): InvokableTool & { invoke: ReturnType<typeof vi.fn> } => ({ name: "get_fx_krw_rate", invoke });

describe("ensureOtherPairs: 환율 원인 질문의 다른 통화를 코드가 채운다", () => {
  it("장부에 없는 통화만 같은 days 로 환율 tool 을 부른다 (조사와 같은 래퍼라 장부 · step 에 남음)", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([usd]);
    const tool = fxTool();
    const missing = await ensureOtherPairs(ctx, "최근 90일간 환율이 왜 움직였어?", "fx", [tool]);
    expect(missing).toEqual([{ currency: "EUR", days: 90 }, { currency: "JPY", days: 90 }]);
    expect(tool.invoke).toHaveBeenCalledTimes(2);
    expect(tool.invoke.mock.calls.map((c) => c[1])).toEqual(['{"currency":"EUR","days":90}', '{"currency":"JPY","days":90}']);
    // 래퍼에 넘기는 실행 문맥은 같은 장부를 가리킨다
    expect(tool.invoke.mock.calls[0]![0].context).toBe(ctx);
  });

  it("환율 tool 이 없거나, 잴 대상이 없거나, 이미 다 있으면 아무것도 부르지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([usd]);
    expect(await ensureOtherPairs(ctx, "최근 90일간 환율이 왜 움직였어?", "fx", [{ name: "get_rate_data", invoke: vi.fn() }])).toEqual([]);
    expect(await ensureOtherPairs(new ResearchContext(), "최근 90일간 환율이 왜 움직였어?", "fx", [fxTool()])).toEqual([]);
    const full = new ResearchContext();
    full.addEvidence([usd, { ...usd, id: "E2", values: { ...usd.values, pair: "EUR/KRW" } }, { ...usd, id: "E3", values: { ...usd.values, pair: "JPY(100)/KRW" } }]);
    const tool = fxTool();
    expect(await ensureOtherPairs(full, "최근 90일간 환율이 왜 움직였어?", "fx", [tool])).toEqual([]);
    expect(tool.invoke).not.toHaveBeenCalled();
  });

  it("tool 호출이 실패해도 throw 하지 않는다 (래퍼가 error step 을 남기고 리포트는 이어짐)", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([usd]);
    const tool = fxTool(vi.fn(async () => { throw new Error("Frankfurter 503"); }));
    await expect(ensureOtherPairs(ctx, "환율이 왜 움직여?", "fx", [tool])).resolves.toHaveLength(2);
  });
});

describe("ensureCpiCategories: 물가 원인 질문의 품목군별 등락률 · 기여도를 코드가 채운다", () => {
  const macroTool = (invoke = vi.fn(async () => "ok")): InvokableTool & { invoke: ReturnType<typeof vi.fn> } => ({ name: "get_macro_indicators", invoke });
  const cpi: Evidence = {
    id: "E1", tool: "get_macro_indicators", label: "물가 · 고용 지표 확인 · 한국은행 ECOS",
    values: { indicator: "cpi", country: "KR", "latest.month": "202610", "latest.value": 120.73, "latest.previousYear.change": 2.818941 },
    source: { name: "한국은행 ECOS — 소비자물가지수 총지수", url: "https://ecos.bok.or.kr/", asOf: "2026-10-01" },
  };

  it("물가 질문이면 거시지표 tool 을 조사가 받은 총지수의 관측 월로 cpi_categories 한 번 부른다 (같은 장부 · 같은 래퍼)", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([cpi]);
    const tool = macroTool();
    expect(await ensureCpiCategories(ctx, "최근 우리나라 물가가 왜 올랐어?", [tool])).toBe(true);
    expect(tool.invoke).toHaveBeenCalledTimes(1);
    expect(JSON.parse(tool.invoke.mock.calls[0]![1] as string)).toEqual({ ...CPI_CATEGORIES_INPUT, endMonth: "202610" });
    expect(tool.invoke.mock.calls[0]![0].context).toBe(ctx);
  });

  it("물가 질문이 아니거나, tool 이 없거나, 이미 품목군 항목이 있으면 부르지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([cpi]);
    const tool = macroTool();
    expect(await ensureCpiCategories(ctx, "요즘 원달러 환율이 왜 이렇게 움직여?", [tool])).toBe(false);
    expect(await ensureCpiCategories(ctx, "물가가 왜 올랐어?", [{ name: "get_rate_data", invoke: vi.fn() }])).toBe(false);
    const full = new ResearchContext();
    full.addEvidence([cpi, { ...cpi, id: "E2-1", values: { indicator: "cpi_categories", category: "교통", yoyPct: 6.8, contributionPp: 0.75 } }]);
    expect(await ensureCpiCategories(full, "물가가 왜 올랐어?", [tool])).toBe(false);
    // 조사가 한국 CPI 총지수를 받아 오지 않았으면(미국 물가 · 조회 실패) 최신 한국 품목군을 붙이지 않는다
    expect(await ensureCpiCategories(new ResearchContext(), "물가가 왜 올랐어?", [tool])).toBe(false);
    const us = new ResearchContext();
    us.addEvidence([{ ...cpi, values: { ...cpi.values, country: "US" } }]);
    expect(await ensureCpiCategories(us, "미국 물가가 왜 올랐어?", [tool])).toBe(false);
    expect(tool.invoke).not.toHaveBeenCalled();
    expect(["소비자물가 상승 원인은?", "인플레이션이 왜 심해?", "CPI 가 왜 올랐어"].every(isPriceQuestion)).toBe(true);
    expect(isPriceQuestion("KODEX 200 사도 돼?")).toBe(false);
  });

  it("tool 호출이 실패해도 throw 하지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([cpi]);
    const tool = macroTool(vi.fn(async () => { throw new Error("ECOS 503"); }));
    await expect(ensureCpiCategories(ctx, "물가가 왜 올랐어?", [tool])).resolves.toBe(true);
  });
});
