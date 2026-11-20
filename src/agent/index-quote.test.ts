import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { addTodayClose, consistent, ensureIndex, indexCaveats, indexFor, indexNote, indexRefs, parseClose, sessionDate, withIndexNumbers } from "./index-quote";
import type { Evidence } from "./schema";

const official: Evidence = {
  id: "E2",
  tool: "get_kr_stock_index",
  label: "국내 지수 확인",
  values: { index: "코스피", "latest.date": "2026-11-19", "latest.close": 5137.89, "latest.change": 70.45, "latest.changePct": 1.39, "period.from": "2026-10-20", "period.to": "2026-11-19", "period.closeFrom": 5552.74, "period.change": -414.85, "period.returnPct": -7.47 },
  source: { name: "금융위원회 지수시세정보", url: "https://www.data.go.kr/data/15094807/openapi.do", asOf: "2026-11-19" },
};
const body = "(서울=연합뉴스) 20일 코스피와 코스닥이 5% 넘게 급락 마감했다.\n\n이날 코스피는 전장보다 267.93포인트(5.21%) 내린 4,869.96에 거래를 마쳤다.";
const article = (text: string, publishedAt = "2026-11-20T07:29:21.000Z") => ({ title: "코스피 급락", url: "https://www.yna.co.kr/view/AKR1", publisher: "연합뉴스", publishedAt, source: "yonhap", body: { status: "available", text } });
const newsOf = (...articles: ReturnType<typeof article>[]) => vi.fn(async (input: { query: string; content: string }) => ({ data: { articles: input ? articles : [] } as never }));
const empty = { summary: "", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] };

describe("지수 질문의 지수 값 (11/21)", () => {
  it("국내 지수를 묻는 질문만 고른다. ETF 질문과 세부 지수는 아니다", () => {
    expect(indexFor("요즘 코스피 어때 ?")).toBe("코스피");
    expect(indexFor("코스닥은 요즘 어때?")).toBe("코스닥");
    expect(indexFor("코스피200 얼마야?")).toBe("코스피 200");
    expect(indexFor("코스닥 150 지수 알려줘")).toBe("코스닥 150");
    expect(indexFor("코스피100 지수 어때?")).toBeNull();
    expect(indexFor("KODEX 200이 코스피 200을 잘 따라가?")).toBeNull();
    expect(indexFor("라이즈 코스피 요즘 어때?")).toBeNull();
    expect(indexFor("에이스 코스피 수익률 알려줘")).toBeNull();
    expect(indexFor("환율 왜 올랐어?")).toBeNull();
  });

  it("기사 본문의 마감 문장을 읽고, 공식 전일 종가로 검산한다", () => {
    expect(parseClose(body, "코스피")).toEqual({ close: 4869.96, change: -267.93, changePct: -5.21 });
    expect(parseClose("코스닥은 전일 대비 39.13포인트(5.71%)내린 645.68에 장을 마쳤다.", "코스닥")).toEqual({ close: 645.68, change: -39.13, changePct: -5.71 });
    expect(parseClose("코스피는 전장보다 70.45포인트(1.39%) 오른 5,137.89에 마쳤다.", "코스피")).toEqual({ close: 5137.89, change: 70.45, changePct: 1.39 });
    expect(parseClose(body, "코스닥")).toBeNull();
    // 개장 · 장중 값은 검산이 맞아도 종가가 아니다
    expect(parseClose("코스피는 전장보다 10.00포인트(0.19%) 오른 5,147.89에 출발했다.", "코스피")).toBeNull();
    expect(parseClose("코스피는 전장보다 10.00포인트(0.19%) 오른 5,147.89를 기록 중이다. 전날은 하락 마감했다.", "코스피")).toBeNull();
    // 한 문장에 두 지수가 있고 끝에 마감 표현이 있으면 앞의 지수도 종가다
    expect(parseClose("이날 코스피는 전거래일 대비 267.93포인트(5.21%)내린 4,869.96, 코스닥은 전일 대비 39.13포인트(5.71%)내린 645.68에 장을 마쳤다.", "코스피")).toEqual({ close: 4869.96, change: -267.93, changePct: -5.21 });
    expect(parseClose("다이소 김장 용품 5,000원 할인", "코스피")).toBeNull();
    expect(consistent(5137.89, { close: 4869.96, change: -267.93, changePct: -5.21 })).toBe(true);
    expect(consistent(5067.44, { close: 4869.96, change: -267.93, changePct: -5.21 })).toBe(false);
    // 변화폭은 맞아도 등락률이 어긋나면 받지 않는다
    expect(consistent(5137.89, { close: 4869.96, change: -267.93, changePct: -52.1 })).toBe(false);
  });

  it("거래일은 발행일이 아니라 본문의 날짜에서 읽는다", () => {
    expect(sessionDate(body, "2026-11-20T07:29:21.000Z")).toBe("2026-11-20");
    // 다음 날 아침 · 주말에 나온 기사가 20일 마감을 다시 쓰면 20일
    expect(sessionDate(body, "2026-11-20T23:30:00.000Z")).toBe("2026-11-20");
    expect(sessionDate(body, "2026-11-22T01:00:00.000Z")).toBe("2026-11-20");
    expect(sessionDate("이날 코스피는 하락 마감했다.", "2026-11-20T07:29:21.000Z")).toBeNull();
    expect(sessionDate("3일 코스피는 하락 마감했다.", "2026-11-20T07:29:21.000Z")).toBeNull();
  });

  it("공식 자료보다 뒤에 나온 기사의 종가가 검산에 맞으면 계산 항목(C 번호)으로 장부에 올린다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([official]);
    const news = newsOf(article("숫자 없는 기사"), article(body));
    const entry = await addTodayClose(ctx, "코스피", news as never);
    expect(entry).toMatchObject({ id: "C1", tool: "calc_index_today", values: { index: "코스피", date: "2026-11-20", close: 4869.96, change: -267.93, changePct: -5.21, prevClose: 5137.89, prevDate: "2026-11-19" }, source: { name: "연합뉴스", url: "https://www.yna.co.kr/view/AKR1", asOf: "2026-11-20" }, lineage: { inputs: ["E2"] } });
    expect(ctx.steps.at(-1)).toMatchObject({ tool: "calc_index_today", status: "ok" });
    expect(news.mock.calls[0]![0]).toMatchObject({ query: "코스피", content: "body" });
  });

  it("검산이 안 맞거나, 공식 자료와 같은 날 기사거나, 기사를 못 받으면 올리지 않는다", async () => {
    const wrong = new ResearchContext();
    wrong.addEvidence([{ ...official, values: { ...official.values, "latest.close": 5067.44 } }]);
    expect(await addTodayClose(wrong, "코스피", newsOf(article(body)) as never)).toBeUndefined();
    const sameDay = new ResearchContext();
    sameDay.addEvidence([official]);
    expect(await addTodayClose(sameDay, "코스피", newsOf(article(body, "2026-11-19T07:00:00.000Z")) as never)).toBeUndefined();
    expect(await addTodayClose(sameDay, "코스피", vi.fn(async () => { throw new Error("RSS 실패"); }) as never)).toBeUndefined();
    expect(sameDay.evidence).toHaveLength(1);
    expect(await addTodayClose(new ResearchContext(), "코스피", newsOf(article(body)) as never)).toBeUndefined();
    // 다음 날 기사가 전날 마감을 다시 쓴 문장은 날짜를 정할 수 없어 건너뛴다
    const recap = new ResearchContext();
    recap.addEvidence([official]);
    const next = article("21일 금융투자업계에 따르면 전날 코스피는 전장보다 267.93포인트(5.21%) 내린 4,869.96에 거래를 마쳤다.", "2026-11-21T00:10:00.000Z");
    expect(await addTodayClose(recap, "코스피", newsOf(next) as never)).toBeUndefined();
  });

  it("ensureIndex 는 지수 tool 을 부르고, 지수 질문이 아니거나 조회가 실패하면 null 이다", async () => {
    const ctx = new ResearchContext();
    const invoke = vi.fn(async (...args: [unknown, string]) => { ctx.addEvidence([official]); return args.length ? "ok" : ""; });
    expect(await ensureIndex(ctx, "요즘 코스피 어때 ?", { name: "get_kr_stock_index", invoke }, newsOf(article(body)) as never)).toBe("코스피");
    expect(invoke.mock.calls[0]![1]).toBe('{"index":"코스피","days":30}');
    expect(indexRefs(ctx.evidence, "코스피")).toEqual(["E2", "C1"]);
    const failing = vi.fn(async () => { throw new Error("x"); });
    expect(await ensureIndex(new ResearchContext(), "코스피 어때?", { name: "get_kr_stock_index", invoke: failing }, newsOf() as never)).toBeNull();
    expect(await ensureIndex(new ResearchContext(), "환율 얼마야?", { name: "get_kr_stock_index", invoke: failing }, newsOf() as never)).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("작성에는 두 값을 기준일과 출처 종류로 나눠 알리고, 숫자 칸이 비면 코드가 채운다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([official]);
    await addTodayClose(ctx, "코스피", newsOf(article(body)) as never);
    const note = indexNote(ctx.evidence, "코스피");
    expect(note).toContain("공식 자료 (ref E2");
    expect(note).toContain("종가 5,137.89 (2026-11-19), 전일 대비 +1.39%");
    expect(note).toContain("기사 보도 (ref C1, 연합뉴스");
    expect(note).toContain("2026-11-20 종가 4,869.96, 전일 대비 -5.21% (-267.93포인트)");
    expect(withIndexNumbers(empty, ctx.evidence, "코스피").numbers).toEqual([
      { label: "코스피 종가 (기사 보도)", value: "4,869.96", change: "전일 대비 -5.21%", asOf: "2026-11-20", ref: "C1" },
      { label: "코스피 종가 (공식 자료)", value: "5,137.89", change: "", asOf: "2026-11-19", ref: "E2" },
      { label: "코스피 기간 변화 (공식 자료)", value: "-7.47%", change: "2026-10-20~2026-11-19", asOf: "2026-11-19", ref: "E2" },
    ]);
  });

  it("작성이 이미 쓴 숫자는 다시 넣지 않고, 이름에 어느 쪽 값인지만 붙인다", () => {
    const written = { ...empty, numbers: [{ label: "코스피 종가", value: "5,137.89포인트", change: "2026-10-20~2026-11-19 기간 -7.47%", asOf: "2026-11-19", ref: "E2" }] };
    expect(withIndexNumbers(written, [official], "코스피").numbers).toEqual([{ ...written.numbers[0], label: "코스피 종가 (공식 자료)" }]);
    expect(withIndexNumbers(empty, [], "코스피")).toBe(empty);
  });

  it("기준일이 다른 이유를 주의점에 한 줄 넣고, 작성이 이미 썼으면 넣지 않는다", () => {
    expect(indexCaveats([official], "코스피")[0]).toContain("2026-11-19 종가가 최신");
    expect(indexCaveats([official], "코스피", ["공식 자료는 다음 영업일에 공개됩니다."])).toEqual([]);
    expect(indexCaveats([], "코스피")).toEqual([]);
  });
});
