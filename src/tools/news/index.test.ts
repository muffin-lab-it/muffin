import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunContext } from "@openai/agents";
import { ResearchContext } from "../../agent/context";
import type { Source, ToolResult } from "../types";
import fixture from "./fixture.json";
import { execute, newsTool, parameters, type Input, type NewsData } from "./index";
import { extractHankyung, extractYonhap } from "./body";
import { fetchArticleBody } from "./body";
import { parseRss } from "./rss";
import { normalizeArticles } from "./sources";
import type { Article } from "./sources";

type FeedKey = "yonhap" | "hankyung" | "google";
const TEST_NOW = Date.UTC(2026, 9, 18, 12);
const DAY_MS = 24 * 60 * 60 * 1_000;

const feeds: Record<FeedKey, string> = {
  yonhap: fixture.yonhap,
  hankyung: fixture.hankyung,
  google: fixture.google,
};

function mockFeeds(overrides: Partial<Record<FeedKey, string | Response | Error>> = {}) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.startsWith("/view/")) return new Response(fixture.yonhapHtml);
    if (url.pathname.startsWith("/article/")) return new Response(fixture.hankyungHtml);
    const id: FeedKey = url.hostname === "www.yna.co.kr" ? "yonhap"
      : url.hostname === "www.hankyung.com" ? "hankyung" : "google";
    const value = overrides[id] ?? feeds[id];
    if (value instanceof Error) throw value;
    if (init?.signal?.aborted) throw init.signal.reason;
    return value instanceof Response ? value : new Response(value, { status: 200 });
  }));
  return calls;
}

const input = { sources: ["yonhap", "hankyung", "google"] as FeedKey[], query: null, limit: 10, content: "list" as const };

async function invokeNews(input: Input, context = new ResearchContext()) {
  const result = await newsTool.invoke(new RunContext(context), JSON.stringify(input));
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
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(TEST_NOW); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("News Tool", () => {
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
      const id = count === 1 ? "E1" : `E1-${i + 1}`;
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
      expect(context.evidence[i].note).toContain("기사 속 수치는 별도 검증이 필요합니다.");
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
    expect(context.evidence.map(({ id }) => id)).toEqual(["E1", "E2"]);
    expect(context.evidence[1].values).toMatchObject({ publisher: "한국경제", body: "unavailable" });
    expect(context.steps.map(({ status }) => status)).toEqual(["ok", "ok"]);
    expect(calls).toHaveLength(2);
    expect(calls.every((url) => url.pathname === "/rss/search")).toBe(true);
    const before = structuredClone(context.evidence);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("RSS 연결 실패"));
    const failed = await newsTool.invoke(new RunContext(context), JSON.stringify(googleInput));
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
    expect(result.note).toContain("조회 실패 소스: yonhap");
    expect(result.source).toHaveLength(result.data.count);
  });

  it("검색 결과가 없으면 명시적으로 실패한다", async () => {
    mockFeeds();
    await expect(execute({ ...input, sources: ["yonhap"], query: "없는 검색어" })).rejects.toThrow("조건에 맞는 뉴스 기사");
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
    expect(fallback.note).toContain("본문은 0건");
    expect(fallback.note).toContain("제목에 없는 원인·인과관계를 추정하지 마세요");
    expect(fallback.note).toContain("Google News 중계 링크");
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
      const id = limit === 1 ? "E1" : `E1-${i + 1}`;
      expect(article.body).toMatchObject({ status: "unavailable", reason: "original_url_unresolved" });
      expect(article.body).not.toHaveProperty("text");
      expect(result.source[i]).toEqual({ id, ...source });
      expect(context.sources[i]).toEqual(source);
      expect(context.evidence[i]).toMatchObject({ id, source, values: {
        title: article.title, publisher: article.publisher, publishedAt: article.publishedAt, body: "unavailable",
      } });
      expect(context.evidence[i].note).toContain("본문은 0건");
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
    expect(note).toContain("조회 실패 소스: yonhap");
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
