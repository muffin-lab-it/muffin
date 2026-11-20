import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import type { Evidence } from "./schema";
import { CPI_CATEGORIES_INPUT, ensureCpiCategories, ensureIndexProxy, ensureOtherPairs, indexCaveats, indexNote, indexProxyFor, withIndexNumbers, isPriceQuestion, type InvokableTool } from "./supplement";

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

describe("ensureIndexProxy: 지수 질문의 지수 값을 코드가 채운다 (11/20 베타)", () => {
  const kospi: Evidence = {
    id: "E2",
    tool: "get_etf_kr_price",
    label: "국내 ETF 시세 확인",
    values: { name: "KODEX 코스피", baseIndex: "코스피", "latest.date": "2026-11-19", "latest.close": 52960, "latest.indexClose": 5137.89, "period.from": "2026-10-20", "period.to": "2026-11-19", "period.indexCloseFrom": 5552.74, "period.indexReturnPct": -7.47108634656043 },
    source: { name: "금융위원회", url: "https://www.data.go.kr", asOf: "2026-11-19" },
  };

  it("지수를 묻는 질문만 그 지수를 따라가는 ETF 로 잇는다", () => {
    expect(indexProxyFor("요즘 코스피 어때 ?")).toEqual({ index: "코스피", query: "KODEX 코스피" });
    expect(indexProxyFor("코스피200 얼마야?")).toEqual({ index: "코스피 200", query: "KODEX 200" });
    expect(indexProxyFor("코스닥 150 지수 알려줘")).toEqual({ index: "코스닥 150", query: "KODEX 코스닥150" });
    expect(indexProxyFor("KODEX 200이 코스피 200을 잘 따라가?")).toBeNull();
    expect(indexProxyFor("환율 왜 올랐어?")).toBeNull();
    expect(indexProxyFor("코스피100 지수 어때?")).toBeNull();
    expect(indexProxyFor("코스피 50 얼마야?")).toBeNull();
  });

  it("장부에 지수 값이 없으면 ETF tool 을 부르고, 결과가 장부에 오르면 작성에 지수 값을 알려 준다", async () => {
    const ctx = new ResearchContext();
    const invoke = vi.fn(async (...args: [unknown, string]) => { ctx.addEvidence([kospi]); return args.length ? "ok" : ""; });
    const proxy = await ensureIndexProxy(ctx, "요즘 코스피 어때 ?", [{ name: "get_etf_kr_price", invoke }]);
    expect(invoke.mock.calls[0]![1]).toBe('{"query":"KODEX 코스피","days":30}');
    expect(proxy).toEqual({ index: "코스피", query: "KODEX 코스피" });
    const note = indexNote(ctx.evidence, proxy!);
    expect(note).toContain("[지수 값]");
    expect(note).toContain("코스피 지수 종가: 5,137.89 (기준일 2026-11-19)");
    expect(note).toContain("지수 기간 수익률: -7.47%");
    expect(note).toContain("ref 는 E2");
  });

  it("작성이 지수 숫자를 빠뜨리면 코드가 맨 앞에 넣고, 이미 썼으면(값 · 변화 칸) 넣지 않는다", () => {
    const proxy = { index: "코스피", query: "KODEX 코스피" };
    const empty = { summary: "", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] };
    const filled = withIndexNumbers(empty, [kospi], proxy);
    expect(filled.numbers).toEqual([
      { label: "코스피 지수 종가", value: "5,137.89", change: "", asOf: "2026-11-19", ref: "E2" },
      { label: "코스피 지수 기간 수익률", value: "-7.47%", change: "2026-10-20~2026-11-19", asOf: "2026-11-19", ref: "E2" },
    ]);
    const written = { ...empty, numbers: [{ label: "코스피 종가", value: "5,137.89", change: "30일 -7.47%", asOf: "2026-11-19", ref: "E2" }] };
    expect(withIndexNumbers(written, [kospi], proxy)).toBe(written);
    expect(withIndexNumbers(empty, [], proxy)).toBe(empty);
  });

  it("지수 기준일이 하루 늦다는 주의점은 작성이 이미 썼으면 넣지 않는다", () => {
    const proxy = { index: "코스피", query: "KODEX 코스피" };
    expect(indexCaveats([kospi], proxy)[0]).toContain("2026-11-19 종가");
    expect(indexCaveats([kospi], proxy, ["지수 종가는 하루 늦게 공개되는 자료입니다."])).toEqual([]);
  });

  it("이미 있으면 다시 부르지 않고, 지수 질문이 아니거나 조회가 실패하면 null 이다", async () => {
    const have = new ResearchContext();
    have.addEvidence([kospi]);
    const invoke = vi.fn(async () => "ok");
    expect(await ensureIndexProxy(have, "코스피 어때?", [{ name: "get_etf_kr_price", invoke }])).not.toBeNull();
    expect(await ensureIndexProxy(new ResearchContext(), "환율 얼마야?", [{ name: "get_etf_kr_price", invoke }])).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    const failing = vi.fn(async () => { throw new Error("x"); });
    expect(await ensureIndexProxy(new ResearchContext(), "코스피 어때?", [{ name: "get_etf_kr_price", invoke: failing }])).toBeNull();
  });
});
