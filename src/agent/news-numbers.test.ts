import { describe, expect, it } from "vitest";
import { dropNewsCards, newsCardNote } from "./news-numbers";
import type { Evidence, WriterOutput } from "./schema";

const news: Evidence = { id: "E1-1", tool: "get_korean_economic_news", label: "경제 뉴스 확인 · 연합뉴스", values: { title: "김장재료 최대 40% 할인…배추 2,990원", body: "not_requested" }, source: { name: "연합뉴스", url: "https://www.yna.co.kr/view/x", asOf: "2026-11-20" } };
const fx: Evidence = { id: "E2", tool: "get_fx_krw_rate", label: "환율 확인", values: { rate: 1332.14 }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-11-20" } };
const calc: Evidence = { id: "C1", tool: "calc_index_today", label: "당일 종가", values: { close: 4869.96 }, source: { name: "연합뉴스", url: "https://www.yna.co.kr/view/y", asOf: "2026-11-20" } };
const card = (ref: string | null, value: string) => ({ label: "x", value, change: "", asOf: "2026-11-20", ref });
const output = (numbers: WriterOutput["numbers"]): WriterOutput => ({ summary: "요약", numbers, why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] });

describe("기사 숫자는 숫자 카드로 올리지 않는다 (11/21)", () => {
  it("기사 항목을 가리키는 카드만 빼고, 데이터 · 계산 항목과 ref 없는 카드는 둔다", () => {
    const out = dropNewsCards(output([card("E1-1", "2,990원"), card("E2", "1,332.14원"), card("C1", "4,869.96"), card(null, "3%")]), [news, fx, calc]);
    expect(out.numbers.map((n) => n.ref)).toEqual(["E2", "C1", null]);
    expect(out.summary).toBe("요약");
  });

  it("뺄 것이 없거나 장부에 기사가 없으면 받은 그대로 돌려준다", () => {
    const kept = output([card("E2", "1,332.14원")]);
    expect(dropNewsCards(kept, [news, fx])).toBe(kept);
    expect(dropNewsCards(kept, [fx])).toBe(kept);
  });

  it("작성에는 장부에 기사가 있을 때만 알린다", () => {
    expect(newsCardNote([news, fx])).toContain("[기사 속 숫자]");
    expect(newsCardNote([fx])).toBe("");
  });
});
