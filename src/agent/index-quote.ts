/**
 * 지수 질문의 지수 값 (리더, 11/21).
 *
 * 11/20 베타: "요즘 코스피 어때?" 가 뉴스만 불러, 기사에는 지수가 있는데 "오늘의 숫자" 는 비어 있었습니다. 두 가지를 코드가 보장합니다.
 *  1. 공식 종가: 질문이 지수를 물으면 지수 tool(국내 src/tools/kr-index, 미국 src/tools/us-index)을 직접 불러 장부에 올립니다. 공개가 늦어 직전 거래일 종가입니다.
 *  2. 당일 종가: 공식 자료보다 뒤에 나온 기사 본문에 "전장보다 267.93포인트(5.21%) 내린 4,869.96" 이 있고, 공식 전일 종가 + 변화폭이 그 종가와 맞으면
 *     (검산) 계산 항목(C 번호)으로 장부에 올립니다. 기사 숫자는 검증된 값이 아니라서 장부에 넣지 않는 것이 원칙이고(뉴스 tool), 공식 값으로 검산되는 이 숫자만 예외입니다.
 * 작성에는 [지수 값] 으로 알려 주고, 작성이 숫자 칸을 비우면 코드가 채웁니다. 두 값은 기준일과 이름("공식 자료" · "기사 보도")으로 구분합니다.
 */
import { RunContext } from "@openai/agents";
import { execute as fetchNews, type NewsData } from "../tools/news";
import { krIndexTool, type KrIndexName } from "../tools/kr-index";
import { US_INDEXES, usIndexTool, type UsIndexName } from "../tools/us-index";
import type { ResearchContext } from "./context";
import type { Evidence, WriterOutput } from "./schema";
import type { InvokableTool } from "./supplement";
import { questionPeriod } from "./news-topics";
import { todayKst } from "./today";

export const INDEX_TOOL = "get_kr_stock_index";
export const US_INDEX_TOOL = "get_us_stock_index";
/** 질문이 물을 수 있는 지수. 국내는 금융위 지수시세정보, 미국은 FRED 에서 받습니다 */
export type IndexName = KrIndexName | UsIndexName;
export const isUs = (index: IndexName): index is UsIndexName => (US_INDEXES as readonly string[]).includes(index);
export const INDEX_TODAY_TOOL = "calc_index_today";

export const INDEX_WORDS: [RegExp, IndexName][] = [
  [/코스피\s*200|KOSPI\s*200/i, "코스피 200"],
  [/코스닥\s*150|KOSDAQ\s*150/i, "코스닥 150"],
  // 뒤에 다른 숫자가 붙은 세부 지수(코스피100 · 코스닥 50)는 종합지수가 아니라 조회하지 않습니다 (#123 Codex 리뷰)
  [/(코스피|KOSPI)(?!\s*\d)/i, "코스피"],
  [/(코스닥|KOSDAQ)(?!\s*\d)/i, "코스닥"],
  [/S\s*&\s*P(?:\s*500)?(?!\s*\d)|에스앤피|SNP\s*500/i, "S&P 500"],
  [/(나스닥|NASDAQ)\s*100/i, "나스닥 100"],
  [/(나스닥|NASDAQ)(?!\s*\d)/i, "나스닥 종합"],
  [/다우\s*존스|다우\s*지수|다우(?=$|[\s은는이가도?!,.])|\bDJIA\b|\bDow\b/i, "다우존스"],
];
/** ETF 를 묻는 질문의 낱말. 있으면 지수가 아니라 그 ETF 가 주제라 조사에 맡깁니다 */
// 한글 · 예전 브랜드 표기도 봅니다 ("라이즈 코스피", src/tools/etf/names.ts 의 별칭과 같은 범위, #123 Codex 리뷰). 잘못 걸리면 조사에 맡길 뿐이라 넓게 잡습니다
const ETF_SUBJECT =
  /ETF|이티에프|KODEX|코덱스|TIGER|타이거|RISE|라이즈|KBSTAR|케이비스타|ACE|에이스|KINDEX|킨덱스|PLUS|플러스|ARIRANG|아리랑|SOL|쏠|KIWOOM|키움|KOSEF|코세프|HANARO|하나로|1Q|원큐|KOACT|코액트|TIMEFOLIO|타임폴리오|마이티|파워|\d{6}/i;

/** 질문이 물은 국내 지수. 지수 질문이 아니거나 ETF 를 묻는 질문이면 null. 여러 지수를 말하면 먼저 나온 것 */
/**
 * 지수 이름이 있어도 현물 지수 값으로 답할 수 없는 질문: 선물 · 옵션 같은 파생상품, 뜻 · 구성 · 산출 방식을 묻는 개념 질문.
 * "나스닥 선물 시세 알려줘" 에 현물 지수를 대신 보여 주면 묻지 않은 것을 답하게 됩니다 (#128 Codex 리뷰)
 */
const NOT_SPOT_INDEX = /선물|옵션|파생|ETN|레버리지|인버스|VIX|변동성\s*지수|뭐야|뭔가요|무슨\s*뜻|뜻이|뜻인|구성\s*종목|산출|계산/i;

export function indexFor(question: string): IndexName | null {
  return indexesFor(question)[0] ?? null;
}

/** 한 질문에서 받는 지수 수의 상한 */
export const MAX_INDEXES = 3;

/**
 * 질문이 물은 지수 모두 (나온 순서, 최대 3개). 지수 질문이 아니거나 ETF 를 묻는 질문이면 빈 배열.
 * 11/26 운영: "오늘 코스피랑 코스닥 왜이렇게 떨어지지 코스피랑 코스닥 일주일 추세 좀 알려줘" 에 먼저 나온 코스피만 받아 코스닥이 빠짐 (mwwu02ns-uzqmor)
 */
export function indexesFor(question: string): IndexName[] {
  if (ETF_SUBJECT.test(question) || NOT_SPOT_INDEX.test(question)) return [];
  const hits = INDEX_WORDS.map(([re, name]) => ({ name, at: question.search(re) })).filter((h) => h.at >= 0);
  // "코스피 200" 은 "코스피" 패턴에 걸리지 않으므로(뒤에 숫자) 위치만 비교하면 됩니다
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name).slice(0, MAX_INDEXES);
}

/**
 * 질문의 기간 → 지수 조회 계획. 지수 tool 은 늘 최신 기준일에서 거꾸로 days 만큼과 비교합니다 (#178 Codex 리뷰).
 *  - '일주일 · 최근 7일' 7일, '한 달' · 말 없음 30일
 *  - '이번 주': 기준일을 안 뒤 "지난 일요일까지" 로 다시 받아 월요일 앞 마지막 거래일 종가와 비교 (ensureOne)
 *  - '지난주': 기준일이 늘 최신이라 지난주만 떼어 받을 수 없음 → 기본 기간으로 받고 작성에 '지난주' 라고 부르지 않게 알림
 */
export type IndexCalendar = "this_week" | "last_week" | null;
export function indexPlan(question: string): { days: number; calendar: IndexCalendar } {
  const period = questionPeriod(question);
  if (period === "7d") return { days: 7, calendar: null };
  if (period === "this_week") return { days: 7, calendar: "this_week" };
  if (period === "last_week") return { days: 30, calendar: "last_week" };
  return { days: 30, calendar: null };
}
export const indexDays = (question: string) => indexPlan(question).days;

const DAY_MS = 86_400_000;
/** 이번 주를 지수 tool 의 days 로: 기준일에서 지난 일요일까지의 달력 일수 (그 앞 마지막 거래일과 비교됨). 기준일이 이번 주가 아니면 null */
export function thisWeekDays(latestDate: string, today: string = todayKst()): number | null {
  const t = Date.parse(`${today}T00:00:00Z`);
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
  const latest = Date.parse(`${latestDate}T00:00:00Z`);
  if (Number.isNaN(latest) || latest < monday) return null;
  return Math.round((latest - (monday - DAY_MS)) / DAY_MS);
}

/** 이번 주 들어 비교가 맞는지: 비교 시작일이 이번 주 월요일 앞이고 기준일이 월요일 이후. 휴장으로 시작일이 금요일보다 앞이어도 맞습니다 (#178 Codex 리뷰) */
export function isWeekToDate(e: Evidence, today: string = todayKst()): boolean {
  const t = Date.parse(`${today}T00:00:00Z`);
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
  const from = Date.parse(`${String(e.values["period.from"])}T00:00:00Z`);
  const to = Date.parse(`${String(e.values["period.to"])}T00:00:00Z`);
  // 월요일 앞 마지막 거래일은 금요일(휴장이면 목 · 수요일)입니다. 그보다 앞이면 이번 주 비교가 아니라 다른 기간 자료입니다 (#178 Codex 리뷰)
  return from < monday && from >= monday - 5 * DAY_MS && to >= monday;
}

/** 받은 지수와 그 기간 (작성 · 카드 · 차트가 같은 항목을 고르도록) */
export type IndexPick = { index: IndexName; days: number; calendar: IndexCalendar | "this_week_empty" };

/** 공식 지수 항목의 비교 기간(달력 일수) */
const spanDays = (e: Evidence) => Math.round((Date.parse(String(e.values["period.to"])) - Date.parse(String(e.values["period.from"]))) / 86_400_000);

/** 장부의 공식 지수 항목 */
export function officialIndex(evidence: Evidence[], index: IndexName, days = 30): Evidence | undefined {
  // 같은 지수를 여러 기간으로 받았으면(관계 질문 · Deep 의 1년, 질문의 일주일) 비교 기간이 days 에 가장 가까운 것을 씁니다.
  // 마지막에 받은 것을 쓰면 Deep 이 뒤에 받은 1년 자료가 짧은 기간 자료를 대신합니다 (#178 Codex 리뷰)
  const found = evidence.filter((e) => (e.tool === INDEX_TOOL || e.tool === US_INDEX_TOOL) && e.values.index === index && typeof e.values["latest.close"] === "number");
  return found.reduce<Evidence | undefined>((best, e) => (!best || Math.abs(spanDays(e) - days) < Math.abs(spanDays(best) - days) ? e : best), undefined);
}
/** 장부의 당일 종가 항목 (기사 보도 · 검산) */
export function todayIndex(evidence: Evidence[], index: IndexName): Evidence | undefined {
  return evidence.find((e) => e.tool === INDEX_TODAY_TOOL && e.values.index === index);
}

export type TodayClose = { close: number; change: number; changePct: number };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
const num = (s: string) => Number(s.replace(/,/g, ""));

/**
 * 기사 본문에서 그 지수의 마감 문장을 읽습니다: "코스피는 전장보다 267.93포인트(5.21%) 내린 4,869.96에 거래를 마쳤다",
 * "코스닥은 전일 대비 39.13포인트(5.71%)내린 645.68에 장을 마쳤다". 변화는 방향을 붙여 돌려줍니다. 마감 문장이 아니면 null.
 */
export function parseClose(text: string, index: KrIndexName): TodayClose | null {
  const hit = closeMatch(text, index);
  return hit ? { close: hit.close, change: hit.change, changePct: hit.changePct } : null;
}

/** parseClose 와 같되, 그 문장에서 지수 이름 앞에 온 말(lead)도 돌려줍니다. "전날 코스피는…" 처럼 다른 날의 마감을 다시 쓴 문장을 가리는 데 씁니다 */
function closeMatch(text: string, index: KrIndexName): (TodayClose & { lead: string }) | null {
  const re = new RegExp(
    `${escapeRe(index)}(?:\\s*지수)?[은는이가]?\\s*(?:전장|전\\s*거래일|전일)\\s*(?:보다|대비)\\s*([\\d,]+\\.\\d+)\\s*포인트\\s*\\(\\s*([\\d.]+)\\s*%\\s*\\)\\s*(내린|하락한|떨어진|밀린|오른|상승한|뛴)\\s*([\\d,]+\\.\\d+)`,
  );
  const m = re.exec(text);
  if (!m) return null;
  // 마감 값만 받습니다. 개장 · 장중 기사("5,147.89에 출발했다")도 전일 종가 + 변화폭 검산은 통과하므로, 같은 문장에 마감 표현이 있어야 합니다 (#123 Codex 리뷰)
  const rest = text.slice(m.index + m[0].length).split(/(?<!\d)\.(?!\d)|\n/)[0] ?? "";
  if (/^.{0,12}(출발|개장|장중|거래되|거래\s*중|기록\s*중)/.test(rest) || !/마쳤|마감|마친/.test(rest)) return null;
  const sign = /내린|하락한|떨어진|밀린/.test(m[3]!) ? -1 : 1;
  const lead = text.slice(0, m.index).split(/(?<!\d)\.(?!\d)|\n/).at(-1) ?? "";
  return { close: num(m[4]!), change: sign * num(m[1]!), changePct: sign * Number(m[2]), lead };
}

/** 검산: 공식 전일 종가 + 기사의 변화폭이 기사의 종가와 맞는지 (반올림 오차 0.02 포인트), 등락률이 그 변화폭과 맞는지 */
export function consistent(prevClose: number, today: TodayClose): boolean {
  // 등락률도 변화폭 ÷ 전일 종가와 맞아야 합니다 (기사 표기는 소수 둘째 자리 반올림). 맞지 않는 % 가 장부에 올라 카드로 나가지 않게 (#123 Codex 리뷰)
  return Math.abs(prevClose + today.change - today.close) <= 0.02 && Math.abs((today.change / prevClose) * 100 - today.changePct) <= 0.011;
}

const kstDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(iso));

/**
 * 기사가 말하는 거래일. 발행일이 아니라 본문의 "20일 코스피는…" 에서 읽습니다: 다음 날 아침 · 주말에 나온 기사가 전 거래일 마감을 다시 쓰면
 * 발행일을 종가 날짜로 적으면 틀립니다 (#123 Codex 리뷰). 본문의 날짜("N일")가 발행일이나 그 전 나흘 안의 날과 맞을 때만 그 날짜를, 못 읽으면 null.
 */
export function sessionDate(text: string, publishedAt: string): string | null {
  const day = /(?:^|[^\d])(\d{1,2})일/.exec(text)?.[1];
  if (!day) return null;
  const published = Date.parse(publishedAt);
  for (let back = 0; back <= 4; back += 1) {
    const date = kstDate(new Date(published - back * 86_400_000).toISOString());
    if (Number(date.slice(8, 10)) === Number(day)) return date;
  }
  return null;
}

type NewsFetch = (input: { sources: ("yonhap" | "hankyung")[]; query: string; limit: number; content: "body" }) => Promise<{ data: NewsData }>;

/**
 * 공식 자료보다 뒤에 나온 기사에서 당일 종가를 찾아, 검산이 맞으면 계산 항목으로 장부에 올립니다. 올렸으면 그 항목, 아니면 undefined.
 * 본문을 직접 받는 매체(연합뉴스 · 한국경제)만 봅니다. 기사를 못 받거나 검산이 안 맞으면 아무것도 올리지 않고 리포트는 이어집니다.
 */
export async function addTodayClose(ctx: ResearchContext, index: KrIndexName, news: NewsFetch = fetchNews as NewsFetch): Promise<Evidence | undefined> {
  const official = officialIndex(ctx.evidence, index);
  if (!official || todayIndex(ctx.evidence, index)) return undefined;
  const started = Date.now();
  const prevDate = String(official.values["latest.date"]);
  const prevClose = official.values["latest.close"] as number;
  try {
    // 마감 기사는 제목에 코스피만 적고 본문에 코스닥을 함께 쓰는 일이 많아, 지수 이름과 "코스피" 두 검색어로 받습니다
    const queries = [...new Set([index.split(" ")[0]!, "코스피"])];
    const results = await Promise.all(queries.map((query) => news({ sources: ["yonhap", "hankyung"], query, limit: 5, content: "body" }).catch(() => null)));
    for (const article of results.flatMap((r) => r?.data.articles ?? [])) {
      if (article.body.status !== "available") continue;
      const date = sessionDate(article.body.text, article.publishedAt);
      if (!date || date <= prevDate) continue;
      const today = closeMatch(article.body.text, index);
      // "21일 … 전날 코스피는 … 마쳤다" 처럼 다른 날의 마감을 다시 쓴 문장은 본문의 날짜가 그 종가의 날짜가 아니라 건너뜁니다 (#123 Codex 리뷰)
      if (!today || /전날|어제|지난|전주|앞서/.test(today.lead) || !consistent(prevClose, today)) continue;
      const entry: Evidence = {
        id: ctx.nextCalcId(),
        tool: INDEX_TODAY_TOOL,
        label: `당일 종가 (기사 보도 · 공식 전일 종가로 검산) · ${article.publisher}`,
        values: { index, date, close: today.close, change: today.change, changePct: today.changePct, prevClose, prevDate },
        source: { name: article.publisher, url: article.url, asOf: date },
        note: `기사에 실린 값이에요. 공식 전일 종가(${prevDate}) ${prevClose} 에 기사의 변화폭 ${today.change} 을 더하면 기사의 종가 ${today.close} 와 맞아요. 공식 자료는 다음 영업일에 공개돼요.`,
        lineage: { op: "prevClose+change", inputs: [official.id] },
      };
      ctx.addEvidence([entry]);
      ctx.addStep({ tool: INDEX_TODAY_TOOL, status: "ok", ms: Date.now() - started });
      return entry;
    }
  } catch {
    // 기사를 못 받아도 공식 종가만으로 리포트를 냅니다
  }
  return undefined;
}

/**
 * 지수 질문이면 공식 종가를 장부에 채우고, 당일 종가도 찾아 봅니다. 지수 질문이 아니거나 조회가 실패하면 null (error step 만 남음).
 * 지수 tool 은 레지스트리에 없어 분류 · 조사가 고르지 않으므로 여기서 직접 부릅니다.
 */
export async function ensureIndex(ctx: ResearchContext, question: string, given?: InvokableTool, news?: NewsFetch): Promise<IndexName | null> {
  const index = indexFor(question);
  if (!index) return null;
  return (await ensureOne(ctx, index, indexPlan(question), given, news)) ? index : null;
}

/** 질문이 물은 지수 모두를 받습니다 (지수마다 공식 종가 · 당일 종가 검산). 받은 지수와 그 기간 */
export async function ensureIndexes(ctx: ResearchContext, question: string, given?: InvokableTool, news?: NewsFetch): Promise<IndexPick[]> {
  const plan = indexPlan(question);
  const picks = await Promise.all(indexesFor(question).map((index) => ensureOne(ctx, index, plan, given, news)));
  return picks.filter((p): p is IndexPick => p !== null);
}

/** 한 지수: 없거나 질문의 기간과 다르게 받아 둔 것만 있으면 그 기간으로 받고, 국내 지수는 당일 종가를 기사로 검산합니다 */
async function ensureOne(ctx: ResearchContext, index: IndexName, plan: { days: number; calendar: IndexCalendar }, given?: InvokableTool, news?: NewsFetch): Promise<IndexPick | null> {
  const tool = given ?? ((isUs(index) ? usIndexTool : krIndexTool) as unknown as InvokableTool);
  const fetch = async (days: number) => {
    const have = officialIndex(ctx.evidence, index, days);
    // 관계 질문이 1년으로 받아 둔 것은 기본 기간(30일)이면 그대로 쓰고, 질문이 기간을 말했는데 그 기간과 다르면 다시 받습니다 (거래일 차이 2일까지 같다고 봄)
    if (!have || (days !== 30 && Math.abs(spanDays(have) - days) > 2)) {
      await tool.invoke(new RunContext(ctx), JSON.stringify({ index, days })).catch(() => undefined);
    }
  };
  let days = plan.days;
  let calendar: IndexPick["calendar"] = plan.calendar;
  await fetch(days);
  const first = officialIndex(ctx.evidence, index, days);
  if (!first) return null;
  if (plan.calendar === "this_week") {
    // 기준일을 알았으니 월요일 앞 마지막 거래일과 비교하도록 다시 받습니다 (기준일에서 지난 일요일까지 → 그 이하 가장 가까운 거래일).
    // 맞게 받았는지는 거리가 아니라 비교 시작일로 봅니다: 금요일이 휴장이면 목요일과 비교되어 거리가 하루 더 깁니다 (#178 Codex 리뷰).
    // 기준일이 아직 지난주면(월요일 아침 · 미국 자료가 늦는 날) 최근 7일로 두고 '이번 주' 라고 부르지 않게
    const exact = thisWeekDays(String(first.values["latest.date"]));
    let week: Evidence | undefined = exact !== null && exact === spanDays(first) ? first : undefined;
    if (exact !== null && !week) {
      // 이번 주로 다시 받은 항목만 봅니다. 다시 받기가 실패하면 먼저 받은 7일 항목이 '이번 주' 로 둔갑하지 않게 (#178 Codex 리뷰)
      const before = ctx.evidence.length;
      await tool.invoke(new RunContext(ctx), JSON.stringify({ index, days: exact })).catch(() => undefined);
      week = ctx.evidence.slice(before).find((e) => (e.tool === INDEX_TOOL || e.tool === US_INDEX_TOOL) && e.values.index === index && typeof e.values["latest.close"] === "number");
    }
    if (week && isWeekToDate(week)) days = spanDays(week);
    else calendar = "this_week_empty";
  }
  // 당일 종가의 기사 검산은 국내 지수만 합니다 (국내 마감 기사의 문장 꼴에 맞춘 것)
  if (!isUs(index)) await addTodayClose(ctx, index, news);
  return { index, days, calendar };
}

/**
 * 작성에 보이지 않게 할 지수 항목: 고르지 않은 짧은 기간 항목 ('이번 주' 를 받으려고 먼저 받은 최근 7일).
 * 둘 다 보이면 작성이 7일 값을 이번 주 날짜로 적습니다 (11/26 로컬: 이번 주 11/20~24 카드 +2.79% 옆에 요약은 7일 값 +0.76% 을 "11/20~24" 로).
 * 1년 항목(Deep · 관계 질문)은 그쪽 메모가 쓰므로 그대로 둡니다. 검증은 장부 전체로 합니다
 */
export function indexHidden(evidence: Evidence[], picks: readonly IndexPick[]): Set<string> {
  const out = new Set<string>();
  for (const p of picks) {
    const chosen = officialIndex(evidence, p.index, p.days);
    for (const e of evidence) {
      if ((e.tool === INDEX_TOOL || e.tool === US_INDEX_TOOL) && e.values.index === p.index && e !== chosen && spanDays(e) < 300) out.add(e.id);
    }
  }
  return out;
}

/** 정제가 뺐더라도 [지수 값] 으로 다시 보여 주는 항목들 */
export function indexRefs(evidence: Evidence[], index: IndexName, days = 30): string[] {
  return [officialIndex(evidence, index, days)?.id, todayIndex(evidence, index)?.id].filter((id): id is string => !!id);
}

export const points = (n: number) => n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number, unit: string) => `${n > 0 ? "+" : ""}${n.toFixed(2)}${unit}`;

/** 작성 입력에 붙이는 [지수 값]. 값을 직접 적어 정제가 뺐더라도 작성이 볼 수 있게 합니다 (검증은 장부 전체로 대조) */
/** 공식 자료가 늦는 이유 한 마디. 국내는 다음 영업일 공개, 미국(FRED)은 하루 이틀 뒤 */
const lag = (index: IndexName) => (isUs(index) ? "하루 이틀 늦게 올라오는 자료라" : "다음 영업일에 공개되는 자료라");

/** 변화의 방향 낱말 (지수 메모용) */
function direction(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  return !Number.isFinite(n) || n === 0 ? "변동 없음" : n > 0 ? "상승" : "하락";
}

export function indexNote(evidence: Evidence[], index: IndexName | (IndexName | IndexPick)[]): string {
  const picks: IndexPick[] = (Array.isArray(index) ? index : [index])
    .map((x) => (typeof x === "string" ? { index: x, days: 30, calendar: null } : x))
    .filter((p) => officialIndex(evidence, p.index, p.days));
  if (picks.length === 0) return "";
  const indexes = picks.map((p) => p.index);
  const lines = [`[지수 값] 질문이 물은 ${indexes.join(" · ")} 지수의 값입니다. 지수 값에는 "원" 을 붙이지 않습니다.`];
  for (const { index: i, days, calendar } of picks) {
    const o = officialIndex(evidence, i, days)!;
    const v = o.values;
    const t = todayIndex(evidence, i);
    lines.push(
      `${i} 공식 자료 (ref ${o.id}, ${lag(i)} ${v["latest.date"]} 종가가 최신입니다):`,
      `- 종가 ${points(v["latest.close"] as number)} (${v["latest.date"]}), 전일 대비 ${signed(v["latest.changePct"] as number, "%")} (${direction(v["latest.changePct"])})`,
      `- ${v["period.from"]} 종가 ${points(v["period.closeFrom"] as number)} 와 비교해 ${signed(v["period.returnPct"] as number, "%")} (${direction(v["period.returnPct"])})`,
    );
    if (t) {
      lines.push(
        `${i} 기사 보도 (ref ${t.id}, ${t.source.name}. 공식 전일 종가로 검산한 값입니다):`,
        `- ${t.values.date} 종가 ${points(t.values.close as number)}, 전일 대비 ${signed(t.values.changePct as number, "%")} (${signed(t.values.change as number, "포인트")})`,
        `${i} 은(는) 가장 최근인 ${t.values.date} 값을 먼저 쓰고 "기사 보도" 라고 밝힙니다. 공식 자료의 값은 기준일(${v["latest.date"]})과 함께 따로 씁니다. 두 날짜의 값을 섞지 않습니다.`,
      );
    } else {
      lines.push(`${i} 공식 자료의 기준일(${v["latest.date"]}) 뒤의 움직임은 기사 내용으로만 쓰고, 기준일과 구분해 적습니다.`);
    }
    // 기간 안내는 지수마다 (국내는 이번 주 자료가 있는데 미국 자료는 아직 지난주까지일 수 있음, #178 Codex 리뷰)
    if (calendar === "this_week") lines.push(`${i} 의 기간 변화는 이번 주 월요일 앞 마지막 거래일(${v["period.from"]}) 종가와 기준일 종가의 비교라 "이번 주 들어" 로 쓸 수 있습니다.`);
    if (calendar === "this_week_empty") lines.push(`${i} 은(는) 이번 주 거래일의 공식 종가가 아직 없어 최근 7일로 받았습니다. ${i} 에는 '이번 주' 라고 쓰지 않고 날짜로 밝힙니다.`);
    if (calendar === "last_week") lines.push(`질문이 '지난주' 를 물었지만 ${i} 지수 자료는 기준일까지의 최근 기간으로만 받을 수 있어, 지난주만 떼어 계산하지 않았습니다. 위 기간을 날짜로 밝히고 '지난주 변화' 라고 부르지 않습니다. 지난주만의 변화는 확인하지 못한 것에 한 줄로 씁니다.`);
  }
  // 질문이 "왜 떨어졌어?" 여도 하루 등락은 장부 방향 그대로 (11/25 운영: 11/24 하루 +4.79% 를 "전일보다 4.79% 하락" 으로 써 검증이 문장을 뺌, mwvnyrfx-2axwvk)
  lines.push(`오르내림의 방향은 위 괄호 그대로 씁니다. 질문이 "떨어졌어 · 올랐어" 라고 해도 방향을 바꾸지 않습니다. 하루와 기간의 방향이 다르면 어느 기간인지 밝혀 나눠 쓰고, 질문이 말한 방향과 맞는 기간을 먼저 씁니다.`);
  if (indexes.length > 1) {
    lines.push(`질문이 지수 ${indexes.length}개(${indexes.join(" · ")})를 물었습니다. 요약에 지수마다 값과 기간 변화를 쓰고, 한 지수만 쓰고 끝내지 않습니다. 두 지수의 방향이 같은지 다른지도 한 구절로 씁니다.`);
  }
  lines.push(`기간 변화는 위 기간(시작일 ~ 기준일)의 값입니다. 질문이 '일주일 추세' 처럼 흐름을 물으면 그 기간의 시작 · 끝 값과 변화로 씁니다. 일별 종가는 리포트의 차트가 보여 주므로, 중간 날짜의 종가 숫자를 따로 쓰지 않고 "일별 종가가 없다 · 일별 흐름을 확인할 수 없다" 고도 쓰지 않습니다 (11/26 로컬).`);
  lines.push(`지수가 왜 움직였는지 묻는 질문이면, 요약의 첫 문장은 움직인 크기로 쓰고 둘째 문장에 기사가 전한 배경을 "○○ 보도에 따르면" 으로 씁니다. "원인은 단정하기 어려워요" 로 요약을 시작하지 않고, 그 한계는 주의점에 한 번만 씁니다.`);
  lines.push(`지수 값이 없다거나 확인할 수 없다고 쓰지 않습니다. 이 밖에 기사 본문에만 있는 숫자는 장부에 없어 검증에서 빠지므로 쓰지 않고, 내용만 숫자 없이 씁니다.`);
  return lines.join("\n");
}

/**
 * 지수 숫자가 "오늘의 숫자" 에 없으면 맨 앞에 넣습니다. 작성이 [지수 값] 을 보고도 숫자 칸을 비우는 일이 있어(11/20 실측 3번 중 1번) 코드가 보장합니다.
 * 값은 장부 그대로라 검증을 통과하고, 작성이 이미 같은 값을 썼으면(값 · 변화 칸) 넣지 않습니다. 순서는 당일(기사 보도) → 공식 종가 → 기간 변화.
 */
export function withIndexNumbers(output: WriterOutput, evidence: Evidence[], index: IndexName, days = 30): WriterOutput {
  const o = officialIndex(evidence, index, days);
  if (!o) return output;
  // 글자가 아니라 값으로 비교합니다 ("23,879.20" 과 "23,879.2포인트" 는 같은 값). 변화 칸에 적혀 있어도 있는 것으로 봅니다.
  // 부호가 적힌 숫자는 부호까지 같아야 같은 값입니다: 전일 대비 "+2.00%" 를 썼다고 기간 변화 -2.00% 가 이미 있는 것은 아닙니다 (#128 Codex 리뷰)
  // 이 지수의 항목을 가리키는 카드만 봅니다. 두 지수의 기간 수익률이 같은 값이어도 둘 다 남게 (#178 Codex 리뷰)
  const own = new Set([o.id, todayIndex(evidence, index)?.id].filter(Boolean));
  const written = output.numbers.filter((n) => n.ref !== null && own.has(n.ref)).flatMap((n) =>
    [...`${n.value} ${n.change}`.replace(/\d{4}-\d{2}-\d{2}/g, " ").matchAll(/([-+−])?\s*(\d[\d,]*(?:\.\d+)?)/g)].map((m) => ({ sign: m[1] ? (m[1] === "+" ? 1 : -1) : 0, value: Number(m[2]!.replace(/,/g, "")) })),
  );
  const has = (value: number) => written.some((w) => Math.abs(w.value - Math.abs(value)) < 0.005 && (w.sign === 0 || w.sign === Math.sign(value)));
  const add: WriterOutput["numbers"] = [];
  const t = todayIndex(evidence, index);
  if (t && !has(t.values.close as number)) {
    add.push({ label: `${index} 종가 (기사 보도)`, value: points(t.values.close as number), change: `전일 대비 ${signed(t.values.changePct as number, "%")}`, asOf: String(t.values.date), ref: t.id });
  }
  const v = o.values;
  if (!has(v["latest.close"] as number)) {
    add.push({ label: `${index} 종가 (공식 자료)`, value: points(v["latest.close"] as number), change: "", asOf: String(v["latest.date"]), ref: o.id });
  }
  if (!has(v["period.returnPct"] as number)) add.push({ label: `${index} 기간 변화 (공식 자료)`, value: signed(v["period.returnPct"] as number, "%"), change: `${v["period.from"]}~${v["period.to"]}`, asOf: String(v["latest.date"]), ref: o.id });
  // 작성이 쓴 카드도 어느 쪽 값인지 이름에 밝힙니다 (둘 다 "코스피 종가" 로 나오면 기준일만 다른 같은 카드로 보임)
  const tag = (n: WriterOutput["numbers"][number]) => {
    const kind = t && n.ref === t.id ? "기사 보도" : n.ref === o.id ? "공식 자료" : "";
    return kind && !n.label.includes(kind) ? { ...n, label: `${n.label} (${kind})` } : n;
  };
  const numbers = [...add, ...output.numbers.map(tag)];
  return add.length || numbers.some((n, i) => n !== output.numbers[i]) ? { ...output, numbers } : output;
}

/** 두 값의 기준일이 다른 이유를 적는 주의점 한 줄. 검증 뒤에 붙이고, 작성이 이미 같은 설명을 썼으면 넣지 않습니다 */
export function indexCaveats(evidence: Evidence[], index: IndexName, caveats: string[] = [], days = 30): string[] {
  const o = officialIndex(evidence, index, days);
  if (!o || caveats.some((c) => /하루 늦|하루 이틀|늦게 올라|다음 영업일|T\+1|직전 영업일/.test(c))) return [];
  const t = todayIndex(evidence, index);
  const date = o.values["latest.date"];
  return [
    t
      ? `${index} 공식 자료는 다음 영업일에 공개돼 ${date} 종가가 최신이에요. ${t.values.date} 종가는 ${t.source.name} 기사에 실린 값이고, 공식 전일 종가에 기사의 변화폭을 더해 맞는지 확인했어요.`
      : isUs(index)
        ? `${index} 지수 값은 하루 이틀 늦게 올라오는 자료라 ${date} 종가가 최신이에요. 그 뒤의 움직임은 숫자로 확인한 값이 아니에요.`
        : `${index} 공식 자료는 다음 영업일에 공개돼 ${date} 종가가 최신이에요. 그 뒤의 움직임은 기사 내용이며, 숫자로 확인한 값이 아니에요.`,
  ];
}

/** "일별 종가가 없어 일별 흐름은 확인할 수 없어요" 꼴 (일별 · 일자별 · 날짜별 종가 · 등락 · 흐름 + 없음 · 필요 · 확인 못 함) */
const DAILY_TALK = /(?:일일|일별|일자별|날짜별|하루하루)\s*(?:지수\s*)?(?:종가|등락|흐름|시세)/;
const DAILY_MISSING = /없|필요|부족|확인(?:되지|하지|할\s*수)/;

/**
 * 지수 차트가 일별 종가를 보여 주는데 주의점 · 확인하지 못한 것에 "일별 종가 자료가 없어요" 가 들어가면 그 문장을 뺍니다
 * (11/26 로컬: 작성 메모로 막아도 일주일 추세 질문 2번 모두 확인하지 못한 것에 남음). 차트가 있을 때만 부릅니다 (muffin.ts)
 */
export function dropDailyCloseTalk<T extends Pick<WriterOutput, "caveats" | "dataGaps">>(output: T): T {
  const talk = (s: string) => DAILY_TALK.test(s) && DAILY_MISSING.test(s);
  const clean = (lines: string[]) =>
    lines.map((l) => (talk(l) ? l.split(/(?<=[.!?])\s+/).filter((x) => x.trim() && !talk(x)).join(" ") : l)).filter((l) => l.trim().length > 0);
  const caveats = clean(output.caveats);
  const dataGaps = clean(output.dataGaps);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return same(caveats, output.caveats) && same(dataGaps, output.dataGaps) ? output : { ...output, caveats, dataGaps };
}
