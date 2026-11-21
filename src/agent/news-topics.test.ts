import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { MACRO_TOPICS, addMacroNews, isGeneralNewsQuestion, macroNewsNote } from "./news-topics";
import type { Evidence } from "./schema";

const article = (title: string, url: string) => ({ title, url, publisher: "연합뉴스", publishedAt: "2026-11-20T07:29:21.000Z", source: "yonhap", body: { status: "not_requested" } });
/** 주제어마다 그 주제의 기사 두 건. "증시" 의 첫 기사는 "코스피" 의 첫 기사와 같은 주소 */
const newsFor = vi.fn(async (input: { query: string }) => ({
  data: { articles: [article(`${input.query} 기사 1`, input.query === "증시" ? "https://y/코스피-1" : `https://y/${input.query}-1`), article(`${input.query} 기사 2`, `https://y/${input.query}-2`)] } as never,
}));

describe("주제 없는 뉴스 질문의 기사 고르기 (11/21)", () => {
  it("주제 없이 뉴스를 묻는 질문만 대상이다", () => {
    expect(isGeneralNewsQuestion("오늘 경제 뉴스 알려줘")).toBe(true);
    expect(isGeneralNewsQuestion("이번 주 경제 이슈 뭐 있어?")).toBe(true);
    expect(isGeneralNewsQuestion("환율 관련 뉴스 알려줘")).toBe(false);
    expect(isGeneralNewsQuestion("오늘 달러 환율 얼마야?")).toBe(false);
    expect(isGeneralNewsQuestion("요즘 코스피 어때?")).toBe(false);
  });

  it("주제어별 기사를 번갈아 골라 장부에 올린다. 같은 주소는 한 번만, 최대 6건", async () => {
    const ctx = new ResearchContext();
    const entries = await addMacroNews(ctx, "오늘 경제 뉴스 알려줘", newsFor as never);
    expect(newsFor).toHaveBeenCalledTimes(MACRO_TOPICS.length);
    expect(newsFor.mock.calls[0]![0]).toMatchObject({ sources: ["yonhap", "hankyung"], query: "코스피", content: "list" });
    // 첫 바퀴: 주제마다 첫 기사 (증시의 첫 기사는 코스피와 같은 주소라 빠짐) → 둘째 바퀴에서 6건까지
    expect(entries.map((e) => e.values.title)).toEqual(["코스피 기사 1", "환율 기사 1", "금리 기사 1", "물가 기사 1", "수출 기사 1", "코스피 기사 2"]);
    expect(entries.map((e) => e.id)).toEqual(["E1-1", "E1-2", "E1-3", "E1-4", "E1-5", "E1-6"]);
    expect(entries[0]).toMatchObject({ tool: "get_korean_economic_news", values: { body: "not_requested" }, source: { name: "연합뉴스", url: "https://y/코스피-1", asOf: "2026-11-20" } });
    expect(ctx.evidence).toHaveLength(6);
    expect(ctx.steps.at(-1)).toMatchObject({ tool: "get_korean_economic_news", status: "ok" });
  });

  it("이미 장부에 있는 기사는 다시 올리지 않고, 대상이 아니거나 못 찾으면 아무것도 하지 않는다", async () => {
    const ctx = new ResearchContext();
    const have: Evidence = { id: "E1-1", tool: "get_korean_economic_news", label: "뉴스", values: { title: "코스피 기사 1" }, source: { name: "연합뉴스", url: "https://y/코스피-1", asOf: "2026-11-20" } };
    ctx.addEvidence([have]);
    const entries = await addMacroNews(ctx, "오늘 경제 뉴스 알려줘", newsFor as never);
    expect(entries.map((e) => e.source.url)).not.toContain("https://y/코스피-1");

    const none = new ResearchContext();
    expect(await addMacroNews(none, "환율 관련 뉴스 알려줘", newsFor as never)).toEqual([]);
    expect(await addMacroNews(none, "오늘 경제 뉴스 알려줘", vi.fn(async () => { throw new Error("RSS 실패"); }) as never)).toEqual([]);
    expect(none.evidence).toEqual([]);
    expect(none.steps).toEqual([]);
  });

  it("주제어가 있어도 사진 · 행사 · 지역 특산물 기사는 고르지 않는다 (11/21 실측: 창원산 파프리카)", async () => {
    const news = vi.fn(async (input: { query: string }) => ({
      data: { articles: input.query === "수출" ? [article("창원산 파프리카 3t 일본으로…올해 첫 수출", "https://y/p"), article("[포토] 수출 1조 달러 달성 계기 오찬 간담회", "https://y/q"), article("11월 1~20일 수출 8.2% 증가", "https://y/r")] : [] } as never,
    }));
    const entries = await addMacroNews(new ResearchContext(), "오늘 경제 뉴스 알려줘", news as never);
    expect(entries.map((e) => e.values.title)).toEqual(["11월 1~20일 수출 8.2% 증가"]);
  });

  it("작성에는 보탠 기사의 번호와 제목을 직접 알리고, 없으면 붙이지 않는다", async () => {
    const entries = await addMacroNews(new ResearchContext(), "오늘 경제 뉴스 알려줘", newsFor as never);
    const note = macroNewsNote(entries);
    expect(note).toContain("[경제 뉴스 고르기]");
    expect(note).toContain("- E1-2 · 연합뉴스 · 환율 기사 1");
    expect(note).toContain("상품 출시 · 할인 · 품절");
    expect(macroNewsNote([])).toBe("");
  });
});
