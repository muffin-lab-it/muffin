import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { execute, parameters } from "./index";
import { extractHankyung, extractYonhap } from "./body";
import { fetchArticleBody } from "./body";
import { parseRss } from "./rss";
import { normalizeArticles } from "./sources";
import type { Article } from "./sources";

type FeedKey = "yonhap" | "hankyung" | "google";

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

function syntheticFeed(count: number, source: "yonhap" | "hankyung" = "yonhap"): string {
  const items = Array.from({ length: count }, (_, i) => `<item><title>합성 경제 기사 ${i}</title><link>${source === "yonhap" ? "https://www.yna.co.kr/view/AKRTEST" : "https://www.hankyung.com/article/TEST"}${String(i).padStart(3, "0")}</link><pubDate>${new Date(Date.UTC(2026, 9, 17, 12, 0, 0) - i * 60_000).toUTCString()}</pubDate></item>`);
  return `<rss><channel>${items.join("")}</channel></rss>`;
}

function mockBodyScenario(count: number, unavailable: Record<number, "paid" | "missing" | "error"> = {}, source: "yonhap" | "hankyung" = "yonhap") {
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
    if (unavailable[index] === "paid") return new Response("hk_premium_only: 'y'");
    if (unavailable[index] === "missing") return new Response("<html>본문 구조 없음</html>");
    if (unavailable[index] === "error") return new Response("오류", { status: 503 });
    return new Response(source === "yonhap" ? fixture.yonhapHtml : fixture.hankyungHtml);
  }));
  return { requested, maxActive: () => maxActive };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("News Tool", () => {
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

  it("Google 목록은 조회하지만 본문 필수 호출은 명시적으로 실패한다", async () => {
    mockFeeds();
    const result = await execute({ ...input, sources: ["google"] });
    expect(result.data.bodyStatus).toBe("not_requested");
    await expect(execute({ ...input, sources: ["google"], content: "body" })).rejects.toThrow("original_url_unresolved");
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
