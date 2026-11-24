import { field, type RssFeed } from "./rss";

export const sourceIds = ["yonhap", "hankyung", "google", "bok"] as const;
export type NewsSourceId = (typeof sourceIds)[number];

export type Article = {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  source: NewsSourceId;
  /** RSS 설명(description)을 글자만 남긴 것. 연합뉴스 · 한국은행만 있습니다. 거름망과 한국은행 본문에 쓰고 장부에는 올리지 않습니다 */
  description?: string;
};

const articlePaths: Record<NewsSourceId, RegExp> = {
  yonhap: /^\/view\/AKR[A-Z0-9]+$/,
  hankyung: /^\/article\/[A-Za-z0-9]+$/,
  google: /^\/rss\/articles\/[A-Za-z0-9_-]+$/,
  // 한국은행 보도자료 게시판 (B0000501 · B0000502 · P000055 등). 주소의 menuNo 를 떼면 404 라 그대로 씁니다
  bok: /^\/portal\/bbs\/[BP]\d{6,7}\/view\.do$/,
};
const articleHosts: Record<NewsSourceId, string> = {
  yonhap: "www.yna.co.kr",
  hankyung: "www.hankyung.com",
  google: "news.google.com",
  bok: "www.bok.or.kr",
};

export function isAllowedArticleUrl(url: URL, source: NewsSourceId): boolean {
  return url.protocol === "https:" && url.hostname === articleHosts[source]
    && !url.username && !url.password && !url.port && articlePaths[source].test(url.pathname);
}

type RawArticle = { title: string | null; url: string | null; publisher: string | null; publishedAt: string | null; description?: string | null };
type NewsSource = {
  name: string;
  url: (query: string | null) => string;
  parse: (feed: RssFeed) => RawArticle[];
};

const YONHAP_URL = "https://www.yna.co.kr/rss/economy.xml";
const HANKYUNG_URL = "https://www.hankyung.com/feed/economy";
const GOOGLE_URL = "https://news.google.com/rss/search";
/** 한국은행 보도자료 RSS (석 달 치 100건 안팎). 이용 조건: 한국은행 저작권 보호방침 (출처 "한국은행" · 원문 링크 · 가공 표시) */
const BOK_URL = "https://www.bok.or.kr/portal/bbs/B0000552/news.rss?menuNo=200690";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}
/** RSS 설명 HTML 을 글자만 남깁니다. 한국은행 설명은 HTML 이 한 번 더 이스케이프돼 있어(&lt;p&gt;) 두 번 풉니다 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const decoded = decodeEntities(decodeEntities(html));
  return decodeEntities(decoded.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function common(item: Record<string, unknown>) {
  return {
    title: field(item.title),
    url: field(item.link),
    publishedAt: field(item.pubDate),
  };
}

function yonhap(feed: RssFeed): RawArticle[] {
  return feed.items.map((item) => ({ ...common(item), publisher: "연합뉴스", description: htmlToText(field(item.description)) }));
}

function bok(feed: RssFeed): RawArticle[] {
  return feed.items.map((item) => ({ ...common(item), publisher: "한국은행", description: htmlToText(field(item.description)) }));
}

function hankyung(feed: RssFeed): RawArticle[] {
  return feed.items.map((item) => ({ ...common(item), publisher: "한국경제" }));
}

function google(feed: RssFeed): RawArticle[] {
  return feed.items.map((item) => ({
    ...common(item),
    publisher: field(item.source),
  }));
}

export const newsSources: Record<NewsSourceId, NewsSource> = {
  yonhap: { name: "연합뉴스 경제", url: () => YONHAP_URL, parse: yonhap },
  hankyung: { name: "한국경제 경제", url: () => HANKYUNG_URL, parse: hankyung },
  google: {
    name: "Google News 국내 경제 검색",
    url: (query) => {
      const url = new URL(GOOGLE_URL);
      url.searchParams.set("q", query ?? "경제");
      url.searchParams.set("hl", "ko");
      url.searchParams.set("gl", "KR");
      url.searchParams.set("ceid", "KR:ko");
      return url.toString();
    },
    parse: google,
  },
  bok: { name: "한국은행 보도자료", url: () => BOK_URL, parse: bok },
};

/** 날짜·URL이 불완전한 항목은 제외합니다. 피드 전체가 무효면 호출자가 실패시킵니다. */
export function normalizeArticles(feed: RssFeed, id: NewsSourceId): Article[] {
  return newsSources[id].parse(feed).flatMap((raw) => {
    if (!raw.title || !raw.url || !raw.publisher || !raw.publishedAt) return [];
    const date = new Date(raw.publishedAt);
    if (Number.isNaN(date.getTime())) return [];
    let url: URL;
    try {
      url = new URL(raw.url);
    } catch {
      return [];
    }
    if (!isAllowedArticleUrl(url, id)) return [];
    return [{ title: raw.title, url: url.toString(), publisher: raw.publisher, publishedAt: date.toISOString(), source: id, ...(raw.description ? { description: raw.description } : {}) }];
  });
}

/** Google News 제목의 매체 접미사만 제거해 직접 제공처 기사와 중복을 비교합니다. */
export function titleKey(article: Article): string {
  const suffix = ` - ${article.publisher}`;
  const title = article.source === "google" && article.title.endsWith(suffix)
    ? article.title.slice(0, -suffix.length)
    : article.title;
  return title.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}
