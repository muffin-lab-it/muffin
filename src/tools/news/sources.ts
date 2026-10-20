import { field, type RssFeed } from "./rss";

export const sourceIds = ["yonhap", "hankyung", "google"] as const;
export type NewsSourceId = (typeof sourceIds)[number];

export type Article = {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  source: NewsSourceId;
};

const articlePaths: Record<NewsSourceId, RegExp> = {
  yonhap: /^\/view\/AKR[A-Z0-9]+$/,
  hankyung: /^\/article\/[A-Za-z0-9]+$/,
  google: /^\/rss\/articles\/[A-Za-z0-9_-]+$/,
};
const articleHosts: Record<NewsSourceId, string> = {
  yonhap: "www.yna.co.kr",
  hankyung: "www.hankyung.com",
  google: "news.google.com",
};

export function isAllowedArticleUrl(url: URL, source: NewsSourceId): boolean {
  return url.protocol === "https:" && url.hostname === articleHosts[source]
    && !url.username && !url.password && !url.port && articlePaths[source].test(url.pathname);
}

type RawArticle = { title: string | null; url: string | null; publisher: string | null; publishedAt: string | null };
type NewsSource = {
  name: string;
  url: (query: string | null) => string;
  parse: (feed: RssFeed) => RawArticle[];
};

const YONHAP_URL = "https://www.yna.co.kr/rss/economy.xml";
const HANKYUNG_URL = "https://www.hankyung.com/feed/economy";
const GOOGLE_URL = "https://news.google.com/rss/search";

function common(item: Record<string, unknown>) {
  return {
    title: field(item.title),
    url: field(item.link),
    publishedAt: field(item.pubDate),
  };
}

function yonhap(feed: RssFeed): RawArticle[] {
  return feed.items.map((item) => ({ ...common(item), publisher: "연합뉴스" }));
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
    return [{ title: raw.title, url: url.toString(), publisher: raw.publisher, publishedAt: date.toISOString(), source: id }];
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
