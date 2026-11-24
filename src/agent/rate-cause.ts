/**
 * 한국 기준금리 원인 질문의 한국은행 통화정책방향 (리더, 11/24).
 *
 * 11/24 운영: "한국 기준금리는 왜 동결됐어?" 가 한 번은 한국은행 통화정책방향 본문으로 이유를 답했지만(#163 확인), 다음에는 조사가 검색어를
 * "기준금리 동결" 로 골라 한국은행 문서("기준금리를 … 유지")가 걸리지 않고 Google 제목만 받아 "왜 동결됐는지는 확인된 자료만으로 설명하기 어려워요" 로 시작했습니다.
 * 금리 결정의 이유는 금융통화위원회 통화정책방향에 본문으로 있으니, 한국 기준금리 원인 질문이면 코드가 뉴스 tool 로 그 문서를 받습니다.
 * 장부에는 기사 제목만 오르므로(본문은 tool 의 전체 응답에만 있음) 본문 앞부분을 작성에 [한국은행 통화정책방향] 으로 알려 줍니다.
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import type { Evidence, Intent } from "./schema";
import type { InvokableTool } from "./supplement";

const STATEMENT = /통화정책방향/;
const NOTE_CHARS = 1_500;

/** 한국 기준금리의 원인 · 배경을 묻는 질문인지 (다른 나라 금리 · 예적금 · 대출 금리는 아님) */
export function isKoreanRateCause(question: string, intent: Intent | undefined): boolean {
  if (intent !== "cause") return false;
  if (!/기준\s*금리|금리|금통위|한은|한국은행/.test(question)) return false;
  if (/환율|달러|코스피|주가/.test(question)) return false;
  if (/미국|연준|\bFed\b|FOMC|일본|유럽|ECB|영국|중국/i.test(question) && !/한국|우리나라|한은|한국은행|금통위/.test(question)) return false;
  return !/예금|적금|대출|주담대|채권|국채|시장\s*금리/.test(question);
}

const isStatement = (e: Evidence) => e.tool === areaTools.news && e.values.publisher === "한국은행" && STATEMENT.test(String(e.values.title ?? ""));

/** 가장 최근 통화정책방향 장부 항목 */
export function latestStatement(evidence: Evidence[]): Evidence | undefined {
  return evidence.filter(isStatement).sort((a, b) => String(b.values.publishedAt).localeCompare(String(a.values.publishedAt)))[0];
}

/** 통화정책방향이 장부에 없으면 뉴스 tool 로 받습니다 (한국은행 보도자료 · 본문). 받은(또는 있던) 항목 id, 대상이 아니거나 못 받으면 null. 실패해도 던지지 않습니다 */
export async function ensureRateStatement(ctx: ResearchContext, question: string, intent: Intent | undefined, tools: readonly InvokableTool[]): Promise<string | null> {
  if (!isKoreanRateCause(question, intent)) return null;
  if (!latestStatement(ctx.evidence)) {
    const news = tools.find((t) => t.name === areaTools.news);
    if (!news) return null;
    await news.invoke(new RunContext(ctx), JSON.stringify({ sources: ["bok"], query: "통화정책방향", limit: 2, content: "body" })).catch(() => undefined);
  }
  return latestStatement(ctx.evidence)?.id ?? null;
}

/** 그 항목의 본문 (tool 의 전체 응답에서 같은 주소의 기사) */
function bodyOf(e: Evidence, raw: unknown): string {
  const articles = (raw as { articles?: { url?: string; body?: { status?: string; text?: string } }[] } | undefined)?.articles ?? [];
  const article = articles.find((a) => a.url === e.source.url);
  return article?.body?.status === "available" ? String(article.body.text ?? "") : "";
}

/** 작성 입력에 붙이는 [한국은행 통화정책방향]. 본문이 없으면 빈 문자열 */
export function rateStatementNote(evidence: Evidence[], id: string | null, raw: ReadonlyMap<string, unknown>): string {
  const e = id ? evidence.find((x) => x.id === id) : undefined;
  if (!e) return "";
  const body = bodyOf(e, raw.get(e.id)).replace(/\s+/g, " ").trim();
  if (!body) return "";
  return [
    `[한국은행 통화정책방향] 금융통화위원회의 기준금리 결정 이유가 담긴 한국은행 문서입니다: ${e.values.title} (ref ${e.id}, ${String(e.values.publishedAt).slice(0, 10)})`,
    `본문 앞부분: "${body.slice(0, NOTE_CHARS)}${body.length > NOTE_CHARS ? " …" : ""}"`,
    `기준금리를 왜 올리거나 내리거나 유지했는지는 이 문서의 설명으로 답합니다. 요약 첫 문장에 결정과 그 이유를 쓰고, why 에는 basis "news" 로 "한국은행은 … 라고 설명했어요" 처럼 이 문서가 든 이유를 씁니다 (ref ${e.id}).`,
    `이 문서에 없는 이유를 덧붙이지 않습니다. 본문의 숫자는 장부에 있는 값과 같을 때만 씁니다. 문서의 날짜(결정일)를 함께 밝힙니다.`,
  ].join("\n");
}
