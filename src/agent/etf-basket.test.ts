import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { ETF_BASKET, basketNote, basketRows, ensureEtfBasket, isGeneralEtfQuestion, withBasketNumbers } from "./etf-basket";
import type { Evidence, WriterOutput } from "./schema";

const etf = (id: string, name: string, returnPct: number): Evidence => ({
  id,
  tool: "get_etf_kr_price",
  label: "국내 ETF 시세 확인",
  values: { name, "latest.close": 80630, "period.from": "2026-10-20", "period.to": "2026-11-19", "period.returnPct": returnPct },
  source: { name: "금융위원회 증권상품시세정보", url: "https://www.data.go.kr/data/15094806/openapi.do", asOf: "2026-11-19" },
});
const kodex = etf("E1", "KODEX 200", -7.060111);
const bond = etf("E5", "ACE 국고채10년", 2.29);
const kosdaq = etf("E2", "KODEX 코스닥150", -13.686618);
const output = (numbers: WriterOutput["numbers"]): WriterOutput => ({ summary: "", numbers, why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] });

describe("종목을 정하지 않은 ETF 질문 (11/21)", () => {
  it("종목 · 테마 없이 ETF 를 묻는 질문만 대상이다. 개념 질문은 아니다", () => {
    expect(isGeneralEtfQuestion("etf 요즘 뭐가 좋아 ?")).toBe(true);
    expect(isGeneralEtfQuestion("요즘 ETF 어때?")).toBe(true);
    expect(isGeneralEtfQuestion("KODEX 200 요즘 어때?")).toBe(false);
    expect(isGeneralEtfQuestion("나스닥 ETF 뭐가 좋아?")).toBe(false);
    expect(isGeneralEtfQuestion("배당 ETF 추천해줘")).toBe(false);
    expect(isGeneralEtfQuestion("etf가 뭐야?")).toBe(false);
    expect(isGeneralEtfQuestion("최근 1년 ETF 어때?")).toBe(false);
    expect(isGeneralEtfQuestion("환율 왜 올랐어?")).toBe(false);
  });

  it("고정 목록 중 장부에 없는 것만 종목코드로 조회한다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([kodex]);
    const invoke = vi.fn(async (...args: [unknown, string]) => (args.length ? "ok" : ""));
    expect(await ensureEtfBasket(ctx, "etf 요즘 뭐가 좋아 ?", [{ name: "get_etf_kr_price", invoke }])).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(ETF_BASKET.length - 1);
    expect(invoke.mock.calls[0]![1]).toBe('{"query":"229200","days":30}');
    invoke.mockClear();
    expect(await ensureEtfBasket(ctx, "KODEX 200 요즘 어때?", [{ name: "get_etf_kr_price", invoke }])).toBe(false);
    expect(await ensureEtfBasket(ctx, "etf 요즘 뭐가 좋아 ?", [{ name: "get_fx_krw_rate", invoke }])).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("일부 조회가 실패해도 throw 하지 않는다", async () => {
    const failing = vi.fn(async () => { throw new Error("금융위 API 실패"); });
    await expect(ensureEtfBasket(new ResearchContext(), "요즘 ETF 어때?", [{ name: "get_etf_kr_price", invoke: failing }])).resolves.toBe(true);
  });

  it("작성에는 자산군과 수익률, 가장 높은 것 · 낮은 것을 알리고 권유 표현을 막는다. 하나뿐이면 붙이지 않는다", () => {
    expect(basketRows([bond, kodex, kosdaq]).map((r) => r.item.name)).toEqual(["KODEX 200", "KODEX 코스닥150", "ACE 국고채10년"]);
    const note = basketNote([kodex, kosdaq, bond]);
    expect(note).toContain("[대표 ETF 비교]");
    expect(note).toContain("- KODEX 200 (국내 대형주, ref E1): -7.06%");
    expect(note).toContain("가장 높은 것은 ACE 국고채10년(+2.29%), 가장 낮은 것은 KODEX 코스닥150(-13.69%)");
    expect(note).toContain("좋다 · 낫다 · 유망하다고 쓰지 않고");
    expect(basketNote([kodex])).toBe("");
  });

  it("비교 기간이 다른 결과는 나란히 놓지 않는다 (조사가 1년으로 받은 KODEX 200)", () => {
    const yearly = { ...kodex, values: { ...kodex.values, "period.from": "2025-11-19", "period.returnPct": 31.2 } };
    expect(basketRows([yearly, kosdaq, bond]).map((r) => r.item.name)).toEqual(["KODEX 코스닥150", "ACE 국고채10년"]);
    const shifted = { ...bond, values: { ...bond.values, "period.from": "2026-10-21" } };
    expect(basketRows([kodex, kosdaq, shifted]).map((r) => r.item.name)).toEqual(["KODEX 200", "KODEX 코스닥150"]);
  });

  it("수익률 카드를 목록 순서대로 넣고, 작성이 같은 ETF 로 쓴 카드는 뺀다", () => {
    const fx: Evidence = { id: "E9", tool: "get_fx_krw_rate", label: "환율", values: { rate: 1332.14 }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-11-20" } };
    const card = (ref: string, value: string) => ({ label: "x", value, change: "", asOf: "2026-11-19", ref });
    const out = withBasketNumbers(output([card("E1", "80,630원"), card("E9", "1,332.14원")]), [bond, kodex, fx]);
    expect(out.numbers).toEqual([
      { label: "KODEX 200 (국내 대형주)", value: "-7.06%", change: "2026-10-20~2026-11-19", asOf: "2026-11-19", ref: "E1" },
      { label: "ACE 국고채10년 (국내 국채)", value: "+2.29%", change: "2026-10-20~2026-11-19", asOf: "2026-11-19", ref: "E5" },
      card("E9", "1,332.14원"),
    ]);
    const kept = output([card("E1", "80,630원")]);
    expect(withBasketNumbers(kept, [kodex])).toBe(kept);
  });
});
