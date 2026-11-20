/**
 * "오늘 경제 뉴스 알려줘" 같은 주제 없는 뉴스 질문의 기사 고르기 (리더, 11/21).
 *
 * 11/20 베타: 금융권 사용자가 "오늘 경제 뉴스" 를 물었더니 김장재료 할인 · 창업 지원 사업이 나와 "경제 뉴스 퀄리티가 급선무" 라고 했습니다.
 * 검색어 없이 부르면 뉴스 tool 은 피드의 최신 기사를 그대로 주는데, 경제 피드에는 상품 출시 · 행사 · 인사 기사가 많습니다 (11/21 실측: 위스키 출시 ·
 * 다이소 품절 · 협회장 당선, 같은 날 코스피 5% 급락 기사는 빠짐). 그래서 주제 없는 뉴스 질문이면 코드가 경제 흐름 주제어(증시 · 환율 · 금리 · 물가 · 수출)로
 * 제목을 한 번 더 찾아 장부에 올리고, 작성에는 이 기사들을 먼저 쓰라고 알립니다. 뉴스 tool 과 조사 지시문은 건드리지 않습니다.
 */
import { execute as fetchNews, type NewsData } from "../tools/news";
import type { ResearchContext } from "./context";
import { labelFor } from "./events";
import { areaTools } from "./plan";
import type { Evidence } from "./schema";

/** 경제 흐름 주제어. 연합뉴스 · 한국경제 피드에서 제목에 이 낱말이 든 기사를 찾습니다 */
export const MACRO_TOPICS = ["코스피", "증시", "환율", "금리", "물가", "수출"] as const;
const PER_TOPIC = 2;
const MAX_ARTICLES = 6;

const NEWS_WORDS = /뉴스|기사|소식|이슈|헤드라인/;
/** 질문이 이미 주제를 말했는지. 말했으면 조사가 그 주제로 찾으므로 보태지 않습니다 */
const TOPIC_WORDS = /환율|달러|엔화|유로|금리|물가|인플레|CPI|코스피|코스닥|증시|주식|ETF|수출|무역|고용|실업|부동산|반도체|유가|원유/i;

/** 주제 없이 경제 뉴스를 묻는 질문인지 ("오늘 경제 뉴스 알려줘", "이번 주 경제 이슈 뭐 있어?") */
export function isGeneralNewsQuestion(question: string): boolean {
  return NEWS_WORDS.test(question) && !TOPIC_WORDS.test(question);
}

type NewsFetch = (input: { sources: ("yonhap" | "hankyung")[]; query: string; limit: number; content: "list" }) => Promise<{ data: NewsData }>;

/**
 * 주제 없는 뉴스 질문이면 주제어별 기사를 장부에 보탭니다. 올린 항목들을 돌려주고, 대상이 아니거나 하나도 못 찾으면 빈 배열.
 * 이미 장부에 있는 기사(같은 주소)는 다시 올리지 않습니다. 주제어마다 실패해도 나머지는 이어 갑니다.
 */
export async function addMacroNews(ctx: ResearchContext, question: string, news: NewsFetch = fetchNews as NewsFetch): Promise<Evidence[]> {
  if (!isGeneralNewsQuestion(question)) return [];
  const started = Date.now();
  const results = await Promise.all(MACRO_TOPICS.map((query) => news({ sources: ["yonhap", "hankyung"], query, limit: PER_TOPIC, content: "list" }).catch(() => null)));
  const seen = new Set(ctx.evidence.map((e) => e.source.url));
  const picked: NewsData["articles"] = [];
  // 주제마다 한 건씩 번갈아 골라 한 주제로 쏠리지 않게 합니다
  for (let k = 0; k < PER_TOPIC && picked.length < MAX_ARTICLES; k += 1) {
    for (const r of results) {
      const article = r?.data.articles[k];
      if (!article || seen.has(article.url) || picked.length >= MAX_ARTICLES) continue;
      seen.add(article.url);
      picked.push(article);
    }
  }
  if (picked.length === 0) return [];
  const call = ctx.nextCallId();
  const entries: Evidence[] = picked.map((article, k) => ({
    id: `${call}-${k + 1}`,
    tool: areaTools.news,
    label: `${labelFor(areaTools.news)} · ${article.publisher}`,
    values: { title: article.title, publisher: article.publisher, publishedAt: article.publishedAt, body: "not_requested" },
    source: { name: article.publisher, url: article.url, asOf: article.publishedAt.slice(0, 10) },
    note: "경제 흐름 주제어(증시 · 환율 · 금리 · 물가 · 수출)로 제목을 찾은 기사입니다. 제목만 확인했고 본문은 받지 않았습니다.",
  }));
  ctx.addEvidence(entries);
  ctx.addStep({ tool: areaTools.news, status: "ok", ms: Date.now() - started });
  return entries;
}

/** 작성 입력에 붙이는 [경제 뉴스 고르기]. 보탠 기사의 번호와 제목을 직접 적어, 정제가 뺐더라도 작성이 쓸 수 있게 합니다 */
export function macroNewsNote(entries: Evidence[]): string {
  if (entries.length === 0) return "";
  return [
    `[경제 뉴스 고르기] 주제를 정하지 않은 경제 뉴스 질문입니다. 아래는 증시 · 환율 · 금리 · 물가 · 수출 주제어로 찾은 기사입니다 (제목만 확인).`,
    ...entries.map((e) => `- ${e.id} · ${e.source.name} · ${e.values.title}`),
    `요약과 본문은 이 기사들처럼 경제 흐름을 다룬 기사를 먼저 쓰고, 여러 기사가 같은 일을 다루면 묶어서 씁니다.`,
    `상품 출시 · 할인 · 품절 · 행사 · 인사 · 수상 기사는 경제 뉴스 요약에 쓰지 않습니다. 제목에 없는 내용은 덧붙이지 않습니다.`,
  ].join("\n");
}
