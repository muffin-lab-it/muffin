/**
 * 한국 기준금리 원인 질문의 한국은행 통화정책방향 (리더, 11/24).
 *
 * 11/24 운영: "한국 기준금리는 왜 동결됐어?" 가 한 번은 한국은행 통화정책방향 본문으로 이유를 답했지만(#163 확인), 다음에는 조사가 검색어를
 * "기준금리 동결" 로 골라 한국은행 문서("기준금리를 … 유지")가 걸리지 않고 Google 제목만 받아 "왜 동결됐는지는 확인된 자료만으로 설명하기 어려워요" 로 시작했습니다.
 * 금리 결정의 이유는 금융통화위원회 통화정책방향에 본문으로 있으니, 한국 기준금리 원인 질문이면 코드가 뉴스 tool 로 그 문서를 받습니다.
 * 장부에는 기사 제목만 오르므로(본문은 tool 의 전체 응답에만 있음) 본문 앞부분을 작성에 [한국은행 통화정책방향] 으로 알려 줍니다.
 * 고르는 문서는 질문이 말한 결정(올림 · 내림 · 동결)과 때에 맞는 것만입니다 ("8월에 왜 올렸어?" 에 10월 동결 문서의 이유를 쓰지 않게, #165 Codex 리뷰).
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { NEGATIVE } from "./negatives";
import { areaTools } from "./plan";
import { todayKst } from "./today";
import type { Evidence, Intent, WriterOutput } from "./schema";
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

export type Decision = "인상" | "인하" | "동결";
const DECISION_WORDS: [Decision, RegExp][] = [
  ["인상", /올렸|올린|올려|올리|올랐|인상|상향/],
  ["인하", /내렸|내린|내려|내리|낮췄|낮춘|인하|하향/],
  ["동결", /동결|유지|묶|멈췄|멈춘/],
];

/** 질문이 묻는 결정 (말이 하나만 있을 때만. "올리지 않고 동결" 처럼 섞이면 null) */
export function askedDecision(question: string): Decision | null {
  const text = question.replace(/결정을?\s*내[렸린려리]/g, "");
  const found = DECISION_WORDS.filter(([, re]) => re.test(text)).map(([d]) => d);
  return found.length === 1 ? found[0]! : null;
}

/** 질문이 묻는 때 ("2026년 8월", "8월") */
export function askedMonth(question: string): { year?: number; month?: number } | null {
  const year = /(20\d{2})\s*년/.exec(question)?.[1];
  const month = /(?<!\d)(1[0-2]|0?[1-9])\s*월/.exec(question)?.[1];
  if (!year && !month) return null;
  return { ...(year ? { year: Number(year) } : {}), ...(month ? { month: Number(month) } : {}) };
}

/** 문서 첫 문장의 결정 ("… 3.00% 수준에서 유지하여", "… 3.00%로 상향 조정하여") */
export function statementDecision(body: string): Decision | null {
  const end = body.indexOf("하였다");
  const first = body.slice(0, end > 0 ? end : 300);
  if (/상향\s*조정|인상하/.test(first)) return "인상";
  if (/하향\s*조정|인하하/.test(first)) return "인하";
  if (/유지/.test(first)) return "동결";
  return null;
}

/** 결정일 (제목 "통화정책방향(2026.8.27)", 없으면 게시 시각의 한국 날짜) YYYY-MM-DD */
function statementDate(e: Evidence): string {
  const m = /\((\d{4})\.(\d{1,2})\.(\d{1,2})\)/.exec(String(e.values.title ?? ""));
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  const time = Date.parse(String(e.values.publishedAt ?? ""));
  return Number.isNaN(time) ? "" : new Date(time + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 그 항목의 본문 (tool 의 전체 응답에서 같은 주소의 기사) */
function bodyOf(e: Evidence, raw: unknown): string {
  const articles = (raw as { articles?: { url?: string; body?: { status?: string; text?: string } }[] } | undefined)?.articles ?? [];
  const article = articles.find((a) => a.url === e.source.url);
  return article?.body?.status === "available" ? String(article.body.text ?? "").replace(/\s+/g, " ").trim() : "";
}

/**
 * 질문에 맞는 통화정책방향: 본문이 있는 것 중 질문이 말한 결정(올림 · 내림 · 동결)과 때(연 · 월)가 맞는 가장 최근 문서 (#165 Codex 리뷰).
 * 제목만 받은 항목(content "list")은 고르지 않습니다. 맞는 문서가 없으면 undefined (작성에 다른 결정의 이유를 강제하지 않음)
 */
export function pickStatement(evidence: Evidence[], raw: ReadonlyMap<string, unknown>, question: string): Evidence | undefined {
  const decision = askedDecision(question);
  const when = askedMonth(question);
  return evidence
    .filter(isStatement)
    .map((e) => ({ e, body: bodyOf(e, raw.get(e.id)), date: statementDate(e) }))
    .filter(({ body, date }) => {
      if (!body) return false;
      if (decision && statementDecision(body) !== decision) return false;
      if (when?.year && !date.startsWith(String(when.year))) return false;
      if (when?.month && Number(date.slice(5, 7)) !== when.month) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.e.values.publishedAt).localeCompare(String(a.e.values.publishedAt)))[0]?.e;
}

/** 고른 통화정책방향과, 이번 실행이 새로 받은 한국은행 보도자료 제목 목록의 가장 최근 문서 (확인하지 못했으면 null) */
export type RateStatement = { id: string; newestId: string | null };

/** 뉴스 tool 을 한 번 부르고 그때 오른 장부 항목과, 저장된 응답이 아닌 새 응답이었는지 */
async function invokeNews(ctx: ResearchContext, news: InvokableTool, input: object): Promise<{ added: Evidence[]; fresh: boolean }> {
  const evidenceBefore = ctx.evidence.length;
  const stepsBefore = ctx.steps.length;
  await news.invoke(new RunContext(ctx), JSON.stringify(input)).catch(() => undefined);
  const steps = ctx.steps.slice(stepsBefore).filter((s) => s.tool === areaTools.news);
  return { added: ctx.evidence.slice(evidenceBefore), fresh: steps.length > 0 && steps.every((s) => s.status === "ok" && s.fallbackAgeMs === undefined) };
}

/**
 * 한국 기준금리 원인 질문이면 한국은행 보도자료를 "통화정책방향" 으로 받습니다.
 *  - 가장 최근 결정: 제목 목록 1건 (결과는 최근 순, 본문 유무와 상관없이 첫 문서). 본문을 청하면 첨부파일뿐인 최신 문서가 빠지고 그 앞 문서가 첫째가 되므로 따로 부릅니다.
 *    조사가 받아 둔 문서만으로는 그보다 최근 결정이 있는지 모르고, 조회가 실패해 저장된 응답을 썼으면 그 뒤 결정이 빠졌을 수 있어 새 응답일 때만 확인한 것으로 봅니다 (#167 Codex 리뷰).
 *  - 질문에 맞는 문서(본문 있는 것)가 장부에 없으면 본문으로 2건 (때를 물으면 지난 문서까지 닿도록 4건).
 * 고른 항목 id 와 확인한 가장 최근 문서 id, 대상이 아니거나 맞는 문서가 없으면 null. 실패해도 던지지 않습니다
 */
export async function ensureRateStatement(ctx: ResearchContext, question: string, intent: Intent | undefined, tools: readonly InvokableTool[]): Promise<RateStatement | null> {
  if (!isKoreanRateCause(question, intent)) return null;
  let newestId: string | null = null;
  const news = tools.find((t) => t.name === areaTools.news);
  if (news) {
    const recent = await invokeNews(ctx, news, { sources: ["bok"], query: "통화정책방향", limit: 1, content: "list" });
    if (recent.fresh) newestId = newestStatement(recent.added)?.id ?? null;
    if (!pickStatement(ctx.evidence, ctx.raw, question)) {
      await invokeNews(ctx, news, { sources: ["bok"], query: "통화정책방향", limit: askedMonth(question) ? 4 : 2, content: "body" });
    }
  }
  const picked = pickStatement(ctx.evidence, ctx.raw, question);
  return picked ? { id: picked.id, newestId } : null;
}

/** 그 문서(같은 주소)의 본문이 장부의 어느 항목에든 있는지 */
function hasBody(evidence: Evidence[], raw: ReadonlyMap<string, unknown>, e: Evidence): boolean {
  return evidence.some((x) => isStatement(x) && x.source.url === e.source.url && bodyOf(x, raw.get(x.id)) !== "");
}

/**
 * 가장 최근 결정을 확인했고 그 결정의 설명(본문)도 받았는지. 이때만 "더 최근 결정은 확인되지 않았어요" 문장을 정리합니다
 * (최신 문서가 첨부파일뿐이면 그 결정의 이유가 정말 빠진 것이라 그 한계 문장은 남김, #167 Codex 리뷰)
 */
export function explainsLatest(evidence: Evidence[], raw: ReadonlyMap<string, unknown>, statement: RateStatement | null): boolean {
  const newest = statement?.newestId ? evidence.find((x) => x.id === statement.newestId) : undefined;
  return !!newest && hasBody(evidence, raw, newest);
}

const DECISION_TEXT: Record<Decision, string> = { 인상: "기준금리 인상", 인하: "기준금리 인하", 동결: "기준금리 유지(동결)" };

/**
 * 작성 입력에 붙이는 [한국은행 통화정책방향]. 본문이 없으면 빈 문자열.
 * 장부의 통화정책방향 중 가장 최근 문서면 그렇다고 알립니다 (11/25 운영: 4번 중 2번이 요약 끝에 "2026-11-25 현재 가장 최근 결정문은 확인되지 않아,
 * 이 설명은 2026-10-22 결정에 해당해요" 를 붙임. 한국은행 보도자료를 이번 실행에서 받았으니 더 최근 결정이 있었다면 그 문서가 잡혔을 것)
 */
export function rateStatementNote(evidence: Evidence[], statement: RateStatement | null, raw: ReadonlyMap<string, unknown>): string {
  const e = statement ? evidence.find((x) => x.id === statement.id) : undefined;
  if (!e) return "";
  const body = bodyOf(e, raw.get(e.id));
  if (!body) return "";
  const decision = statementDecision(body);
  const date = statementDate(e);
  const newest = statement?.newestId ? evidence.find((x) => x.id === statement.newestId) : undefined;
  // 가장 최근 결정을 확인하지 못했으면(조회 실패 · 저장된 응답) 알리지 않습니다 (장부의 문서만으로는 더 최근 결정이 있는지 모름)
  const newestLine = !newest
    ? ""
    : statementDate(newest) <= date
      ? `이번에 받은 한국은행 보도자료에는 이보다 최근 통화정책방향이 없습니다. 이 문서가 가장 최근 기준금리 결정이니 "오늘 · 최근 결정은 확인되지 않았다", "이 설명은 ${date} 결정에 해당한다" 같은 문장은 쓰지 않습니다.`
      : hasBody(evidence, raw, newest)
        ? `이번에 받은 한국은행 보도자료에서 가장 최근 통화정책방향은 ${newest.values.title} (ref ${newest.id}, ${statementDate(newest)}) 이고, 그보다 최근 결정문은 없습니다. 오늘 · 최근 결정이 확인되지 않았다는 문장은 쓰지 않습니다.`
        : `이번에 받은 한국은행 보도자료에서 가장 최근 통화정책방향은 ${newest.values.title} (ref ${newest.id}, ${statementDate(newest)}) 입니다. 그 문서는 본문 없이 제목만 받아 그 결정의 이유는 확인되지 않았습니다.`;
  return [
    `[한국은행 통화정책방향] 금융통화위원회의 기준금리 결정 이유가 담긴 한국은행 문서입니다: ${e.values.title} (ref ${e.id}, ${date}${decision ? `, 결정: ${DECISION_TEXT[decision]}` : ""})`,
    `본문 앞부분: "${body.slice(0, NOTE_CHARS)}${body.length > NOTE_CHARS ? " …" : ""}"`,
    `기준금리를 왜 올리거나 내리거나 유지했는지는 이 문서의 설명으로 답합니다. 요약 첫 문장에 결정과 그 이유를 쓰고, why 에는 basis "news" 로 "한국은행은 … 라고 설명했어요" 처럼 이 문서가 든 이유를 씁니다 (ref ${e.id}).`,
    `이 문서에 없는 이유를 덧붙이지 않습니다. 본문의 숫자는 장부에 있는 값과 같을 때만 씁니다. 문서의 날짜(결정일)를 함께 밝힙니다.`,
    ...(newestLine ? [newestLine] : []),
  ].join("\n");
}

/** 장부의 통화정책방향 중 결정일이 가장 늦은 문서 */
function newestStatement(evidence: Evidence[]): Evidence | undefined {
  return evidence.filter(isStatement).sort((a, b) => statementDate(b).localeCompare(statementDate(a)))[0];
}

/**
 * 더 최근 결정이 있는지 모른다는 문장: 최근 · 이후 · 추가 · 후속 · 당일(또는 오늘 날짜)이 결정 · 인상 · 인하 · 동결 · 금통위와 가까이 있고
 * 확인 못 함 · 자료 없음으로 끝나는 것 ("2026-11-25 시점의 더 최근 금통위 결정문이나 추가 설명은 확인되지 않아 …", "2026-11-25 기준 추가 인상 여부와 그 이유는
 * 확인되지 않았어요", "인상 이후의 추가 설명이나 후속 배경은 확인되지 않았어요", 11/25 로컬). 결정의 영향 · 전망 · 다음 결정 이야기
 * ("오늘 금통위 결정이 향후 물가에 미칠 영향은 확인할 수 없어요"), 확인된 내용이 함께 든 문장(날짜 밖의 숫자, "…지만"), 한국은행 기준금리가 아닌 대상
 * ("최근 미국의 금리 인하 이유는 확인되지 않았어요", "최근 대출 금리 인상 이유는 …")은 남깁니다 (#167 · #169 Codex 리뷰)
 */
const HINT = String.raw`(?:최근|최신|새로운?|새\s|당일|이후|그\s*뒤|추가|후속)`;
const TOPIC = String.raw`(?:결정|금통위|통화정책방향|인상|인하|동결)`;
const NEAR = new RegExp(`${HINT}[^.!?]{0,25}?${TOPIC}|${TOPIC}[^.!?]{0,25}?${HINT}`);
const OUTCOME = /영향|전망|움직|향후|앞으로|다음|방향성|경로|시점|가능성|변화|반응|효과/;
const MISSING = new RegExp(`${NEGATIVE.source}|확보하지\\s*못|자료(?:가|는|도)\\s*없`);
const MIXED = /지만|으나|는데|했고|됐고|였고/;
/** 한국은행 기준금리 결정이 아닌 대상 (다른 나라 중앙은행 · 예적금 · 대출 · 시장금리). 이 한계는 한국은행 문서로 풀리지 않아 남깁니다 (#169 Codex 리뷰) */
const OTHER_SUBJECT = /미국|연준|\bFed\b|FOMC|일본|일본은행|\bBOJ\b|유럽|\bECB\b|영국|중국|해외|주요국|다른\s*나라|예금|적금|대출|주담대|시장\s*금리|국채|채권|회사채/i;
/** 결정일만 되짚는 문장 ("이 설명은 2026-10-22 결정문에 담겼어요", "동결 사유는 한국은행의 2026-10-22 결정 설명에 해당해요", "확인된 보도자료는 2026-10-22 결정분이에요") */
const SCOPE_ONLY = /결정[^.!?]{0,20}?\s*(?:해당해요|해당합니다|담겼어요|담긴\s*설명이에요|관한\s*내용이에요|대한\s*설명이에요|분이에요|분입니다)[.!?]?$/;
const DATE = /\d{4}-\d{2}-\d{2}/g;
/** 날짜에 붙은 "시점 · 기준 · 현재" ("2026-11-25 시점의") 는 앞날 이야기가 아님 */
const DATE_SCOPE = /\d{4}-\d{2}-\d{2}\s*(?:시점|기준|현재)?(?:의|으로|에서|에)?/g;

function isNewerTalk(sentence: string, today: string): boolean {
  const s = sentence.trim();
  if (/\d/.test(s.replace(DATE, "")) || MIXED.test(s) || OTHER_SUBJECT.test(s) || OUTCOME.test(s.replace(DATE_SCOPE, ""))) return false;
  if (SCOPE_ONLY.test(s)) return true;
  return MISSING.test(s) && (NEAR.test(s) || new RegExp(`${today}[^.!?]{0,25}?${TOPIC}`).test(s));
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).filter((x) => x.trim());

/**
 * 이번 실행이 새로 받은 한국은행 보도자료로 가장 최근 결정과 그 설명을 확인했으면(muffin.ts 가 explainsLatest 일 때만 부름), 더 최근 결정이 있을지 모른다는 문장과 결정일만 되짚는 문장을 요약 · 주의점 · 확인하지 못한 것에서 뺍니다 (11/25 운영 · 로컬:
 * 작성 메모로 막아도 "다만 2026-11-25 현재 가장 최근의 금리 결정 여부와 그 이유는 확인하지 못했어요" 가 요약 끝이나 주의점 · 확인하지 못한 것으로 옮겨 남음).
 * 더 최근 결정이 있었다면 그 조회에 잡혔습니다. 요약이 그 문장뿐이면 그대로 둡니다
 */
export function dropNewerDecisionTalk<T extends Pick<WriterOutput, "summary" | "caveats" | "dataGaps">>(output: T, today = todayKst()): T {
  const newerTalk = (x: string) => isNewerTalk(x, today);
  const sentences = sentencesOf(output.summary);
  const kept = sentences.filter((x) => !newerTalk(x));
  const summary = kept.length > 0 && kept.length < sentences.length ? kept.join(" ") : output.summary;
  const lines = (list: string[]) =>
    list.map((l) => (sentencesOf(l).some(newerTalk) ? sentencesOf(l).filter((x) => !newerTalk(x)).join(" ") : l)).filter((l) => l.trim().length > 0);
  const caveats = lines(output.caveats);
  const dataGaps = lines(output.dataGaps);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (summary === output.summary && same(caveats, output.caveats) && same(dataGaps, output.dataGaps)) return output;
  return { ...output, summary, caveats, dataGaps };
}
