import { load } from "cheerio";
import { fetchText } from "../../lib/http";
import { isAllowedArticleUrl, type Article } from "./sources";

export const MAX_HTML_CHARS = 1_000_000;
export const MAX_BODY_CHARS = 12_000;

export type BodyResult =
  | { status: "available"; text: string }
  | { status: "unavailable"; reason: "original_url_unresolved" | "unsupported_publisher" | "invalid_url" | "access_restricted" | "http_error" | "timeout" | "response_too_large" | "body_too_large" | "output_limit" | "structure_changed" | "attachment_only"; detail: string };

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
      ? { status: "unavailable", reason: "body_too_large", detail: "기사 본문이 허용 크기를 넘었어요." }
      : { status: "available", text }
    : { status: "unavailable", reason: "structure_changed", detail: "연합뉴스 본문 문단을 찾지 못했어요." };
}

/** 한국경제 공개 기사: 유료 표시는 먼저 차단하고 articleBody 영역만 읽습니다. */
export function extractHankyung(html: string): BodyResult {
  if (/hk_premium_only\s*:\s*['"]y['"]/.test(html) || /hk_article_type\s*:\s*['"]유료기사뷰['"]/.test(html)) {
    return { status: "unavailable", reason: "access_restricted", detail: "한국경제 유료 기사예요." };
  }
  const $ = load(html);
  const article = $(".article-body[itemprop='articleBody']").first();
  if (!article.length) {
    return { status: "unavailable", reason: "structure_changed", detail: "한국경제 공개 본문 영역을 찾지 못했어요." };
  }
  article.find("figure, figcaption, script, style, aside, .ad, .advertisement, .related-news, .article-link").remove();
  article.find("br").replaceWith("\n");
  article.find("p, h2, h3, div").each((_, element) => { $(element).append("\n"); });
  const text = paragraphs(article.text().split(/\n+/));
  return text
    ? text.length > MAX_BODY_CHARS
      ? { status: "unavailable", reason: "body_too_large", detail: "기사 본문이 허용 크기를 넘었어요." }
      : { status: "available", text }
    : { status: "unavailable", reason: "structure_changed", detail: "한국경제 본문 텍스트가 비어 있어요." };
}

type Extractor = { parse: (html: string) => BodyResult };
const extractors: Partial<Record<Article["source"], Extractor>> = {
  yonhap: { parse: extractYonhap },
  hankyung: { parse: extractHankyung },
};

/** 한국은행 보도자료 설명이 이만큼 길어야 본문으로 씁니다. 짧은 것은 "자세한 내용은 붙임을 참고" 류라 제목만 씁니다 */
export const BOK_MIN_BODY_CHARS = 200;

export async function fetchArticleBody(article: Article, timeoutMs = 2_500): Promise<BodyResult> {
  // 한국은행 보도자료 · 정책브리핑은 페이지를 읽지 않고 받은 설명(RSS description · API DataContents)을 본문으로 씁니다
  // (11/24 실측: 한국은행은 100건 중 8건이 300자 이상 · 59건은 "붙임 참고" 한 줄, 정책브리핑은 전부 300자 이상 · 평균 1,900자)
  if (article.source === "bok" || article.source === "policy") {
    const text = article.description ?? "";
    return text.length >= BOK_MIN_BODY_CHARS
      ? { status: "available", text: text.slice(0, MAX_BODY_CHARS) }
      : { status: "unavailable", reason: "attachment_only", detail: "본문이 첨부파일에 있어 제목만 확인했어요." };
  }
  if (article.source === "google") {
    return { status: "unavailable", reason: "original_url_unresolved", detail: "뉴스 검색 서비스의 링크라 원문 주소를 확정할 수 없어요." };
  }
  const extractor = extractors[article.source];
  if (!extractor) return { status: "unavailable", reason: "unsupported_publisher", detail: "본문을 읽어 올 수 없는 언론사예요." };
  let url: URL;
  try { url = new URL(article.url); } catch {
    return { status: "unavailable", reason: "invalid_url", detail: "기사 주소가 잘못됐어요." };
  }
  if (!isAllowedArticleUrl(url, article.source)) {
    return { status: "unavailable", reason: "invalid_url", detail: "허용된 언론사 기사 주소가 아니에요." };
  }
  url.search = "";
  url.hash = "";
  try {
    const html = await fetchText(url.toString(), { timeoutMs, redirect: "error" });
    if (html.length > MAX_HTML_CHARS) {
      return { status: "unavailable", reason: "response_too_large", detail: "기사 페이지가 허용 크기를 넘었어요." };
    }
    return extractor.parse(html);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const reason = (error instanceof Error && error.name === "TimeoutError") || /timeout/i.test(detail) ? "timeout" : "http_error";
    return { status: "unavailable", reason, detail };
  }
}
