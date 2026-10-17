import { load } from "cheerio";
import { fetchText } from "../../lib/http";
import { isAllowedArticleUrl, type Article } from "./sources";

export const MAX_HTML_CHARS = 1_000_000;
export const MAX_BODY_CHARS = 12_000;

export type BodyResult =
  | { status: "available"; text: string }
  | { status: "unavailable"; reason: "original_url_unresolved" | "unsupported_publisher" | "invalid_url" | "access_restricted" | "http_error" | "timeout" | "response_too_large" | "body_too_large" | "output_limit" | "structure_changed"; detail: string };

function paragraphs(parts: string[]): string | null {
  const cleaned = parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique = cleaned.filter((part) => {
    if (seen.has(part)) return false;
    seen.add(part);
    return true;
  });
  const text = unique.join("\n\n");
  return text.length >= 40 ? text : null;
}

/** 연합뉴스 공개 기사: 사진 설명과 광고를 제외하고 본문 직속 문단만 읽습니다. */
export function extractYonhap(html: string): BodyResult {
  const $ = load(html);
  const article = $(".story-news.article").first();
  const text = paragraphs(article.children("p").map((_, element) => $(element).text()).get());
  return text
    ? text.length > MAX_BODY_CHARS
      ? { status: "unavailable", reason: "body_too_large", detail: "기사 본문이 허용 크기를 넘었습니다." }
      : { status: "available", text }
    : { status: "unavailable", reason: "structure_changed", detail: "연합뉴스 본문 문단을 찾지 못했습니다." };
}

/** 한국경제 공개 기사: 유료 표시는 먼저 차단하고 articleBody 영역만 읽습니다. */
export function extractHankyung(html: string): BodyResult {
  if (/hk_premium_only\s*:\s*['"]y['"]/.test(html) || /hk_article_type\s*:\s*['"]유료기사뷰['"]/.test(html)) {
    return { status: "unavailable", reason: "access_restricted", detail: "한국경제 유료 기사입니다." };
  }
  const $ = load(html);
  const article = $(".article-body[itemprop='articleBody']").first();
  if (!article.length) {
    return { status: "unavailable", reason: "structure_changed", detail: "한국경제 공개 본문 영역을 찾지 못했습니다." };
  }
  article.find("figure, figcaption, script, style, aside, .ad, .advertisement, .related-news, .article-link").remove();
  article.find("br").replaceWith("\n");
  article.find("p, h2, h3, div").each((_, element) => { $(element).append("\n"); });
  const text = paragraphs(article.text().split(/\n+/));
  return text
    ? text.length > MAX_BODY_CHARS
      ? { status: "unavailable", reason: "body_too_large", detail: "기사 본문이 허용 크기를 넘었습니다." }
      : { status: "available", text }
    : { status: "unavailable", reason: "structure_changed", detail: "한국경제 본문 텍스트가 비어 있습니다." };
}

type Extractor = { parse: (html: string) => BodyResult };
const extractors: Partial<Record<Article["source"], Extractor>> = {
  yonhap: { parse: extractYonhap },
  hankyung: { parse: extractHankyung },
};

export async function fetchArticleBody(article: Article, timeoutMs = 2_500): Promise<BodyResult> {
  if (article.source === "google") {
    return { status: "unavailable", reason: "original_url_unresolved", detail: "Google News 중계 링크에서 원문 URL을 확정할 수 없습니다." };
  }
  const extractor = extractors[article.source];
  if (!extractor) return { status: "unavailable", reason: "unsupported_publisher", detail: "본문 추출기를 지원하지 않는 언론사입니다." };
  let url: URL;
  try { url = new URL(article.url); } catch {
    return { status: "unavailable", reason: "invalid_url", detail: "기사 URL이 잘못되었습니다." };
  }
  if (!isAllowedArticleUrl(url, article.source)) {
    return { status: "unavailable", reason: "invalid_url", detail: "허용된 언론사 기사 URL이 아닙니다." };
  }
  url.search = "";
  url.hash = "";
  try {
    const html = await fetchText(url.toString(), { timeoutMs });
    if (html.length > MAX_HTML_CHARS) {
      return { status: "unavailable", reason: "response_too_large", detail: "기사 HTML이 허용 크기를 넘었습니다." };
    }
    return extractor.parse(html);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const reason = (error instanceof Error && error.name === "TimeoutError") || /timeout/i.test(detail) ? "timeout" : "http_error";
    return { status: "unavailable", reason, detail };
  }
}
