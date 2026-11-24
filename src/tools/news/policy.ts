/**
 * 정책브리핑 정책뉴스 (다섯째 뉴스 소스 "policy", 리더 11/24).
 *
 * 공공데이터포털 "문화체육관광부_정책브리핑_정책뉴스_API" (https://www.data.go.kr/data/15095335/openapi.do). 키는 ETF · 국내 지수 tool 과 같은
 * DATA_GO_KR_KEY (같은 계정으로 활용신청, 11/24 승인 확인). 이용 조건은 공공누리 1유형이라 출처(정책브리핑 · 부처) 표시가 조건입니다.
 * RSS 가 아니라 XML API 라 따로 받습니다. 한 번에 최대 4일(시작~끝 3일 차이)까지라, 최근 4일과 그 앞 4일을 함께 받아 8일 치를 씁니다
 * (더 길면 resultCode 98 THREE_DAYS_OVER_ERROR). 본문은 기사 페이지를 읽지 않고 응답의 DataContents 를 글자로 바꿔 씁니다.
 */
import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../../lib/http";
import { htmlToText, isAllowedArticleUrl, type Article } from "./sources";

export const POLICY_URL = "https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2";
/** 한 번에 받을 수 있는 날 수 (시작일 포함) */
export const POLICY_WINDOW_DAYS = 4;
const WINDOWS = 2;
const ROWS = 100;
const DAY_MS = 86_400_000;

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, isArray: (name) => name === "NewsItem" });

/** 한국 시간 날짜 (YYYYMMDD) */
function ymd(time: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(time)).replace(/-/g, "");
}

/** "11/23/2026 17:47:00" (한국 시간) → ISO */
export function approveDateIso(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(`${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

type PolicyItem = { Title?: unknown; SubTitle1?: unknown; DataContents?: unknown; MinisterCode?: unknown; OriginalUrl?: unknown; ApproveDate?: unknown };

/** 응답 XML → 기사. 결과 코드가 0 이 아니면 그 이유로 던집니다 (키는 메시지에 넣지 않음) */
export function parsePolicyNews(xml: string): Article[] {
  const root = parser.parse(xml) as { response?: { header?: { resultCode?: unknown; resultMsg?: unknown }; body?: { NewsItem?: PolicyItem[] } } };
  const header = root.response?.header;
  if (!header) throw new Error("정책브리핑 응답 형식이 잘못되었습니다.");
  if (text(header.resultCode) !== "0") throw new Error(`정책브리핑 응답 오류: ${text(header.resultMsg) || text(header.resultCode)}`);
  return (root.response?.body?.NewsItem ?? []).flatMap((item) => {
    const title = htmlToText(text(item.Title));
    const publishedAt = approveDateIso(text(item.ApproveDate));
    let url: URL;
    try {
      url = new URL(text(item.OriginalUrl));
    } catch {
      return [];
    }
    if (!title || !publishedAt || !isAllowedArticleUrl(url, "policy")) return [];
    const minister = text(item.MinisterCode).trim();
    const description = [htmlToText(text(item.SubTitle1)), htmlToText(text(item.DataContents))].filter(Boolean).join("\n");
    return [{ title, url: url.toString(), publisher: minister ? `정책브리핑(${minister})` : "정책브리핑", publishedAt, source: "policy" as const, ...(description ? { description } : {}) }];
  });
}

/** 최근 8일(4일씩 두 번)의 정책뉴스. 키가 없거나 응답이 실패하면 던집니다 (뉴스 tool 이 그 소스만 실패로 적음) */
export async function fetchPolicyNews(timeoutMs: number, now = Date.now()): Promise<Article[]> {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error("정책브리핑 조회 키(DATA_GO_KR_KEY)가 없습니다.");
  const windows = Array.from({ length: WINDOWS }, (_, k) => {
    const end = now - k * POLICY_WINDOW_DAYS * DAY_MS;
    return { startDate: ymd(end - (POLICY_WINDOW_DAYS - 1) * DAY_MS), endDate: ymd(end) };
  });
  const lists = await Promise.all(
    windows.map(async ({ startDate, endDate }) => {
      const url = new URL(POLICY_URL);
      url.searchParams.set("serviceKey", key);
      url.searchParams.set("startDate", startDate);
      url.searchParams.set("endDate", endDate);
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("numOfRows", String(ROWS));
      return parsePolicyNews(await fetchText(url.toString(), { timeoutMs }));
    }),
  );
  const seen = new Set<string>();
  return lists.flat().filter((article) => (seen.has(article.url) ? false : (seen.add(article.url), true)));
}

/** 검색어 없이 부를 때 남기는 경제 소식: 경제 부처이거나 제목에 경제 낱말 (정책뉴스에는 김장철 원산지 점검 같은 일반 정책도 섞임) */
const ECON_MINISTRY = /재정경제|기획재정|금융위|금융감독|산업통상|중소벤처|국토교통|공정거래|국가데이터|통계/;
const ECON_TITLE = /경제|성장|물가|금리|환율|수출|수입|무역|투자|고용|일자리|부동산|주택|금융|증시|예산|세수|세제|관세|반도체/;
export function isEconomicPolicy(article: Article): boolean {
  return ECON_MINISTRY.test(article.publisher) || ECON_TITLE.test(article.title);
}
