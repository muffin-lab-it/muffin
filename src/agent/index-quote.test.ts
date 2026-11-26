import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { addTodayClose, consistent, dropDailyCloseTalk, ensureIndex, ensureIndexes, indexCaveats, indexDays, indexesFor, indexFor, indexNote, indexRefs, officialIndex, parseClose, sessionDate, withIndexNumbers } from "./index-quote";
import type { Evidence, WriterOutput } from "./schema";

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
    // 미국 지수
    expect(indexFor("나스닥 요즘 어때?")).toBe("나스닥 종합");
    expect(indexFor("나스닥100 지수 얼마야?")).toBe("나스닥 100");
    expect(indexFor("S&P500 한 달 동안 얼마나 빠졌어?")).toBe("S&P 500");
    expect(indexFor("다우 지수 알려줘")).toBe("다우존스");
    expect(indexFor("TIGER 미국배당다우존스 어때?")).toBeNull();
    expect(indexFor("다우니 섬유유연제 가격")).toBeNull();
    // 선물 같은 파생상품과 개념 질문은 현물 지수 값으로 답할 수 없다
    expect(indexFor("나스닥 선물 시세 알려줘")).toBeNull();
    expect(indexFor("코스피 200 선물 현황 알려줘")).toBeNull();
    expect(indexFor("코스피가 뭐야?")).toBeNull();
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
    expect(note).toContain("종가 5,137.89 (2026-11-19), 전일 대비 +1.39% (상승)");
    // 하루는 상승 · 기간은 하락이라 방향 낱말과 "질문 방향에 맞추지 않는다" 를 알림 (11/25 운영 코스닥)
    expect(note).toContain("2026-10-20 종가 5,552.74 와 비교해 -7.47% (하락)");
    expect(note).toContain("질문이 \"떨어졌어 · 올랐어\" 라고 해도 방향을 바꾸지 않습니다");
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

  it("미국 지수는 미국 지수 tool 을 부르고, 기사 검산은 하지 않는다. 같은 값은 표기가 달라도 다시 넣지 않는다", async () => {
    const nasdaq: Evidence = { ...official, id: "E2", tool: "get_us_stock_index", values: { ...official.values, index: "나스닥 종합", "latest.close": 23879.2, "latest.changePct": -2.25, "period.returnPct": -9.63 }, source: { name: "FRED", url: "https://fred.stlouisfed.org/series/NASDAQCOM", asOf: "2026-11-19" } };
    const ctx = new ResearchContext();
    const invoke = vi.fn(async (...args: [unknown, string]) => { ctx.addEvidence([nasdaq]); return args.length ? "ok" : ""; });
    const news = newsOf(article(body));
    expect(await ensureIndex(ctx, "나스닥 요즘 어때?", { name: "get_us_stock_index", invoke }, news as never)).toBe("나스닥 종합");
    expect(invoke.mock.calls[0]![1]).toBe('{"index":"나스닥 종합","days":30}');
    expect(news).not.toHaveBeenCalled();
    expect(indexNote(ctx.evidence, "나스닥 종합")).toContain("하루 이틀 늦게 올라오는 자료라 2026-11-19 종가가 최신");
    expect(indexCaveats(ctx.evidence, "나스닥 종합")[0]).toContain("하루 이틀 늦게");
    const written = { ...empty, numbers: [{ label: "나스닥 종합 종가", value: "23,879.2포인트", change: "전일 대비 -2.25%", asOf: "2026-11-19", ref: "E2" }] };
    expect(withIndexNumbers(written, ctx.evidence, "나스닥 종합").numbers.map((n) => n.label)).toEqual(["나스닥 종합 기간 변화 (공식 자료)", "나스닥 종합 종가 (공식 자료)"]);
  });

  it("부호가 반대인 숫자는 같은 값으로 보지 않는다 (전일 +2.00% 와 기간 -2.00%)", () => {
    const flip = { ...official, values: { ...official.values, "latest.changePct": 2, "period.returnPct": -2 } };
    const written = { ...empty, numbers: [{ label: "코스피 종가", value: "5,137.89", change: "전일 대비 +2.00%", asOf: "2026-11-19", ref: "E2" }] };
    expect(withIndexNumbers(written, [flip], "코스피").numbers.map((n) => n.value)).toEqual(["-2.00%", "5,137.89"]);
  });

  it("기준일이 다른 이유를 주의점에 한 줄 넣고, 작성이 이미 썼으면 넣지 않는다", () => {
    expect(indexCaveats([official], "코스피")[0]).toContain("2026-11-19 종가가 최신");
    expect(indexCaveats([official], "코스피", ["공식 자료는 다음 영업일에 공개됩니다."])).toEqual([]);
    expect(indexCaveats([], "코스피")).toEqual([]);
  });
});

describe("여러 지수 · 질문의 기간 (11/26 운영 mwwu02ns-uzqmor)", () => {
  const Q = "아휴 배고파 근데 오늘 코스피랑 코스닥 왜이렇게 떨어지지 코스피랑 코스닥 일주일 추세 좀 알려줘";
  const kosdaq = (id: string, from = "2026-11-17"): Evidence => ({
    ...official,
    id,
    values: { ...official.values, index: "코스닥", "latest.date": "2026-11-24", "latest.close": 665.88, "latest.changePct": 4.79, "period.from": from, "period.to": "2026-11-24", "period.closeFrom": 700.1, "period.returnPct": -4.89 },
  });
  const kospi7: Evidence = { ...official, id: "E3", values: { ...official.values, "latest.date": "2026-11-24", "period.from": "2026-11-17", "period.to": "2026-11-24", "period.returnPct": -6.1 } };

  it("질문에 나온 지수를 나온 순서로 모두 (최대 3개), ETF 질문은 빈 배열", () => {
    expect(indexesFor(Q)).toEqual(["코스피", "코스닥"]);
    expect(indexesFor("나스닥이랑 코스피 요즘 어때?")).toEqual(["나스닥 종합", "코스피"]);
    expect(indexesFor("코스피 코스닥 나스닥 다우 다 알려줘")).toEqual(["코스피", "코스닥", "나스닥 종합"]);
    expect(indexesFor("KODEX 200이랑 코스닥 비교")).toEqual([]);
    expect(indexFor(Q)).toBe("코스피");
  });

  it("기간: 일주일 · 이번 주 · 지난주 7일, 한 달 · 말 없음 30일", () => {
    expect(indexDays(Q)).toBe(7);
    expect(indexDays("이번 주 코스피 어때?")).toBe(7);
    expect(indexDays("코스피 한 달 동안 어땠어?")).toBe(30);
    expect(indexDays("요즘 코스피 어때?")).toBe(30);
  });

  it("물은 지수마다 질문의 기간으로 받는다", async () => {
    const ctx = new ResearchContext();
    const invoke = vi.fn(async (_run: unknown, input: string) => {
      const { index } = JSON.parse(input) as { index: string };
      ctx.addEvidence([index === "코스닥" ? kosdaq("E5") : kospi7]);
      return "ok";
    });
    expect(await ensureIndexes(ctx, Q, { name: "get_kr_stock_index", invoke }, newsOf() as never)).toEqual(["코스피", "코스닥"]);
    expect(invoke.mock.calls.map((c) => c[1]).sort()).toEqual(['{"index":"코스닥","days":7}', '{"index":"코스피","days":7}']);
  });

  it("1년으로 받아 둔 지수는 질문이 기간을 말하면 그 기간으로 다시 받고, 마지막에 받은 것을 쓴다. 말이 없으면 그대로", async () => {
    const year = kosdaq("E1", "2025-11-24");
    const ctx = new ResearchContext();
    ctx.addEvidence([year]);
    const invoke = vi.fn(async () => { ctx.addEvidence([kosdaq("E4")]); return "ok"; });
    await ensureIndexes(ctx, "코스닥 일주일 추세 알려줘", { name: "get_kr_stock_index", invoke }, newsOf() as never);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(officialIndex(ctx.evidence, "코스닥")?.id).toBe("E4");
    const keep = new ResearchContext();
    keep.addEvidence([year]);
    const none = vi.fn(async () => "ok");
    await ensureIndexes(keep, "코스닥 요즘 어때?", { name: "get_kr_stock_index", invoke: none }, newsOf() as never);
    expect(none).not.toHaveBeenCalled();
  });

  it("작성 메모는 두 지수를 모두 알리고, 한 지수만 쓰고 끝내지 않게 한다. 카드는 질문 순서대로", () => {
    const evidence = [kospi7, kosdaq("E5")];
    const note = indexNote(evidence, ["코스피", "코스닥"]);
    expect(note).toContain("[지수 값] 질문이 물은 코스피 · 코스닥 지수의 값입니다");
    expect(note).toContain("코스피 공식 자료 (ref E3");
    expect(note).toContain("코스닥 공식 자료 (ref E5");
    expect(note).toContain("2026-11-17 종가 700.10 와 비교해 -4.89% (하락)");
    expect(note).toContain("질문이 지수 2개(코스피 · 코스닥)를 물었습니다");
    expect(note.match(/오르내림의 방향은/g)).toHaveLength(1);
    expect(note).toContain("일별 종가가 없다 · 일별 흐름을 확인할 수 없다");
    const cards = (["코스닥", "코스피"] as const).reduce<WriterOutput>((acc, i) => withIndexNumbers(acc, evidence, i), empty).numbers.map((n) => n.label);
    expect(cards[0]).toBe("코스피 종가 (공식 자료)");
    expect(cards.some((l) => l.startsWith("코스닥"))).toBe(true);
  });

  it("차트가 일별 종가를 보여 주면 '일별 종가가 없어요' 문장을 뺀다 (11/26 로컬)", () => {
    const out = dropDailyCloseTalk({
      caveats: ["코스피 공식 자료는 다음 영업일에 공개돼요."],
      dataGaps: [
        "최근 7일의 일일 종가·등락률 자료가 없어, 2026-11-17~2026-11-24 기간 변화와 2026-11-25 하루 변화를 나눠 설명했어요.",
        "2026-11-25 이후를 포함한 최근 7일 종가 기준 추세와 주간 변동률을 확인하려면 해당 기간의 공식 일자별 종가 자료가 필요해요.",
        "일주일 날짜별 지수 종가가 없어 정확한 일별 흐름은 확인할 수 없어요. 공식 자료로 확인되는 기간에는 코스피가 0.76% 상승했어요.",
        "오늘 하락의 이유를 뒷받침할 근거가 확인되지 않았어요.",
      ],
    });
    expect(out.caveats).toEqual(["코스피 공식 자료는 다음 영업일에 공개돼요."]);
    expect(out.dataGaps).toEqual(["공식 자료로 확인되는 기간에는 코스피가 0.76% 상승했어요.", "오늘 하락의 이유를 뒷받침할 근거가 확인되지 않았어요."]);
  });
});
