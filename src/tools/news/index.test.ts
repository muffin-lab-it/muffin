import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunContext } from "@openai/agents";
import { ResearchContext } from "../../agent/context";
import type { Source, ToolResult } from "../types";
import fixture from "./fixture.json";
import { clearFeedCache, execute, newsTool, parameters, periodRange, spreadByDay, type Input, type NewsData } from "./index";
import { extractHankyung, extractYonhap } from "./body";
import { fetchArticleBody } from "./body";
import { parseRss } from "./rss";
import { normalizeArticles } from "./sources";
import type { Article } from "./sources";

type FeedKey = "yonhap" | "hankyung" | "google" | "bok";
const TEST_NOW = Date.UTC(2026, 9, 18, 12);
const DAY_MS = 24 * 60 * 60 * 1_000;

/** 한국은행 보도자료 RSS 모양 (11/24 실제 피드처럼 설명 HTML 이 한 번 더 이스케이프돼 CDATA 안에 있음) */
const bokFeed = `<rss><channel><title>한국은행 보도자료</title>
<item><title>2026년 11월 소비자동향조사 결과</title><link><![CDATA[https://www.bok.or.kr/portal/bbs/B0000501/view.do?nttId=11066918&menuNo=200690]]></link><pubDate>Tue, 17 Oct 2026 06:00:00 +0900</pubDate><description><![CDATA[&lt;p&gt;&lt;span style=&quot;font-size: 11pt;&quot;&gt;${"소비자들의 경제상황에 대한 심리를 종합적으로 나타내는 소비자심리지수는 전월보다 하락하였다. ".repeat(4)}&lt;/span&gt;&lt;/p&gt;]]></description></item>
<item><title>2026년 10월 생산자물가지수(잠정)</title><link><![CDATA[https://www.bok.or.kr/portal/bbs/B0000502/view.do?nttId=11066826&menuNo=200690]]></link><pubDate>Mon, 16 Oct 2026 06:00:00 +0900</pubDate><description><![CDATA[&lt;p&gt;*자세한 내용은 첨부파일을 참조하시길 바랍니다.&lt;/p&gt;]]></description></item>
</channel></rss>`;

const feeds: Record<FeedKey, string> = {
  yonhap: fixture.yonhap,
  hankyung: fixture.hankyung,
  google: fixture.google,
  bok: bokFeed,
};

function mockFeeds(overrides: Partial<Record<FeedKey, string | Response | Error>> = {}) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.startsWith("/view/")) return new Response(fixture.yonhapHtml);
    if (url.pathname.startsWith("/article/")) return new Response(fixture.hankyungHtml);
    const id: FeedKey = url.hostname === "www.yna.co.kr" ? "yonhap"
      : url.hostname === "www.hankyung.com" ? "hankyung" : url.hostname === "www.bok.or.kr" ? "bok" : "google";
    const value = overrides[id] ?? feeds[id];
    if (value instanceof Error) throw value;
    if (init?.signal?.aborted) throw init.signal.reason;
    return value instanceof Response ? value : new Response(value, { status: 200 });
  }));
  return calls;
}

const input = { sources: ["yonhap", "hankyung", "google"] as FeedKey[], query: null, limit: 10, content: "list" as const };

async function invokeNews(input: Input, context = new ResearchContext()) {
  // 모델은 strict 스키마라 period 를 늘 채웁니다 (기간 없으면 null)
  const result = await newsTool.invoke(new RunContext(context), JSON.stringify({ period: null, ...input }));
  return { context, result: result as ToolResult<NewsData> & { id: string; source: (Source & { id: string })[] } };
}

function syntheticFeed(count: number, source: FeedKey = "yonhap"): string {
  const prefix = source === "yonhap" ? "https://www.yna.co.kr/view/AKRTEST"
    : source === "hankyung" ? "https://www.hankyung.com/article/TEST" : "https://news.google.com/rss/articles/TEST";
  const items = Array.from({ length: count }, (_, i) => `<item><title>합성 경제 기사 ${i}</title><link>${prefix}${String(i).padStart(3, "0")}</link><pubDate>${new Date(Date.UTC(2026, 9, 17, 12, 0, 0) - i * 60_000).toUTCString()}</pubDate>${source === "google" ? "<source>합성신문</source>" : ""}</item>`);
  return `<rss><channel>${items.join("")}</channel></rss>`;
}

function datedGoogleFeed(agesMs: number[]): string {
  return `<rss><channel>${agesMs.map((age, i) => `<item><title>합성 날짜 기사 ${i}</title><link>https://news.google.com/rss/articles/DATE${i}</link><pubDate>${new Date(TEST_NOW - age).toISOString()}</pubDate><source>합성신문</source></item>`).join("")}</channel></rss>`;
}

function mockBodyScenario(count: number, unavailable: Record<number, "paid" | "missing" | "error" | "redirect"> = {}, source: "yonhap" | "hankyung" = "yonhap") {
  let active = 0;
  let maxActive = 0;
  const requested: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/rss/economy.xml" || url.pathname === "/feed/economy") return new Response(syntheticFeed(count, source));
    const match = url.pathname.match(/(?:AKR)?TEST(\d+)/);
    if (!match) throw new Error(`예상하지 않은 URL: ${url}`);
    const index = Number(match[1]);
    requested.push(index);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    // fetch mock은 redirect 정책을 실행하지 않으므로 네이티브 fetch의 실패를 명시적으로 재현합니다.
    if (unavailable[index] === "redirect") throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    if (unavailable[index] === "paid") return new Response("hk_premium_only: 'y'");
    if (unavailable[index] === "missing") return new Response("<html>본문 구조 없음</html>");
    if (unavailable[index] === "error") return new Response("오류", { status: 503 });
    return new Response(source === "yonhap" ? fixture.yonhapHtml : fixture.hankyungHtml);
  }));
  return { requested, maxActive: () => maxActive };
}

// RSS fixture의 기준 시각만 고정합니다. 요청 타임아웃과 비동기 타이머는 실제로 동작합니다.
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(TEST_NOW); clearFeedCache(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("News Tool", () => {
  it.each([
    { label: "목록 전체", content: "list", source: "yonhap", limit: 2, collected: 2, missing: 0, resultStatus: "complete", bodyStatus: "not_requested", body: "not_requested" },
    { label: "목록 부족", content: "list", source: "yonhap", limit: 5, collected: 2, missing: 3, resultStatus: "partial", bodyStatus: "not_requested", body: "not_requested" },
    { label: "본문 전체", content: "body", source: "yonhap", limit: 2, collected: 2, missing: 0, resultStatus: "complete", bodyStatus: "complete", body: "available" },
    { label: "본문 부족", content: "body", source: "yonhap", limit: 5, collected: 2, missing: 3, resultStatus: "partial", bodyStatus: "partial", body: "available" },
    { label: "제목 fallback 전체", content: "body", source: "google", limit: 2, collected: 0, missing: 2, resultStatus: "complete", bodyStatus: "partial", body: "unavailable" },
    { label: "제목 fallback 부족", content: "body", source: "google", limit: 5, collected: 0, missing: 5, resultStatus: "partial", bodyStatus: "partial", body: "unavailable" },
  ] as const)("$label의 data와 note가 일치하고 같은 메모를 기사별 Evidence에 전달한다", async ({ content, source, limit, collected, missing, resultStatus, bodyStatus, body }) => {
    const calls = mockFeeds({ [source]: syntheticFeed(2, source) });
    const { context, result } = await invokeNews({ sources: [source], query: null, limit, content });
    const { data, note } = result;
    expect(data).toMatchObject({ count: 2, requestedCount: limit, collectedCount: collected, missingCount: missing, resultStatus, bodyStatus });
    expect(data.articles.map((article) => article.body.status)).toEqual([body, body]);
    expect(data).toMatchObject({
      inspectedCount: content === "body" ? 2 : 0,
      failedCount: source === "google" ? 2 : 0,
      failureCounts: source === "google" ? { original_url_unresolved: 2 } : {},
    });
    if (content === "list") {
      expect(note).toMatch(/^기사 본문은 보지 않고 제목 · 발행일 · 링크만 확인했어요\./);
      expect(note).not.toContain("본문을 받으려 했고");
    } else if (collected > 0) {
      expect(note?.startsWith(`기사 ${data.requestedCount}건의 본문을 받으려 했고 ${data.collectedCount}건을 받았어요.`)).toBe(true);
      expect(note).not.toMatch(/링크만 확인|제목만|제목 목록만|본문 일부 추출/);
    } else {
      expect(note).toMatch(new RegExp(`^본문은 받지 못해 기사 제목 ${data.count}건만 확인했어요\\.`));
      expect(data.articles.every((article) => !("text" in article.body))).toBe(true);
    }
    // note 는 원본 보기에도 보이는 사람 말: 해요체, 키 이름 · 모델용 지시 없이 (11/23)
    expect(note).not.toMatch(/bodyStatus|resultStatus|body\.status|습니다|마세요/);
    expect(note).toContain("기사 속 수치는 따로 검증하지 않았어요.");
    expect(note).toContain("본문을 받았다고 원인 · 인과관계가 확인된 것은 아니에요.");
    // 뉴스 검색(Google) 기사가 있을 때만 링크 안내를 붙인다 (11/24)
    if (source === "google") expect(note).toContain("뉴스 검색 서비스를 거쳐 열릴 수 있어요");
    else expect(note).not.toContain("뉴스 검색 서비스");
    expect(result.source).toHaveLength(data.count);
    expect(context.evidence).toHaveLength(data.count);
    expect(context.sources).toHaveLength(data.count);
    data.articles.forEach((article, i) => {
      const articleSource = { name: article.publisher, url: article.url, asOf: article.publishedAt };
      expect(result.source[i]).toEqual({ id: `E1-${i + 1}`, ...articleSource });
      expect(context.sources[i]).toEqual(articleSource);
      expect(context.evidence[i]).toMatchObject({ id: `E1-${i + 1}`, source: articleSource, note });
      expect(context.evidence[i].values).toEqual({ title: article.title, publisher: article.publisher, publishedAt: article.publishedAt, body });
    });
    expect(calls).toHaveLength(content === "body" && source === "yonhap" ? 3 : 1);
  });

  it.each([
    { content: "list" as const, limit: 1, count: 1 },
    { content: "list" as const, limit: 5, count: 5 },
    { content: "body" as const, limit: 1, count: 1 },
    { content: "body" as const, limit: 5, count: 4 },
  ])("$content 모드의 기사 $count건을 출처와 같은 순서로 장부에 기록한다 (limit=$limit)", async ({ content, limit, count }) => {
    mockFeeds();
    const { context, result } = await invokeNews({ ...input, content, limit });
    expect(result.data.articles).toHaveLength(count);
    expect(result.source).toHaveLength(count);
    expect(context.evidence).toHaveLength(count);
    expect(context.sources).toHaveLength(count);
    expect(result.data.resultStatus).toBe(count === limit ? "complete" : "partial");
    result.data.articles.forEach((article, i) => {
      const id = `E1-${i + 1}`;
      const source = { name: article.publisher, url: article.url, asOf: article.publishedAt };
      expect(result.source[i]).toEqual({ id, ...source });
      expect(context.sources[i]).toEqual(source);
      expect(context.evidence[i]).toMatchObject({ id, tool: newsTool.name, source });
      // 정확히 이 네 필드만 허용: 기본 자동 선택으로 돌아가거나 본문이 추가되면 실패합니다.
      expect(context.evidence[i].values).toEqual({
        title: article.title,
        publisher: article.publisher,
        publishedAt: article.publishedAt,
        body: content === "list" ? "not_requested" : "available",
      });
      expect(context.evidence[i].note).toContain("기사 속 수치는 따로 검증하지 않았어요.");
    });
    if (content === "body" && count < limit) {
      expect(result.data.failureCounts).toEqual({ original_url_unresolved: 1 });
      expect(context.evidence.every((entry) => !entry.source.url.startsWith("https://news.google.com/"))).toBe(true);
    }
  });

  it("짧은 본문과 그 안의 수치도 evidence에 넣지 않고 원래 data에만 남긴다", async () => {
    const text = "합성 보도에서는 물가가 2.7% 변했다고 설명합니다. 이 수치는 별도 통계 검증을 거치지 않은 테스트 문장입니다.";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => new Response(
      String(url).includes("/rss/") ? fixture.yonhap : `<div class="story-news article"><p>${text}</p></div>`,
    )));
    const { context, result } = await invokeNews({ ...input, sources: ["yonhap"], limit: 1, content: "body" });
    expect(result.data.articles[0].body).toEqual({ status: "available", text });
    expect(context.evidence[0].values).toEqual({
      title: "수출 & 물가 동향 발표", publisher: "연합뉴스", publishedAt: "2026-10-17T00:00:00.000Z", body: "available",
    });
    expect(JSON.stringify(context.evidence)).not.toContain(text);
    expect(JSON.stringify(context.evidence)).not.toContain("2.7");
  });

  it("Google 목록과 제목 fallback의 증거 번호를 구분하고 실제 RSS 실패에는 evidence를 추가하지 않는다", async () => {
    const calls = mockFeeds();
    const googleInput = { ...input, sources: ["google"] as FeedKey[], limit: 1 };
    const { context, result } = await invokeNews(googleInput);
    expect(result.source[0].url).toMatch(/^https:\/\/news\.google\.com\/rss\/articles\//);
    expect(context.evidence[0].values).toMatchObject({ publisher: "한국경제", body: "not_requested" });
    const fallback = await invokeNews({ ...googleInput, content: "body" }, context);
    expect(fallback.result.data).toMatchObject({ count: 1, collectedCount: 0, missingCount: 1, bodyStatus: "partial" });
    expect(context.evidence.map(({ id }) => id)).toEqual(["E1-1", "E2-1"]);
    expect(context.evidence[1].values).toMatchObject({ publisher: "한국경제", body: "unavailable" });
    expect(context.steps.map(({ status }) => status)).toEqual(["ok", "ok"]);
    expect(calls).toHaveLength(2);
    expect(calls.every((url) => url.pathname === "/rss/search")).toBe(true);
    const before = structuredClone(context.evidence);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("RSS 연결 실패"));
    const failed = await newsTool.invoke(new RunContext(context), JSON.stringify({ period: null, ...googleInput }));
    expect(failed).toMatchObject({ error: expect.stringContaining("RSS 연결 실패") });
    expect(context.evidence).toEqual(before);
    expect(context.steps.map(({ status }) => status)).toEqual(["ok", "ok", "error"]);
  });

  it("실제 세 피드에서 확인한 XML 필드 구조를 합성 fixture로 파싱한다", () => {
    const yonhap = parseRss(fixture.yonhapObservedShape);
    const hankyung = parseRss(fixture.hankyungObservedShape);
    const google = parseRss(fixture.googleObservedShape);

    expect(yonhap.items[0]).toMatchObject({
      "dc:creator": "합성 기자",
      guid: { "@_isPermaLink": "true" },
      "media:content": { "@_type": "image/jpeg" },
    });
    expect(hankyung.items[0].author).toBe("합성 기자");
    expect(hankyung.items[0].description).toBeUndefined();
    expect(google.items[0].source).toMatchObject({
      "#text": "예시신문",
      "@_url": "https://example.com",
    });
    expect(google.items[0].description).toContain("<a href=");

    expect(normalizeArticles(yonhap, "yonhap")).toMatchObject([{
      title: "합성 수출 & 물가 기사",
      publishedAt: "2026-10-17T00:00:00.000Z",
      publisher: "연합뉴스",
    }]);
    expect(normalizeArticles(hankyung, "hankyung")).toMatchObject([{
      title: "합성 기업 & 투자 기사",
      publishedAt: "2026-10-17T01:00:00.000Z",
      publisher: "한국경제",
    }]);
    expect(normalizeArticles(google, "google")).toMatchObject([{
      title: "합성 시장 & 금리 기사 - 예시신문",
      publishedAt: "2026-10-17T01:00:00.000Z",
      publisher: "예시신문",
      url: "https://news.google.com/rss/articles/TEST101?oc=5",
    }]);
    expect(normalizeArticles(yonhap, "yonhap")).toHaveLength(1);
    expect(normalizeArticles(hankyung, "hankyung")).toHaveLength(1);
    expect(normalizeArticles(google, "google")).toHaveLength(1);
  });

  it("세 피드를 파싱하고 기사별 출처·ISO 날짜·직접 링크를 반환한다", async () => {
    const calls = mockFeeds();
    const result = await execute(input);
    expect(calls).toHaveLength(3);
    expect(result.data.count).toBe(5);
    expect(result.data.articles.map((article) => article.source)).toEqual(["hankyung", "yonhap", "hankyung", "yonhap", "google"]);
    expect(result.data.articles[0]).toMatchObject({
      title: "기업 투자 계획 발표",
      url: "https://www.hankyung.com/article/TEST001",
      publisher: "한국경제",
      publishedAt: "2026-10-17T01:00:00.000Z",
    });
    expect(result.data.articles[1].title).toBe("수출 & 물가 동향 발표");
    expect(result.data.articles[3].title).toBe("금리 & 환율 점검");
    expect(result.data.articles[4].publisher).toBe("예시신문");
    expect(result.source).toEqual(result.data.articles.map((article) => ({
      name: article.publisher, url: article.url, asOf: article.publishedAt,
    })));
  });

  it("Google 검색어를 URL 인코딩하고 발행처 피드는 제목만 필터링한다", async () => {
    const calls = mockFeeds();
    const result = await execute({ ...input, query: "기업 투자" });
    expect(calls.find((url) => url.hostname === "news.google.com")?.searchParams.get("q")).toBe("기업 투자");
    expect(calls.find((url) => url.hostname === "news.google.com")?.searchParams.get("ceid")).toBe("KR:ko");
    expect(result.data.articles.map((article) => article.title)).toEqual(["기업 투자 계획 발표", "시장 지표 발표 - 예시신문"]);
  });

  it("Google News 검색어가 null이면 기존처럼 경제로 검색한다", async () => {
    const calls = mockFeeds();
    await execute({ ...input, sources: ["google"] });
    expect(calls[0].searchParams.get("q")).toBe("경제");
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("follow");
  });

  it("최신순으로 정렬한 뒤 limit을 적용한다", async () => {
    mockFeeds();
    const result = await execute({ ...input, limit: 2 });
    expect(result.data.articles.map((article) => article.title)).toEqual(["기업 투자 계획 발표", "수출 & 물가 동향 발표"]);
    expect(result.source).toHaveLength(2);
  });

  it("같은 언론사의 제목이 같아도 원문 URL이 다른 직접 기사는 유지한다", async () => {
    const xml = `<rss><channel><item><title>같은 경제 제목</title><link>https://www.yna.co.kr/view/AKRTEST001</link><pubDate>Sat, 17 Oct 2026 01:00:00 GMT</pubDate></item><item><title>같은 경제 제목</title><link>https://www.yna.co.kr/view/AKRTEST002</link><pubDate>Sat, 17 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
    mockFeeds({ yonhap: xml });
    const result = await execute({ ...input, sources: ["yonhap"], limit: 2 });
    expect(result.data.articles).toHaveLength(2);
  });

  it("입력 범위를 검증한다", () => {
    expect(() => parameters.parse({ ...input, limit: 11 })).toThrow();
    expect(() => parameters.parse({ ...input, limit: 20 })).toThrow();
    expect(() => parameters.parse({ ...input, limit: 0 })).toThrow();
    expect(() => parameters.parse({ sources: input.sources, query: null, content: "list" })).toThrow();
    expect(() => parameters.parse({ ...input, sources: [] })).toThrow();
    expect(() => parameters.parse({ ...input, query: "" })).toThrow();
  });

  it("list 모드는 최대 10건만 반환한다", async () => {
    mockFeeds({ yonhap: syntheticFeed(15) });
    const result = await execute({ ...input, sources: ["yonhap"], limit: 10 });
    expect(result.data).toMatchObject({ count: 10, requestedCount: 10, collectedCount: 10, resultStatus: "complete" });
    expect(result.source).toHaveLength(10);
  });

  it("빈 RSS는 실패하고 정상 빈 결과로 위장하지 않는다", async () => {
    mockFeeds({ yonhap: "<rss><channel></channel></rss>" });
    await expect(execute({ ...input, sources: ["yonhap"] })).rejects.toThrow("기사 항목이 없습니다");
  });

  it("잘못된 XML은 실패한다", async () => {
    mockFeeds({ hankyung: "<rss><channel><item></channel></rss>" });
    await expect(execute({ ...input, sources: ["hankyung"] })).rejects.toThrow("XML 형식");
  });

  it("외부 엔티티 선언은 파싱하지 않는다", async () => {
    mockFeeds({ yonhap: '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&xxe;</title></item></channel></rss>' });
    await expect(execute({ ...input, sources: ["yonhap"] })).rejects.toThrow("DOCTYPE");
  });

  it("발행일 누락·잘못된 날짜·링크 누락 항목을 버리고 유효 기사만 반환한다", async () => {
    const xml = `<rss><channel>
      <item><title>날짜 없음</title><link>https://example.com/a</link></item>
      <item><title>날짜 오류</title><link>https://example.com/b</link><pubDate>not-a-date</pubDate></item>
      <item><title>링크 없음</title><pubDate>Sat, 17 Oct 2026 00:00:00 GMT</pubDate></item>
      <item><title>정상 기사</title><link>https://www.yna.co.kr/view/AKRTEST003</link><pubDate>Sat, 17 Oct 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>`;
    mockFeeds({ yonhap: xml });
    const result = await execute({ ...input, sources: ["yonhap"] });
    expect(result.data.articles).toHaveLength(1);
    expect(result.data.articles[0].title).toBe("정상 기사");
  });

  it("모든 기사가 불완전하면 실패한다", async () => {
    mockFeeds({ yonhap: "<rss><channel><item><title>날짜 없음</title></item></channel></rss>" });
    await expect(execute({ ...input, sources: ["yonhap"] })).rejects.toThrow("유효한 RSS 기사");
  });

  it("HTTP 오류는 상태 코드를 포함해 실패한다", async () => {
    mockFeeds({ yonhap: new Response("Unavailable", { status: 503 }) });
    await expect(execute({ ...input, sources: ["yonhap"] })).rejects.toThrow("503");
  });

  it("타임아웃 실패를 명시한다", async () => {
    mockFeeds({ yonhap: new DOMException("The operation was aborted due to timeout", "TimeoutError") });
    await expect(execute({ ...input, sources: ["yonhap"] })).rejects.toThrow("timeout");
  });

  it("일부 소스만 실패하면 오류 목록과 성공 기사·출처를 함께 반환한다", async () => {
    mockFeeds({ yonhap: new Response("Unavailable", { status: 503 }) });
    const result = await execute(input);
    expect(result.data.failedSources).toEqual([{ source: "yonhap", error: expect.stringContaining("503") }]);
    expect(result.data.articles.every((article) => article.source !== "yonhap")).toBe(true);
    expect(result.note).toContain("이번에 기사를 받지 못한 곳: 연합뉴스.");
    expect(result.source).toHaveLength(result.data.count);
  });

  it("직접 피드와 뉴스 검색 모두 결과가 없으면 명시적으로 실패한다", async () => {
    mockFeeds({ google: "<rss><channel></channel></rss>" });
    await expect(execute({ ...input, sources: ["yonhap"], query: "없는 검색어" })).rejects.toThrow("조건에 맞는 뉴스 기사");
  });

  it("대신 부른 뉴스 검색이 장애로 실패하면 0건으로 바꾸지 않고 그 오류를 던진다 (#157 Codex 리뷰)", async () => {
    mockFeeds({ google: new Response("Unavailable", { status: 503 }) });
    const err = await execute({ ...input, sources: ["yonhap"], query: "없는 검색어" }).catch((e: Error) => e);
    expect(String(err)).toContain("503");
    expect(String(err)).not.toContain("조건에 맞는 뉴스 기사");
  });

  it("직접 피드에 검색어와 맞는 기사가 없으면 같은 검색어로 뉴스 검색 결과를 받고 메모에 적는다 (11/23 녹화: 물가 원인 뉴스 0.5초 실패)", async () => {
    const calls = mockFeeds();
    const result = await execute({ ...input, sources: ["yonhap", "hankyung"], query: "없는 검색어" });
    expect(calls.find((url) => url.hostname === "news.google.com")?.searchParams.get("q")).toBe("없는 검색어");
    expect(result.data.articles.length).toBeGreaterThan(0);
    expect(result.data.articles.every((a) => a.source === "google")).toBe(true);
    expect(result.note).toContain("뉴스 검색 결과를 대신 받았어요");
    // 직접 피드에 맞는 기사가 있으면 검색하지 않는다
    const direct = mockFeeds();
    await execute({ ...input, sources: ["yonhap", "hankyung"], query: null });
    expect(direct.some((url) => url.hostname === "news.google.com")).toBe(false);
  });

  it("검색어가 있는데 직접 기사의 본문을 하나도 못 받으면 같은 검색어의 뉴스 검색 제목을 대신 쓴다 (11/23 로컬: 한국경제 유료 기사 2건)", async () => {
    const searched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: string | URL) => {
      const url = new URL(String(req));
      if (url.pathname === "/feed/economy") return new Response(syntheticFeed(2, "hankyung"));
      if (url.hostname === "news.google.com") {
        searched.push(url.searchParams.get("q") ?? "");
        return new Response(syntheticFeed(2, "google"));
      }
      return new Response("hk_premium_only: 'y'");
    }));
    const result = await execute({ ...input, sources: ["hankyung"], query: "합성 경제", content: "body", limit: 3 });
    expect(searched).toEqual(["합성 경제"]);
    expect(result.data.collectedCount).toBe(0);
    expect(result.data.articles.every((a) => a.source === "google" && a.body.status === "unavailable")).toBe(true);
    expect(result.note).toContain("뉴스 검색 결과를 대신 받았어요");
  });

  it("tool 제한 시간이 1초도 안 남았으면 대신 검색을 부르지 않는다 (#157 Codex 리뷰)", async () => {
    const searched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: string | URL) => {
      const url = new URL(String(req));
      if (url.pathname === "/feed/economy") return new Response(syntheticFeed(2, "hankyung"));
      if (url.hostname === "news.google.com") { searched.push("google"); return new Response(syntheticFeed(2, "google")); }
      return new Response("hk_premium_only: 'y'");
    }));
    const start = Date.now();
    let calls = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? start : start + 9_500));
    await expect(execute({ ...input, sources: ["hankyung"], query: "합성 경제", content: "body", limit: 3 })).rejects.toThrow("기사 본문을 확보하지 못했습니다");
    expect(searched).toEqual([]);
    now.mockRestore();
  });

  it("검색어의 낱말이 모두 든 제목을 찾는다 (순서 · 띄어쓰기 달라도)", async () => {
    const { titleMatches } = await import("./index");
    expect(titleMatches("소비자물가 2.8% 상승…석유류 올라", "소비자물가 상승")).toBe(true);
    expect(titleMatches("Fed 금리 동결", "fed 동결")).toBe(true);
    // / · 가운뎃점 · 줄표 · 따옴표는 무시하고 질문어(원인 · 최근 …)는 뺀다 (11/24)
    expect(titleMatches("원/달러 환율 1,350원대…위험회피 확산", "원달러 환율 원인")).toBe(true);
    expect(titleMatches("원·달러 환율 급등", "원/달러 환율")).toBe(true);
    expect(titleMatches("\"코스피\" 급등", "최근 코스피 흐름")).toBe(true);
    expect(titleMatches("코스피 급등", "환율 원인")).toBe(false);
    // 설명(연합뉴스 · 한국은행)에 있어도 맞는다
    expect(titleMatches("증시 마감", "원달러 환율", "원/달러 환율은 3원 올랐다")).toBe(true);
    // 질문어뿐이면 그대로 본다 (모든 기사가 통과하지 않게)
    expect(titleMatches("코스피 급등", "최근 원인")).toBe(false);
    // 한국은행은 "동결" 을 "유지" 라고 쓴다 (11/24 운영)
    expect(titleMatches("통화정책방향(2026.10.22)", "기준금리 동결", "금융통화위원회는 한국은행 기준금리를 현재의 3.00% 수준에서 유지하여")).toBe(true);
  });

  it("직접 피드 제목 '원/달러 환율 …' 이 검색어 '원달러 환율 원인' 으로 걸린다 (11/24, 뉴스 거름망 넓히기)", async () => {
    const yonhap = `<rss><channel><item><title>원/달러 환율 1,350원대…위험회피 확산</title><link>https://www.yna.co.kr/view/AKR20261018000100002</link><pubDate>${new Date(Date.UTC(2026, 9, 18, 3)).toUTCString()}</pubDate><description>환율 설명</description></item></channel></rss>`;
    const calls = mockFeeds({ yonhap });
    const result = await execute({ ...input, sources: ["yonhap"], query: "원달러 환율 원인" });
    expect(result.data.articles.map((a) => a.title)).toEqual(["원/달러 환율 1,350원대…위험회피 확산"]);
    expect(calls.some((url) => url.hostname === "news.google.com")).toBe(false);
  });

  it("한국은행 보도자료(bok): 링크는 menuNo 그대로, 설명이 길면 본문 · 짧으면 제목만, 메모에 가공 표시 (11/24)", async () => {
    const calls = mockFeeds();
    const result = await execute({ ...input, sources: ["bok"], query: null, content: "body", limit: 2 });
    expect(calls.some((url) => url.hostname === "www.bok.or.kr" && url.pathname.endsWith("news.rss"))).toBe(true);
    // 기사 페이지는 읽지 않는다
    expect(calls.filter((url) => url.pathname.endsWith("view.do"))).toHaveLength(0);
    const [first] = result.data.articles;
    expect(first).toMatchObject({ publisher: "한국은행", source: "bok", url: "https://www.bok.or.kr/portal/bbs/B0000501/view.do?nttId=11066918&menuNo=200690" });
    expect(first!.body).toMatchObject({ status: "available" });
    expect((first!.body as { text: string }).text).toMatch(/^소비자들의 경제상황에 대한 심리를/);
    expect((first!.body as { text: string }).text).not.toMatch(/<|&lt;|font-size/);
    expect(result.data.failureCounts).toEqual({ attachment_only: 1 });
    expect(result.note).toContain("한국은행 보도자료는 한국은행 홈페이지 원문(링크)을 글자만 남겨 옮겼어요.");
    // 설명은 결과에 싣지 않는다 (본문 길이 제한 우회 방지, #163 Codex 리뷰)
    expect(result.data.articles.every((a) => !("description" in a))).toBe(true);
  });

  it("한국은행 자료가 모두 첨부파일뿐이면 그 제목을 근거로 돌려주고 뉴스 검색으로 바꾸지 않는다 (#163 Codex 리뷰)", async () => {
    const onlyShort = bokFeed.replace(/소비자들의 경제상황[^&]*/g, "자세한 내용은 붙임 참고.");
    const calls = mockFeeds({ bok: onlyShort });
    const result = await execute({ ...input, sources: ["bok"], query: "물가", content: "body", limit: 3 });
    expect(calls.some((url) => url.hostname === "news.google.com")).toBe(false);
    expect(result.data.collectedCount).toBe(0);
    expect(result.data.articles.map((a) => [a.source, a.body.status])).toEqual([["bok", "unavailable"]]);
    expect(result.note).toContain("본문은 받지 못해 기사 제목 1건만 확인했어요.");
    const nullQuery = await execute({ ...input, sources: ["bok"], query: null, content: "body", limit: 3 });
    expect(nullQuery.data.articles).toHaveLength(2);
  });

  it("연합뉴스·한국경제 본문을 분리 추출하고 광고·구독 영역을 제외한다", () => {
    const yonhap = extractYonhap(fixture.yonhapHtml);
    const hankyung = extractHankyung(fixture.hankyungHtml);
    expect(yonhap.status).toBe("available");
    expect(hankyung.status).toBe("available");
    if (yonhap.status === "available" && hankyung.status === "available") {
      expect(yonhap.text).toContain("첫째 문단");
      expect(yonhap.text.indexOf("첫째 문단")).toBeLessThan(yonhap.text.indexOf("둘째 문단"));
      expect(yonhap.text).not.toMatch(/광고|기자 구독/);
      expect(hankyung.text).not.toMatch(/광고|사진 설명/);
    }
  });

  it("유료 기사와 변경된 HTML은 본문 실패 상태로 처리한다", () => {
    expect(extractHankyung("hk_premium_only: 'y'<div class='article-body' itemprop='articleBody'>일부 노출</div>")).toMatchObject({ status: "unavailable", reason: "access_restricted" });
    expect(extractYonhap("<article>구조 변경</article>")).toMatchObject({ status: "unavailable", reason: "structure_changed" });
    expect(extractHankyung("<article>본문 없음</article>")).toMatchObject({ status: "unavailable", reason: "structure_changed" });
  });

  it("같은 본문 문단이 반복되면 한 번만 남긴다", () => {
    const html = fixture.yonhapHtml.replace("</div></article>", "<p>첫째 문단은 경제 지표와 시장의 변화를 설명하는 합성 문장입니다. 관련 수치의 출처를 별도로 확인해야 합니다.</p></div></article>");
    const result = extractYonhap(html);
    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.text.match(/첫째 문단/g)).toHaveLength(1);
  });

  it("짧은 기사와 긴 기사의 첫·마지막 문단, HTML 엔티티, 순서를 유지한다", () => {
    const short = extractYonhap("<div class='story-news article'><p>첫 문단 &amp; 시장 변화에 대한 간단한 설명입니다.</p><p>마지막 문단은 결과를 요약하고 출처 확인을 권합니다.</p></div>");
    expect(short.status).toBe("available");
    if (short.status === "available") {
      expect(short.text.startsWith("첫 문단 & 시장")).toBe(true);
      expect(short.text.endsWith("출처 확인을 권합니다.")).toBe(true);
    }
    const longParagraphs = Array.from({ length: 35 }, (_, i) => `문단 ${i}은 합성 경제 기사 내용을 순서대로 설명합니다. 수치는 독립적으로 확인해야 합니다.`);
    const long = extractYonhap(`<div class='story-news article'>${longParagraphs.map((p) => `<p>${p}</p>`).join("")}</div>`);
    expect(long.status).toBe("available");
    if (long.status === "available") {
      expect(long.text.split("\n\n")).toEqual(longParagraphs);
    }
  });

  it("Agent에 너무 긴 본문은 성공으로 넣지 않는다", () => {
    const html = `<div class='story-news article'><p>${"가".repeat(12_001)}</p></div>`;
    expect(extractYonhap(html)).toMatchObject({ status: "unavailable", reason: "body_too_large" });
  });

  it("RSS부터 본문까지 연결하고 Google 원문 미확정을 명시한다", async () => {
    mockFeeds();
    const result = await execute({ ...input, content: "body" });
    expect(result.data.bodyStatus).toBe("partial");
    expect(result.data.articles).toHaveLength(4);
    expect(result.data.failureCounts.original_url_unresolved).toBe(1);
    expect(result.data.failedArticles[0]).toMatchObject({ source: "google", reason: "original_url_unresolved" });
  });

  it.each(["yonhap", "hankyung"] as const)("%s 정상 본문은 redirect:error로 요청하고 RSS는 follow를 유지한다", async (source) => {
    mockFeeds();
    const result = await execute({ ...input, sources: [source], limit: 1, content: "body" });
    const requests = vi.mocked(fetch).mock.calls;
    expect(requests).toHaveLength(2);
    expect(requests[0][1]?.redirect).toBe("follow");
    expect(requests[1][1]).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
    expect(result.data).toMatchObject({ collectedCount: 1, failedCount: 0, resultStatus: "complete" });
    expect(result.data.articles[0].body.status).toBe("available");
  });

  it("fetch의 리디렉션 거부 오류를 기존 http_error로 반환한다", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }));
    vi.stubGlobal("fetch", fetchMock);
    const article: Article = { title: "합성 기사", url: "https://www.yna.co.kr/view/AKRTEST001", publisher: "연합뉴스", publishedAt: "2026-10-17T00:00:00.000Z", source: "yonhap" };
    expect(await fetchArticleBody(article)).toEqual({ status: "unavailable", reason: "http_error", detail: "fetch failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(article.url, expect.objectContaining({ redirect: "error" }));
  });

  it.each([
    { candidates: 7, collected: 5, missing: 0, status: "complete", stop: "target_reached" },
    { candidates: 4, collected: 2, missing: 3, status: "partial", stop: "feed_exhausted" },
  ])("리디렉션 실패 후 보충하고 후보 $candidates건에서 $status를 반환한다", async ({ candidates, collected, missing, status, stop }) => {
    const calls = mockBodyScenario(candidates, { 0: "redirect", 1: "redirect" });
    const result = await execute({ ...input, sources: ["yonhap"], limit: 5, content: "body" });
    expect(result.data).toMatchObject({ requestedCount: 5, collectedCount: collected, missingCount: missing, inspectedCount: candidates, failedCount: 2, resultStatus: status, stopReason: stop });
    expect(result.data.failureCounts).toEqual({ http_error: 2 });
    expect(result.data.failedArticles.map(({ reason }) => reason)).toEqual(["http_error", "http_error"]);
    expect(calls.requested).toEqual(Array.from({ length: candidates }, (_, i) => i));
    expect(result.data.articles.every(({ body }) => body.status === "available")).toBe(true);
  });

  it("본문 HTTP 오류도 정상 본문으로 위장하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => String(url).includes("/rss/") ? new Response(fixture.yonhap) : new Response("오류", { status: 503 })));
    await expect(execute({ ...input, sources: ["yonhap"], limit: 1, content: "body" })).rejects.toThrow("http_error");
  });

  it("본문 요청 타임아웃도 기사별 실패 상태로 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("/rss/")) return new Response(fixture.yonhap);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }));
    await expect(execute({ ...input, sources: ["yonhap"], limit: 1, content: "body" })).rejects.toThrow("timeout");
  });

  it("Google 목록은 유지하고 body 요청은 본문 미확보를 명시한 제목 fallback을 반환한다", async () => {
    mockFeeds();
    const result = await execute({ ...input, sources: ["google"] });
    expect(result.data.bodyStatus).toBe("not_requested");
    const fallback = await execute({ ...input, sources: ["google"], content: "body" });
    expect(fallback.data).toMatchObject({ count: 2, collectedCount: 0, missingCount: 10, inspectedCount: 2, failedCount: 2, resultStatus: "partial", bodyStatus: "partial" });
    expect(fallback.data.failureCounts).toEqual({ original_url_unresolved: 2 });
    expect(fallback.data.articles.map(({ title, url, publisher, publishedAt }) => ({ title, url, publisher, publishedAt })))
      .toEqual(result.data.articles.map(({ title, url, publisher, publishedAt }) => ({ title, url, publisher, publishedAt })));
    expect(fallback.data.articles.every(({ body }) => body.status === "unavailable" && body.reason === "original_url_unresolved" && !("text" in body))).toBe(true);
    expect(fallback.note).toContain("본문은 받지 못해 기사 제목");
    expect(fallback.note).toContain("뉴스 검색 서비스를 거쳐 열릴 수 있어요");
  });

  it.each([1, 2, 10])("제목 fallback %i건과 본문 0건을 구분하고 Source·Evidence 순서를 유지한다", async (limit) => {
    const calls = mockFeeds({ google: syntheticFeed(12, "google") });
    const { context, result } = await invokeNews({ ...input, sources: ["google"], content: "body", limit });
    expect(result.data).toMatchObject({ count: limit, requestedCount: limit, collectedCount: 0, missingCount: limit, inspectedCount: 12, failedCount: 12, resultStatus: "complete", bodyStatus: "partial", stopReason: "feed_exhausted" });
    expect(result.data.failureCounts).toEqual({ original_url_unresolved: 12 });
    expect(result.data.failedArticles).toHaveLength(10);
    expect(result.source).toHaveLength(limit);
    expect(context.evidence).toHaveLength(limit);
    expect(context.sources).toHaveLength(limit);
    expect(new Set(context.evidence.map(({ id }) => id)).size).toBe(limit);
    result.data.articles.forEach((article, i) => {
      const source = { name: article.publisher, url: article.url, asOf: article.publishedAt };
      const id = `E1-${i + 1}`;
      expect(article.body).toMatchObject({ status: "unavailable", reason: "original_url_unresolved" });
      expect(article.body).not.toHaveProperty("text");
      expect(result.source[i]).toEqual({ id, ...source });
      expect(context.sources[i]).toEqual(source);
      expect(context.evidence[i]).toMatchObject({ id, source, values: {
        title: article.title, publisher: article.publisher, publishedAt: article.publishedAt, body: "unavailable",
      } });
      expect(context.evidence[i].note).toContain("본문은 받지 못해 기사 제목");
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].hostname).toBe("news.google.com");
  });

  it("제목 fallback도 URL·매체별 제목 중복을 제거하고 최신순 limit을 적용한다", async () => {
    const items = syntheticFeed(5, "google").match(/<item>.*?<\/item>/g)!;
    const duplicateUrl = items[0].replace("TEST000", "TEST000?utm_source=test");
    const duplicateTitle = items[0].replace("TEST000", "OTHER000");
    mockFeeds({ google: `<rss><channel>${[...items, duplicateUrl, duplicateTitle].reverse().join("")}</channel></rss>` });
    const { data } = await execute({ ...input, sources: ["google"], content: "body", limit: 3 });
    expect(data.articles.map(({ title }) => title)).toEqual(["합성 경제 기사 0", "합성 경제 기사 1", "합성 경제 기사 2"]);
    expect(data).toMatchObject({ count: 3, collectedCount: 0, missingCount: 3, inspectedCount: 5, failedCount: 5 });
  });

  it.each([
    { label: "실행 시점", age: 0, included: true },
    { label: "1일 전", age: DAY_MS, included: true },
    { label: "29일 전", age: 29 * DAY_MS, included: true },
    { label: "정확히 30일 전", age: 30 * DAY_MS, included: true },
    { label: "30일 + 1ms 전", age: 30 * DAY_MS + 1, included: false },
    { label: "168일 전", age: 168 * DAY_MS, included: false },
    { label: "175일 전", age: 175 * DAY_MS, included: false },
    { label: "1ms 미래", age: -1, included: false },
  ])("제목 fallback의 $label 기사 포함 여부는 $included이다", async ({ age, included }) => {
    const calls = mockFeeds({ google: datedGoogleFeed([age]) });
    const request = execute({ ...input, sources: ["google"], content: "body", limit: 1 });
    if (included) {
      const { data, source } = await request;
      expect(data).toMatchObject({ count: 1, collectedCount: 0, missingCount: 1, inspectedCount: 1, failedCount: 1, resultStatus: "complete", bodyStatus: "partial" });
      expect(data.articles[0].publishedAt).toBe(new Date(TEST_NOW - age).toISOString());
      expect(data.articles[0].body).toMatchObject({ status: "unavailable", reason: "original_url_unresolved" });
      expect(source).toEqual([{ name: "합성신문", url: data.articles[0].url, asOf: data.articles[0].publishedAt }]);
    } else {
      await expect(request).rejects.toThrow('기사 본문을 확보하지 못했습니다: inspected=1, failures={"original_url_unresolved":1}, stop=feed_exhausted');
    }
    expect(calls).toHaveLength(1);
  });

  it.each([2, 5])("최근 Google 제목만 중복 제거·정렬 후 limit=%i를 적용하고 부족분은 채우지 않는다", async (limit) => {
    const items = datedGoogleFeed([175 * DAY_MS, DAY_MS, 29 * DAY_MS, 30 * DAY_MS, -DAY_MS]).match(/<item>.*?<\/item>/g)!;
    // 오래된 같은 제목이 먼저 있어도 최근 후보를 잃지 않습니다.
    items[0] = items[0].replace("합성 날짜 기사 0", "합성 날짜 기사 1");
    const duplicate = items[1].replace("DATE1", "DATE1?utm_source=test");
    const calls = mockFeeds({ google: `<rss><channel>${[...items, duplicate].join("")}</channel></rss>` });
    const { context, result } = await invokeNews({ ...input, sources: ["google"], content: "body", limit });
    const count = Math.min(3, limit);
    expect(result.data.articles.map(({ title }) => title)).toEqual(["합성 날짜 기사 1", "합성 날짜 기사 2", "합성 날짜 기사 3"].slice(0, limit));
    expect(result.data).toMatchObject({ count, requestedCount: limit, collectedCount: 0, missingCount: limit, inspectedCount: 4, failedCount: 4, failureCounts: { original_url_unresolved: 4 }, resultStatus: count === limit ? "complete" : "partial", bodyStatus: "partial" });
    expect(result.source).toHaveLength(count);
    expect(context.sources).toHaveLength(count);
    expect(context.evidence).toHaveLength(count);
    expect(new Set(context.evidence.map(({ id }) => id)).size).toBe(count);
    result.data.articles.forEach((article, i) => {
      const source = { name: article.publisher, url: article.url, asOf: article.publishedAt };
      expect(result.source[i]).toEqual({ id: `E1-${i + 1}`, ...source });
      expect(context.sources[i]).toEqual(source);
      expect(context.evidence[i]).toMatchObject({ id: `E1-${i + 1}`, source, values: { title: article.title, publisher: article.publisher, publishedAt: article.publishedAt, body: "unavailable" } });
      expect(article.body).not.toHaveProperty("text");
    });
    expect(calls).toHaveLength(1);
  });

  it("제목 fallback 날짜 경계는 수집 완료 시각이 아닌 실행 시작 시각을 기준으로 한다", async () => {
    mockFeeds({ google: datedGoogleFeed([30 * DAY_MS, -1]) });
    vi.mocked(Date.now).mockReturnValueOnce(TEST_NOW).mockReturnValue(TEST_NOW + 1);
    const { data } = await execute({ ...input, sources: ["google"], content: "body", limit: 2 });
    expect(data.articles.map(({ publishedAt }) => publishedAt)).toEqual([new Date(TEST_NOW - 30 * DAY_MS).toISOString()]);
  });

  it("list는 Google의 오래된 기사와 미래 기사를 기존처럼 유지한다", async () => {
    mockFeeds({ google: datedGoogleFeed([175 * DAY_MS, -DAY_MS]) });
    const { data } = await execute({ ...input, sources: ["google"], limit: 2 });
    expect(data.articles.map(({ publishedAt }) => publishedAt)).toEqual([TEST_NOW + DAY_MS, TEST_NOW - 175 * DAY_MS].map((date) => new Date(date).toISOString()));
    expect(data).toMatchObject({ count: 2, collectedCount: 2, missingCount: 0, bodyStatus: "not_requested", resultStatus: "complete" });
  });

  it("30일 넘은 직접 기사도 본문이 확보되면 유지하고 Google 제목으로 대체하지 않는다", async () => {
    vi.mocked(Date.now).mockReturnValue(TEST_NOW + 175 * DAY_MS);
    const calls = mockFeeds();
    const { data } = await execute({ ...input, sources: ["yonhap", "google"], content: "body", limit: 3 });
    expect(data).toMatchObject({ count: 2, collectedCount: 2, missingCount: 1, resultStatus: "partial", bodyStatus: "partial", failureCounts: { original_url_unresolved: 2 } });
    expect(data.articles.every((article) => article.source === "yonhap" && article.body.status === "available")).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("직접 기사 본문이 모두 실패하면 중복으로 가려졌던 Google 제목도 보존한다", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === "/rss/economy.xml") return new Response(fixture.yonhap);
      if (url.pathname === "/feed/economy") return new Response(fixture.hankyung);
      if (url.pathname === "/rss/search") return new Response(fixture.google);
      return url.hostname === "www.yna.co.kr" ? new Response("오류", { status: 503 }) : new Response("hk_premium_only: 'y'");
    }));
    const { data } = await execute({ ...input, content: "body", limit: 3 });
    expect(data.articles.map(({ source }) => source)).toEqual(["google", "google"]);
    expect(data).toMatchObject({ count: 2, collectedCount: 0, missingCount: 3, inspectedCount: 5, failedCount: 5, resultStatus: "partial", bodyStatus: "partial" });
    expect(data.failureCounts).toEqual({ http_error: 2, access_restricted: 2, original_url_unresolved: 1 });
    expect(data.failedArticles).toHaveLength(5);
    expect(calls).toHaveLength(7);
    expect(calls.filter((path) => path === "/rss/search")).toHaveLength(1);
  });

  it("일부 RSS 장애와 검색 결과 부족을 숨기지 않고 이미 받은 Google 목록을 반환한다", async () => {
    mockFeeds({ yonhap: new Response("Unavailable", { status: 503 }) });
    const { data, note } = await execute({ ...input, query: "없는 직접 제목", content: "body", limit: 3 });
    expect(data).toMatchObject({ count: 2, collectedCount: 0, missingCount: 3, failedCount: 2, resultStatus: "partial" });
    expect(data.failedSources).toEqual([{ source: "yonhap", error: expect.stringContaining("503") }]);
    expect(note).toContain("이번에 기사를 받지 못한 곳: 연합뉴스.");
  });

  it("모든 RSS가 실패하면 제목 fallback도 만들지 않는다", async () => {
    mockFeeds({ yonhap: new Error("offline"), hankyung: new Error("offline"), google: new Error("offline") });
    await expect(execute({ ...input, content: "body" })).rejects.toThrow("모든 뉴스 RSS 조회가 실패");
  });

  it.each(["<rss><channel></channel></rss>", "<rss><channel><item><title>링크 없는 합성 기사</title></item></channel></rss>"])("Google 목록이 유효하지 않고 직접 기사도 없으면 기존 오류를 유지한다", async (google) => {
    mockFeeds({ google });
    await expect(execute({ ...input, query: "없는 직접 제목", content: "body" })).rejects.toThrow("조건에 맞는 뉴스 기사");
  });

  it("Google이 선택되지 않으면 추가 소스를 요청하거나 제목 fallback을 만들지 않는다", async () => {
    const calls = mockBodyScenario(2, { 0: "missing", 1: "error" });
    await expect(execute({ ...input, sources: ["yonhap"], content: "body" })).rejects.toThrow('failures={"structure_changed":1,"http_error":1}');
    expect(calls.requested).toEqual([0, 1]);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => new URL(String(url)).hostname === "www.yna.co.kr")).toBe(true);
  });

  it.each(["deadline", "candidate_limit"])("본문 검사가 %s에서 멈춰도 제목 fallback이 검사 수를 늘리지 않는다", async (stop) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path === "/rss/economy.xml") return new Response(syntheticFeed(20));
      if (path === "/rss/search") return new Response(fixture.google);
      return new Response("<html>본문 없음</html>");
    }));
    if (stop === "deadline") vi.mocked(Date.now).mockReturnValueOnce(TEST_NOW).mockReturnValue(TEST_NOW + 8_501);
    const { data } = await execute({ ...input, sources: ["yonhap", "google"], content: "body", limit: 3 });
    const inspected = stop === "deadline" ? 0 : 15;
    expect(data).toMatchObject({ count: 2, collectedCount: 0, missingCount: 3, inspectedCount: inspected, failedCount: inspected, stopReason: stop });
    expect(data.failureCounts).toEqual(inspected ? { structure_changed: inspected } : {});
    expect(data.articles.every(({ body }) => body.status === "unavailable")).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2 + inspected);
  });

  it("Google와 직접 언론사를 함께 선택하면 본문 가능 후보를 우선 사용한다", async () => {
    mockFeeds();
    const result = await execute({ ...input, limit: 3, content: "body" });
    expect(result.data).toMatchObject({ collectedCount: 3, inspectedCount: 3, failedCount: 0, resultStatus: "complete" });
    expect(result.data.articles.every((article) => article.source !== "google")).toBe(true);
  });

  it.each([1, 5, 10])("본문 목표 %i건을 확보하면 바로 멈춘다", async (limit) => {
    const calls = mockBodyScenario(35);
    const result = await execute({ ...input, sources: ["yonhap"], limit, content: "body" });
    expect(result.data).toMatchObject({ requestedCount: limit, collectedCount: limit, missingCount: 0, inspectedCount: limit, failedCount: 0, resultStatus: "complete", stopReason: "target_reached" });
    expect(calls.requested).toHaveLength(limit);
    expect(calls.maxActive()).toBeLessThanOrEqual(4);
    expect(result.data.articles.map((article) => article.publishedAt)).toEqual([...result.data.articles.map((article) => article.publishedAt)].sort().reverse());
  });

  it("유료·본문 누락 기사를 건너뛰고 다음 후보로 목표를 채운다", async () => {
    const calls = mockBodyScenario(20, { 1: "missing", 2: "error" });
    const result = await execute({ ...input, sources: ["yonhap"], limit: 5, content: "body" });
    expect(result.data).toMatchObject({ requestedCount: 5, collectedCount: 5, missingCount: 0, inspectedCount: 7, failedCount: 2, resultStatus: "complete" });
    expect(result.data.failureCounts).toEqual({ structure_changed: 1, http_error: 1 });
    expect(calls.requested).toHaveLength(7);
  });

  it("한국경제 유료 기사를 성공 수에서 제외하고 다음 기사로 보충한다", async () => {
    const calls = mockBodyScenario(12, { 0: "paid", 2: "paid" }, "hankyung");
    const result = await execute({ ...input, sources: ["hankyung"], limit: 5, content: "body" });
    expect(result.data).toMatchObject({ collectedCount: 5, missingCount: 0, inspectedCount: 7, failedCount: 2, resultStatus: "complete" });
    expect(result.data.failureCounts.access_restricted).toBe(2);
    expect(calls.requested).toHaveLength(7);
  });

  it("후보가 부족하면 부분 성공 수량과 부족 수량을 반환한다", async () => {
    mockBodyScenario(8, { 0: "missing", 1: "error" });
    const result = await execute({ ...input, sources: ["yonhap"], limit: 10, content: "body" });
    expect(result.data).toMatchObject({ collectedCount: 6, missingCount: 4, inspectedCount: 8, failedCount: 2, resultStatus: "partial", stopReason: "feed_exhausted" });
  });

  it("전체 처리 기한에 도달하면 더 요청하지 않고 partial을 반환한다", async () => {
    const calls = mockBodyScenario(30);
    let nowCalls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => ++nowCalls <= 3 ? 0 : 8_501);
    const result = await execute({ ...input, sources: ["yonhap"], limit: 10, content: "body" });
    expect(result.data).toMatchObject({ collectedCount: 4, missingCount: 6, inspectedCount: 4, resultStatus: "partial", stopReason: "deadline" });
    expect(calls.requested).toHaveLength(4);
  });

  it("실패 후보 탐색을 상한에서 멈추고 빈 본문을 성공으로 반환하지 않는다", async () => {
    const unavailable: Record<number, "missing"> = {};
    for (let i = 0; i < 100; i++) unavailable[i] = "missing";
    const calls = mockBodyScenario(100, unavailable);
    await expect(execute({ ...input, sources: ["yonhap"], limit: 5, content: "body" })).rejects.toThrow("inspected=15");
    expect(calls.requested).toHaveLength(15);
  });

  it("후보 상한에서 일부만 확보했으면 partial과 실제 실패 수를 반환한다", async () => {
    const unavailable: Record<number, "missing"> = {};
    for (let i = 1; i < 50; i++) unavailable[i] = "missing";
    const calls = mockBodyScenario(50, unavailable);
    const result = await execute({ ...input, sources: ["yonhap"], limit: 5, content: "body" });
    expect(result.data).toMatchObject({ collectedCount: 1, missingCount: 4, inspectedCount: 15, failedCount: 14, resultStatus: "partial", stopReason: "candidate_limit" });
    expect(calls.requested).toHaveLength(15);
  });

  it("허용하지 않은 내부망·타 도메인 URL은 본문 요청 전에 거부한다", async () => {
    const article: Article = { title: "합성 기사", url: "http://127.0.0.1/private", publisher: "연합뉴스", publishedAt: new Date().toISOString(), source: "yonhap" };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchArticleBody(article)).toMatchObject({ status: "unavailable", reason: "invalid_url" });
    expect(await fetchArticleBody({ ...article, url: "https://evil.example/view/AKRTEST001" })).toMatchObject({ status: "unavailable", reason: "invalid_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("기사 URL의 쿼리·fragment를 제거한 주소만 요청한다", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => { requests.push(String(input)); return new Response(fixture.yonhapHtml); }));
    const article: Article = { title: "합성 기사", url: "https://www.yna.co.kr/view/AKRTEST001?next=http://127.0.0.1/#part", publisher: "연합뉴스", publishedAt: new Date().toISOString(), source: "yonhap" };
    expect((await fetchArticleBody(article)).status).toBe("available");
    expect(requests).toEqual(["https://www.yna.co.kr/view/AKRTEST001"]);
  });

  it("크기가 큰 RSS와 기사 HTML을 거부한다", async () => {
    mockFeeds({ yonhap: `${fixture.yonhap}${" ".repeat(1_000_001)}` });
    await expect(execute({ ...input, sources: ["yonhap"] })).rejects.toThrow("허용 크기");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(1_000_001))));
    const article: Article = { title: "합성 기사", url: "https://www.yna.co.kr/view/AKRTEST001", publisher: "연합뉴스", publishedAt: new Date().toISOString(), source: "yonhap" };
    expect(await fetchArticleBody(article)).toMatchObject({ status: "unavailable", reason: "response_too_large" });
  });

  it("한 번의 Agent 응답 본문 크기도 제한한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      if (String(input).includes("/rss/economy.xml")) return new Response(syntheticFeed(10));
      return new Response(`<div class='story-news article'><p>${"가".repeat(9_990)}</p></div>`);
    }));
    const result = await execute({ ...input, sources: ["yonhap"], limit: 10, content: "body" });
    expect(result.data).toMatchObject({ collectedCount: 8, missingCount: 2, failedCount: 2, resultStatus: "partial" });
    expect(result.data.failureCounts.output_limit).toBe(2);
  });
});

describe("기간을 물은 질문 (period, 11/20 QA 13)", () => {
  const item = (n: number, title: string, date: string, publisher: string) =>
    `<item><title>${title} - ${publisher}</title><link>https://news.google.com/rss/articles/W${n}</link><pubDate>${date}</pubDate><source url="https://example.com/${n}">${publisher}</source></item>`;
  // TEST_NOW = 2026-10-18(일) 12:00 UTC = 10/18 21:00 KST. 이번 주 월요일은 10/12, 지난주는 10/5~10/11
  const weekFeed = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>경제 - Google 뉴스</title>${[
    item(1, "코스피 하락 마감", "Sun, 18 Oct 2026 03:00:00 GMT", "연합뉴스"),
    item(2, "환율 상승 출발", "Sun, 18 Oct 2026 02:00:00 GMT", "연합뉴스"),
    item(3, "수출 증가세", "Sun, 18 Oct 2026 01:00:00 GMT", "뉴스1"),
    item(4, "금리 동결 전망", "Thu, 15 Oct 2026 03:00:00 GMT", "연합뉴스"),
    item(5, "물가 둔화", "Thu, 15 Oct 2026 02:00:00 GMT", "매일경제"),
    item(6, "반도체 수출 호조", "Mon, 12 Oct 2026 03:00:00 GMT", "서울경제"),
    item(7, "지난주 금요일 기사", "Fri, 09 Oct 2026 03:00:00 GMT", "한겨레"),
    item(8, "지난주 화요일 기사", "Tue, 06 Oct 2026 03:00:00 GMT", "조선일보"),
    item(9, "한 달 전 경제 기사", "Mon, 14 Sep 2026 03:00:00 GMT", "연합뉴스"),
  ].join("")}</channel></rss>`;

  it("날짜별로 돌아가며, 그날 기사 중에서는 덜 고른 언론사부터 늘어놓는다", () => {
    const a = (title: string, publishedAt: string, publisher: string): Article => ({ title, url: `https://example.com/${title}`, publisher, publishedAt, source: "google" });
    const order = spreadByDay([
      a("오늘1", "2026-10-18T03:00:00.000Z", "연합뉴스"),
      a("오늘2", "2026-10-18T02:00:00.000Z", "연합뉴스"),
      a("오늘3", "2026-10-18T01:00:00.000Z", "뉴스1"),
      a("15일1", "2026-10-15T03:00:00.000Z", "연합뉴스"),
      a("15일2", "2026-10-15T02:00:00.000Z", "매일경제"),
      a("12일", "2026-10-12T03:00:00.000Z", "서울경제"),
    ]).map((x) => x.title);
    expect(order).toEqual(["오늘1", "15일2", "12일", "오늘3", "15일1", "오늘2"]);
  });

  it("기간은 최근 N일 또는 한국 달력(월요일 시작)으로 잡는다 (#171 Codex 리뷰: 지난주 ≠ 최근 7일)", () => {
    const iso = (t: number) => new Date(t).toISOString();
    expect(periodRange("7d", TEST_NOW)).toMatchObject({ from: TEST_NOW - 7 * DAY_MS, to: TEST_NOW, search: "when:7d" });
    const thisWeek = periodRange("this_week", TEST_NOW);
    expect([iso(thisWeek.from), iso(thisWeek.to)]).toEqual(["2026-10-11T15:00:00.000Z", iso(TEST_NOW)]); // 10/12 0시 KST
    const lastWeek = periodRange("last_week", TEST_NOW);
    expect([iso(lastWeek.from), iso(lastWeek.to)]).toEqual(["2026-10-04T15:00:00.000Z", "2026-10-11T15:00:00.000Z"]); // 10/5 ~ 10/12 0시 KST
    expect(lastWeek.search).toBe("after:2026-10-04 before:2026-10-13");
    expect(iso(periodRange("this_month", TEST_NOW).from)).toBe("2026-09-30T15:00:00.000Z"); // 10/1 0시 KST
  });

  it("period 를 주면 뉴스 검색을 함께 쓰고, 기간 밖 기사는 빼고, 날짜 · 언론사를 섞어 고른다", async () => {
    const calls = mockFeeds({ google: weekFeed });
    const { data, note } = await execute({ sources: ["yonhap", "hankyung"], query: null, limit: 4, content: "list", period: "7d" });
    expect(calls.find((url) => url.hostname === "news.google.com")?.searchParams.get("q")).toBe("경제 when:7d");
    const titles = data.articles.map((x) => x.title);
    expect(titles).not.toContain("한 달 전 경제 기사");
    expect(new Set(data.articles.map((x) => x.publishedAt.slice(0, 10))).size).toBeGreaterThanOrEqual(3);
    expect(note).toContain("최근 7일 기사예요.");
  });

  it("지난주는 지난 월~일 기사만 (이번 주 기사로 대신하지 않음)", async () => {
    const calls = mockFeeds({ google: weekFeed });
    const { data, note } = await execute({ sources: ["yonhap", "hankyung"], query: null, limit: 5, content: "list", period: "last_week" });
    expect(calls.find((url) => url.hostname === "news.google.com")?.searchParams.get("q")).toBe("경제 after:2026-10-04 before:2026-10-13");
    expect(data.articles.map((x) => x.title).sort()).toEqual(["지난주 금요일 기사 - 한겨레", "지난주 화요일 기사 - 조선일보"]);
    expect(note).toContain("지난주 기사예요.");
  });

  it("본문을 청해도 날짜를 섞어 고른 기사가 먼저이고, 본문을 못 받은 기사는 제목으로 남긴다 (#171 Codex 리뷰)", async () => {
    mockFeeds({ google: weekFeed });
    const { data } = await execute({ sources: ["yonhap", "hankyung"], query: null, limit: 5, content: "body", period: "7d" });
    expect(data.articles).toHaveLength(5);
    expect(new Set(data.articles.map((x) => x.publishedAt.slice(0, 10))).size).toBeGreaterThanOrEqual(3);
    expect(data.articles.filter((x) => x.source === "google").every((x) => x.body.status === "unavailable")).toBe(true);
  });

  it("period 가 없으면(코드 호출) 지금처럼 최신순 · 검색 연산자 없음", async () => {
    const calls = mockFeeds();
    await execute({ sources: ["google"], query: null, limit: 2, content: "list" });
    expect(calls.find((url) => url.hostname === "news.google.com")?.searchParams.get("q")).toBe("경제");
  });
});

describe("같은 피드는 잠깐 함께 쓴다 (11/26 Codex 적대적 검토 #10)", () => {
  it("검색어만 다른 연합뉴스 · 한국경제 조회 6번이 피드를 한 번씩만 받는다. 실패한 응답은 남기지 않는다", async () => {
    const calls = mockFeeds();
    await Promise.all(["코스피", "증시", "환율", "금리", "물가", "수출"].map((query) => execute({ sources: ["yonhap", "hankyung"], query, limit: 2, content: "list" }).catch(() => null)));
    const feeds = calls.filter((u) => u.hostname === "www.yna.co.kr" || u.hostname === "www.hankyung.com").filter((u) => !u.pathname.startsWith("/view/") && !u.pathname.startsWith("/article/"));
    expect(feeds.map((u) => u.hostname).sort()).toEqual(["www.hankyung.com", "www.yna.co.kr"]);

    clearFeedCache();
    const failing = mockFeeds({ yonhap: new Error("RSS 연결 실패") });
    await execute({ sources: ["yonhap", "hankyung"], query: null, limit: 2, content: "list" }).catch(() => null);
    mockFeeds();
    const again = await execute({ sources: ["yonhap"], query: null, limit: 2, content: "list" });
    expect(again.data.articles.length).toBeGreaterThan(0);
    expect(failing.some((u) => u.hostname === "www.yna.co.kr")).toBe(true);
  });
});
