import { z } from "zod";
import { fetchText } from "../../lib/http";
import { defineTool } from "../define";
import type { Source, ToolResult } from "../types";
import { fetchArticleBody, type BodyResult } from "./body";
import { parseRss } from "./rss";
import { newsSources, normalizeArticles, sourceIds, titleKey, type Article, type NewsSourceId } from "./sources";

export const parameters = z.object({
  sources: z.array(z.enum(sourceIds)).min(1).max(sourceIds.length).describe("조회할 RSS 소스. yonhap, hankyung, google 중 선택"),
  query: z.string().trim().min(1).max(100).nullable().describe("검색어. Google News는 RSS 검색에 사용하며, 다른 소스는 받은 기사 제목에서 필터링. 없으면 null이고 Google News는 '경제'로 검색"),
  limit: z.number().int().min(1).max(10).describe("반환할 최대 기사 수 (1~10, 보통 5건)"),
  content: z.enum(["list", "body"]).describe("list는 목록만, body는 공개 기사 본문 추출을 시도하고 기사별 상태를 반환"),
});

export type Input = z.infer<typeof parameters>;

export type NewsData = {
  articles: (Article & { body: BodyResult | { status: "not_requested" } })[];
  count: number;
  requestedCount: number;
  collectedCount: number;
  missingCount: number;
  inspectedCount: number;
  failedCount: number;
  failureCounts: Record<string, number>;
  failedArticles: { url: string; source: NewsSourceId; reason: string }[];
  resultStatus: "complete" | "partial";
  stopReason: "target_reached" | "feed_exhausted" | "candidate_limit" | "deadline";
  bodyStatus: "not_requested" | "complete" | "partial";
  failedSources: { source: NewsSourceId; error: string }[];
};

const RSS_TIMEOUT_MS = 3_000;
const BODY_TIMEOUT_MS = 2_500;
const TOTAL_BUDGET_MS = 8_500;
const MAX_CONCURRENT_BODIES = 4;
const MAX_CANDIDATES = 60;
const MAX_FAILED_SAMPLES = 10;
const MAX_TOTAL_BODY_CHARS = 80_000;

async function fetchSource(id: NewsSourceId, query: string | null): Promise<Article[]> {
  const xml = await fetchText(newsSources[id].url(query), { timeoutMs: RSS_TIMEOUT_MS });
  const feed = parseRss(xml);
  if (feed.items.length === 0) throw new Error("RSS 기사 항목이 없습니다.");
  const articles = normalizeArticles(feed, id);
  if (articles.length === 0) throw new Error("유효한 RSS 기사 항목이 없습니다.");
  return id !== "google" && query
    ? articles.filter((article) => article.title.toLocaleLowerCase("ko-KR").includes(query.toLocaleLowerCase("ko-KR")))
    : articles;
}

function deduplicate(articles: Article[]): Article[] {
  // 직접 언론사 링크를 Google News 중계 링크보다 우선합니다.
  const preferred = [...articles].sort((a, b) => Number(a.source === "google") - Number(b.source === "google"));
  const seenUrls = new Set<string>();
  const seenDirectTitles = new Set<string>();
  const seenGoogleTitles = new Set<string>();
  const out: Article[] = [];
  for (const article of preferred) {
    const url = new URL(article.url);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    const urlKey = url.toString();
    const headline = `${article.publisher.toLocaleLowerCase("ko-KR")}::${titleKey(article)}`;
    if (seenUrls.has(urlKey)) continue;
    if (article.source === "google" && (seenDirectTitles.has(headline) || seenGoogleTitles.has(headline))) continue;
    seenUrls.add(urlKey);
    if (article.source === "google") seenGoogleTitles.add(headline);
    else seenDirectTitles.add(headline);
    out.push(article);
  }
  return out;
}

/** Agent 없이도 실행합니다. 부분 실패는 결과에 명시하고, 전부 실패하거나 기사가 없으면 throw 합니다. */
export async function execute(input: Input): Promise<ToolResult<NewsData>> {
  const { sources, query, limit, content } = parameters.parse(input);
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const selected = [...new Set(sources)];
  const settled = await Promise.allSettled(selected.map((id) => fetchSource(id, query)));
  const articles: Article[] = [];
  const failedSources: NewsData["failedSources"] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") articles.push(...result.value);
    else failedSources.push({ source: selected[i], error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  if (failedSources.length === selected.length) {
    throw new Error(`모든 뉴스 RSS 조회가 실패했습니다: ${failedSources.map(({ source, error }) => `${source}: ${error}`).join("; ")}`);
  }

  const ranked = deduplicate(articles).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (ranked.length === 0) throw new Error("조건에 맞는 뉴스 기사가 없습니다.");
  const detailed: NewsData["articles"] = [];
  const failureCounts: Record<string, number> = {};
  const failedArticles: NewsData["failedArticles"] = [];
  let inspectedCount = 0;
  let failedCount = 0;
  let bodyCharacters = 0;
  let stopReason: NewsData["stopReason"] = "feed_exhausted";

  if (content === "list") {
    detailed.push(...ranked.slice(0, limit).map((article) => ({ ...article, body: { status: "not_requested" as const } })));
    if (detailed.length === limit) stopReason = "target_reached";
  } else {
    // Google 링크는 원문 URL이 미확정입니다. 본문을 제공할 수 있는 직접 피드를 먼저 확인합니다.
    const candidates = [...ranked.filter((article) => article.source !== "google"), ...ranked.filter((article) => article.source === "google")];
    const candidateLimit = Math.min(MAX_CANDIDATES, Math.max(15, limit * 3));
    for (let offset = 0; offset < candidates.length && offset < candidateLimit;) {
      if (Date.now() >= deadline) { stopReason = "deadline"; break; }
      const batchSize = Math.min(MAX_CONCURRENT_BODIES, limit - detailed.length, candidateLimit - offset);
      const batch = candidates.slice(offset, offset + batchSize);
      const timeoutMs = Math.max(1, Math.min(BODY_TIMEOUT_MS, deadline - Date.now()));
      const results = await Promise.all(batch.map((article) => fetchArticleBody(article, timeoutMs)));
      inspectedCount += batch.length;
      offset += batch.length;
      results.forEach((result, i) => {
        const body: BodyResult = result.status === "available" && bodyCharacters + result.text.length > MAX_TOTAL_BODY_CHARS
          ? { status: "unavailable", reason: "output_limit", detail: "한 번의 Tool 응답 본문 크기 제한을 넘습니다." }
          : result;
        if (body.status === "available") {
          detailed.push({ ...batch[i], body });
          bodyCharacters += body.text.length;
        } else {
          failedCount += 1;
          failureCounts[body.reason] = (failureCounts[body.reason] ?? 0) + 1;
          if (failedArticles.length < MAX_FAILED_SAMPLES) failedArticles.push({ url: batch[i].url, source: batch[i].source, reason: body.reason });
        }
      });
      if (detailed.length >= limit) { stopReason = "target_reached"; break; }
      if (offset >= candidateLimit && offset < candidates.length) stopReason = "candidate_limit";
    }
    detailed.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    if (detailed.length === 0) {
      throw new Error(`기사 본문을 확보하지 못했습니다: inspected=${inspectedCount}, failures=${JSON.stringify(failureCounts)}, stop=${stopReason}`);
    }
  }
  const resultStatus = detailed.length >= limit ? "complete" : "partial";
  const bodyStatus = content === "list" ? "not_requested" : resultStatus;
  const source: Source[] = detailed.map((article) => ({
    name: article.publisher,
    url: article.url,
    asOf: article.publishedAt,
  }));
  return {
    data: {
      articles: detailed, count: detailed.length, requestedCount: limit, collectedCount: detailed.length,
      missingCount: Math.max(0, limit - detailed.length), inspectedCount, failedCount, failureCounts,
      failedArticles, resultStatus, stopReason, bodyStatus, failedSources,
    },
    source,
    note: [
      "RSS의 제목·발행일·링크만 확인했습니다. 기사 속 수치는 별도 검증이 필요합니다.",
      content === "body" ? `본문 추출 상태: ${bodyStatus}. 요청 ${limit}건 중 ${detailed.length}건 확보했습니다.` : "기사 본문은 요청하지 않았습니다.",
      "Google News 링크는 원 언론사가 아닌 Google News 중계 링크일 수 있습니다.",
      failedSources.length ? `조회 실패 소스: ${failedSources.map(({ source }) => source).join(", ")}` : "",
    ].filter(Boolean).join(" "),
  };
}

export const newsTool = defineTool({
  name: "get_korean_economic_news",
  description:
    "연합뉴스·한국경제 RSS에서 국내 경제 뉴스 목록을 조회하고 공개 기사 본문 추출을 시도한다. Google News는 목록·검색 결과만 제공하며 검색어가 없으면 '경제'로 검색한다. limit은 최대 10건, 보통 5건을 요청한다. " +
    "content=body면 limit 건의 본문 확보를 목표로 후속 후보를 확인한다. resultStatus, missingCount, failureCounts를 반드시 확인한다. Google News 원문 미확정, 유료 기사, 추출 실패는 본문으로 사용하지 않는다. " +
    "국내 경제 이슈의 최근 보도나 검색어를 찾을 때 사용한다. 사실 검증, 해외 뉴스와 투자 권유는 제공하지 않는다.",
  parameters,
  execute,
  evidence: (data) => data.articles.map((article) => ({
    title: article.title,
    publisher: article.publisher,
    publishedAt: article.publishedAt,
    body: article.body.status,
  })),
  timeoutMs: 10_000,
});
