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
  content: z.enum(["list", "body"]).describe("list는 목록만, body는 본문 추출을 시도한다. 본문 0건이면 이미 수집한 Google 제목 목록만 반환하며 본문 미확보를 명시"),
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
/** tool 전체 제한 (defineTool timeoutMs). 대신 부르는 뉴스 검색은 이 안에서 끝나야 결과가 버려지지 않습니다 */
const TOOL_TIMEOUT_MS = 10_000;
/** 대신 검색을 시작하려면 남아 있어야 하는 시간. 이보다 적으면 부르지 않고 지금처럼 실패합니다 (#157 Codex 리뷰) */
const SEARCH_MIN_MS = 1_000;
const MAX_CONCURRENT_BODIES = 4;
const MAX_CANDIDATES = 60;
const MAX_FAILED_SAMPLES = 10;
const MAX_TOTAL_BODY_CHARS = 80_000;
const TITLE_FALLBACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

/** 비교 전에 지우는 글자: 공백 · / · 가운뎃점 · 줄표 · 따옴표 ("원/달러" 와 "원달러", "원·달러" 를 같게) */
const NOISE = /[\s/·・‧\-–—'"‘’“”`]/g;
const squash = (text: string) => text.toLocaleLowerCase("ko-KR").replace(NOISE, "");
/** 검색어에서 빼는 질문어. 제목에 거의 쓰이지 않아 남기면 맞는 기사가 0건이 됩니다 ("원/달러 환율 원인") */
const QUESTION_WORDS = new Set(["원인", "이유", "배경", "전망", "영향", "상승", "하락", "최근", "요즘", "이번주", "이번", "왜", "동향", "흐름"]);

/**
 * 검색어의 낱말이 모두 제목(+ 설명)에 있는지. 직접 피드는 몇 시간 치 기사뿐이라 검색어 전체("소비자물가 상승 원인")가 그대로 든 제목은 드뭅니다 (11/23).
 * 낱말 순서 · 띄어쓰기 · "/ · - 따옴표" 가 달라도 찾고, 질문어(원인 · 이유 · 최근 …)는 빼고 봅니다. 질문어뿐이면 그대로 봅니다.
 * 설명은 연합뉴스 · 한국은행만 있습니다 (11/24: 피드로 재 보니 "원달러 환율" 0→2건, "원/달러 환율 원인" 0→2건, "코스피" 4→6건)
 */
export function titleMatches(title: string, query: string, description = ""): boolean {
  const hay = squash(`${title} ${description}`);
  const words = query.split(/\s+/).map(squash).filter(Boolean);
  const kept = words.filter((w) => !QUESTION_WORDS.has(w));
  return (kept.length > 0 ? kept : words).every((w) => hay.includes(w));
}

/** 뉴스 검색 결과가 정말 비었다는 오류 (검색 서비스 장애와 구분) */
const EMPTY_FEED = /RSS 기사 항목이 없습니다|유효한 RSS 기사 항목이 없습니다/;

/**
 * 직접 피드를 대신할 같은 검색어의 뉴스 검색. 검색 결과가 비었으면 빈 목록, 검색 서비스가 실패하면(시간 초과 · 503 등) 그 오류를 그대로 던집니다.
 * 장애를 0건으로 바꾸면 defineTool 의 재시도가 돌지 않고, 조사 단계가 그 검색어를 결과 없음으로 기억해 다시 찾지 않습니다 (#157 Codex 리뷰)
 */
async function searchInstead(query: string, startedAt: number): Promise<Article[]> {
  // tool 전체 제한 안에서 끝나도록 남은 시간(여유 0.3초)만 씁니다. 모자라면 부르지 않습니다
  const remaining = startedAt + TOOL_TIMEOUT_MS - 300 - Date.now();
  if (remaining < SEARCH_MIN_MS) return [];
  try {
    return await fetchSource("google", query, Math.min(RSS_TIMEOUT_MS, remaining));
  } catch (err) {
    if (err instanceof Error && EMPTY_FEED.test(err.message)) return [];
    throw err;
  }
}

async function fetchSource(id: NewsSourceId, query: string | null, timeoutMs = RSS_TIMEOUT_MS): Promise<Article[]> {
  const xml = await fetchText(newsSources[id].url(query), { timeoutMs });
  const feed = parseRss(xml);
  if (feed.items.length === 0) throw new Error("RSS 기사 항목이 없습니다.");
  const articles = normalizeArticles(feed, id);
  if (articles.length === 0) throw new Error("유효한 RSS 기사 항목이 없습니다.");
  return id !== "google" && query ? articles.filter((article) => titleMatches(article.title, query, article.description)) : articles;
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

/** 돌려줄 기사에서 설명(description)을 뺍니다. 설명은 거름망 · 한국은행 본문에만 쓰고, 결과에 실으면 본문 길이 제한을 우회해 모델 입력이 길어집니다 (#163 Codex 리뷰) */
function publicArticle(article: Article): Article {
  const rest = { ...article };
  delete rest.description;
  return rest;
}

/** Agent 없이도 실행합니다. 부분 실패는 결과에 명시하고, 전부 실패하거나 기사가 없으면 throw 합니다. */
export async function execute(input: Input): Promise<ToolResult<NewsData>> {
  const { sources, query, limit, content } = parameters.parse(input);
  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_BUDGET_MS;
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

  // 직접 피드에 검색어와 맞는 기사가 없으면 같은 검색어로 뉴스 검색 결과를 받습니다. 피드에는 몇 시간 치만 있어 "소비자물가" 같은 낱말도 0건이 흔합니다
  // (11/23 녹화: 물가 원인 질문의 뉴스 호출이 0.5초 만에 "조건에 맞는 뉴스 기사가 없습니다" 로 실패, 3번 중 2번 · 운영 기록의 뉴스 실패 대부분이 이 경우)
  let searchFallback = false;
  if (query && !selected.includes("google") && deduplicate(articles).length === 0) {
    const searched = await searchInstead(query, startedAt);
    if (searched.length > 0) {
      articles.push(...searched);
      searchFallback = true;
    }
  }
  const ranked = deduplicate(articles).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (ranked.length === 0) throw new Error("조건에 맞는 뉴스 기사가 없습니다.");
  const detailed: NewsData["articles"] = [];
  const failureCounts: Record<string, number> = {};
  const failedArticles: NewsData["failedArticles"] = [];
  const titleOnly: NewsData["articles"] = [];
  let inspectedCount = 0;
  let failedCount = 0;
  let bodyCharacters = 0;
  let stopReason: NewsData["stopReason"] = "feed_exhausted";

  if (content === "list") {
    detailed.push(...ranked.slice(0, limit).map((article) => ({ ...publicArticle(article), body: { status: "not_requested" as const } })));
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
          ? { status: "unavailable", reason: "output_limit", detail: "한 번에 돌려줄 수 있는 본문 크기를 넘어 이 기사는 본문을 싣지 않았어요." }
          : result;
        if (body.status === "available") {
          detailed.push({ ...publicArticle(batch[i]), body });
          bodyCharacters += body.text.length;
        } else {
          failedCount += 1;
          failureCounts[body.reason] = (failureCounts[body.reason] ?? 0) + 1;
          // 한국은행 자료는 본문이 첨부파일뿐이어도 공식 자료라 제목 근거로 남깁니다 (#163 Codex 리뷰)
          if (body.reason === "attachment_only") titleOnly.push({ ...publicArticle(batch[i]), body });
          if (failedArticles.length < MAX_FAILED_SAMPLES) failedArticles.push({ url: batch[i].url, source: batch[i].source, reason: body.reason });
        }
      });
      if (detailed.length >= limit) { stopReason = "target_reached"; break; }
      if (offset >= candidateLimit && offset < candidates.length) stopReason = "candidate_limit";
    }
    detailed.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    // 검색어가 있는데 본문을 하나도 못 받았고 뉴스 검색 결과도 없으면, 같은 검색어로 뉴스 검색 제목을 받아 제목 근거로 씁니다
    // (11/23 로컬: 물가 원인 질문에서 검색어에 맞는 기사 2건이 모두 한국경제 유료 기사라 실패하고 5시간 전 저장 응답을 씀)
    // 본문을 하나도 못 받았으면 첨부파일뿐인 한국은행 자료를 먼저 제목 근거로 씁니다 (뉴스 검색 제목으로 바꾸지 않음, #163 Codex 리뷰)
    if (detailed.length === 0 && titleOnly.length > 0) detailed.push(...titleOnly.slice(0, limit));
    if (detailed.length === 0 && query && !selected.includes("google") && !articles.some((article) => article.source === "google")) {
      const searched = await searchInstead(query, startedAt);
      if (searched.length > 0) {
        articles.push(...searched);
        searchFallback = true;
      }
    }
    if (detailed.length === 0) {
      // 직접 기사와 중복돼 본문 후보에서 제외된 Google 목록도 제목 근거로는 사용할 수 있습니다.
      // 새 요청 없이 Google끼리 중복을 제거하고, 본문 검사·실패 집계는 그대로 유지합니다.
      const googleTitles = deduplicate(articles.filter((article) => {
        const publishedAt = Date.parse(article.publishedAt);
        return article.source === "google"
          && publishedAt >= startedAt - TITLE_FALLBACK_MAX_AGE_MS && publishedAt <= startedAt;
      }))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      detailed.push(...googleTitles.slice(0, limit).map((article) => ({
        ...article,
        body: {
          status: "unavailable" as const,
          reason: "original_url_unresolved" as const,
          detail: "뉴스 검색 서비스의 링크라 원문 주소를 확정할 수 없어요. 제목만 확인했어요.",
        },
      })));
    }
    if (detailed.length === 0) {
      throw new Error(`기사 본문을 확보하지 못했습니다: inspected=${inspectedCount}, failures=${JSON.stringify(failureCounts)}, stop=${stopReason}`);
    }
  }
  // body 요청의 확보·부족 수량은 제목 fallback을 본문 성공으로 계산하지 않습니다.
  const collectedCount = content === "list" ? detailed.length : detailed.filter(({ body }) => body.status === "available").length;
  const titleFallback = content === "body" && collectedCount === 0;
  const resultStatus = detailed.length >= limit ? "complete" : "partial";
  const bodyStatus = content === "list" ? "not_requested" : collectedCount >= limit ? "complete" : "partial";
  const source: Source[] = detailed.map((article) => ({
    name: article.publisher,
    url: article.url,
    asOf: article.publishedAt,
  }));
  return {
    data: {
      articles: detailed, count: detailed.length, requestedCount: limit, collectedCount,
      missingCount: Math.max(0, limit - collectedCount), inspectedCount, failedCount, failureCounts,
      failedArticles, resultStatus, stopReason, bodyStatus, failedSources,
    },
    source,
    // note 는 원본 보기에도 보이는 사람 말입니다 (해요체, 키 이름 없이). bodyStatus · resultStatus 확인 같은 모델용 지시는 description 에 있습니다 (11/23)
    note: [
      content === "list"
        ? "기사 본문은 보지 않고 제목 · 발행일 · 링크만 확인했어요."
        : titleFallback
          ? `본문은 받지 못해 기사 제목 ${detailed.length}건만 확인했어요.`
          : `기사 ${limit}건의 본문을 받으려 했고 ${collectedCount}건을 받았어요.`,
      "기사 속 수치는 따로 검증하지 않았어요. 본문을 받았다고 원인 · 인과관계가 확인된 것은 아니에요.",
      searchFallback ? "연합뉴스 · 한국경제 피드에서 쓸 기사를 찾지 못해 같은 검색어의 뉴스 검색 결과를 대신 받았어요." : "",
      detailed.some((article) => article.source === "bok") ? "한국은행 보도자료는 한국은행 홈페이지 원문(링크)을 글자만 남겨 옮겼어요." : "",
      detailed.some((article) => article.source === "google") ? "일부 기사 링크는 언론사 원문이 아니라 뉴스 검색 서비스를 거쳐 열릴 수 있어요." : "",
      failedSources.length ? `이번에 기사를 받지 못한 곳: ${failedSources.map(({ source }) => SOURCE_LABEL[source]).join(", ")}.` : "",
    ].filter(Boolean).join(" "),
  };
}

/** 원본 보기에 보이는 출처 이름 */
const SOURCE_LABEL: Record<NewsSourceId, string> = { yonhap: "연합뉴스", hankyung: "한국경제", google: "뉴스 검색", bok: "한국은행" };

export const newsTool = defineTool({
  name: "get_korean_economic_news",
  description:
    "연합뉴스·한국경제 RSS에서 국내 경제 뉴스 목록을 조회하고 공개 기사 본문 추출을 시도한다. Google News는 목록·검색 결과만 제공하며 검색어가 없으면 '경제'로 검색한다. limit은 최대 10건, 보통 5건을 요청한다. " +
    "content=body면 limit 건의 본문 확보를 목표로 후속 후보를 확인한다. resultStatus, missingCount, failureCounts를 반드시 확인한다. Google News 원문 미확정, 유료 기사, 추출 실패는 본문으로 사용하지 않는다. " +
    "본문이 0건이고 선택한 Google RSS 목록이 있으면 제목 근거로만 반환한다(bodyStatus · resultStatus 로 확인). 그때는 제목에 직접 드러난 사실만 근거로 쓰고, 본문을 읽은 것처럼 설명하지 않는다. collectedCount는 본문 확보 수이며 제목 fallback은 포함하지 않는다. 기사마다 body.status 로 본문 확보 여부를 확인한다. 기사 속 수치는 검증된 통계가 아니다. 제목에 없는 원인을 추정하거나 인과관계를 검증했다고 표현하지 않는다. " +
    "연합뉴스 · 한국경제 · 한국은행(bok)은 검색어의 낱말이 모두 든 제목(연합뉴스 · 한국은행은 설명 포함)을 고른다. 띄어쓰기 · / · 가운뎃점 · 줄표 · 따옴표는 무시하고, 질문어(원인 · 이유 · 배경 · 전망 · 영향 · 상승 · 하락 · 최근 · 요즘 · 왜 · 동향 · 흐름)는 뺀다. 맞는 기사가 없으면 같은 검색어의 Google News 검색 결과를 대신 돌려준다. " +
    "bok 은 한국은행 보도자료(석 달 치)로, 본문은 RSS 설명이고 짧은 것은 제목만이다. " +
    "국내 경제 이슈의 최근 보도나 검색어를 찾을 때 사용한다. 사실 검증, 해외 뉴스와 투자 권유는 제공하지 않는다.",
  parameters,
  execute,
  evidence: (data) => data.articles.map((article) => ({
    title: article.title,
    publisher: article.publisher,
    publishedAt: article.publishedAt,
    body: article.body.status,
  })),
  timeoutMs: TOOL_TIMEOUT_MS,
});
