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

export const INDEX_TOOL = "get_kr_stock_index";
export const US_INDEX_TOOL = "get_us_stock_index";
/** 질문이 물을 수 있는 지수. 국내는 금융위 지수시세정보, 미국은 FRED 에서 받습니다 */
export type IndexName = KrIndexName | UsIndexName;
const isUs = (index: IndexName): index is UsIndexName => (US_INDEXES as readonly string[]).includes(index);
export const INDEX_TODAY_TOOL = "calc_index_today";

const INDEX_WORDS: [RegExp, IndexName][] = [
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
export function indexFor(question: string): IndexName | null {
  if (ETF_SUBJECT.test(question)) return null;
  const hits = INDEX_WORDS.map(([re, name]) => ({ name, at: question.search(re) })).filter((h) => h.at >= 0);
  // "코스피 200" 은 "코스피" 패턴에 걸리지 않으므로(뒤에 숫자) 위치만 비교하면 됩니다
  return hits.sort((a, b) => a.at - b.at)[0]?.name ?? null;
}

/** 장부의 공식 지수 항목 */
export function officialIndex(evidence: Evidence[], index: IndexName): Evidence | undefined {
  return evidence.find((e) => (e.tool === INDEX_TOOL || e.tool === US_INDEX_TOOL) && e.values.index === index && typeof e.values["latest.close"] === "number");
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
        note: `기사에 실린 값입니다. 공식 전일 종가(${prevDate}) ${prevClose} 에 기사의 변화폭 ${today.change} 을 더하면 기사의 종가 ${today.close} 와 맞습니다. 공식 자료는 다음 영업일에 공개됩니다.`,
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
  const tool = given ?? ((isUs(index) ? usIndexTool : krIndexTool) as unknown as InvokableTool);
  if (!officialIndex(ctx.evidence, index)) await tool.invoke(new RunContext(ctx), JSON.stringify({ index, days: 30 })).catch(() => undefined);
  if (!officialIndex(ctx.evidence, index)) return null;
  // 당일 종가의 기사 검산은 국내 지수만 합니다 (국내 마감 기사의 문장 꼴에 맞춘 것)
  if (!isUs(index)) await addTodayClose(ctx, index, news);
  return index;
}

/** 정제가 뺐더라도 [지수 값] 으로 다시 보여 주는 항목들 */
export function indexRefs(evidence: Evidence[], index: IndexName): string[] {
  return [officialIndex(evidence, index)?.id, todayIndex(evidence, index)?.id].filter((id): id is string => !!id);
}

const points = (n: number) => n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number, unit: string) => `${n > 0 ? "+" : ""}${n.toFixed(2)}${unit}`;

/** 작성 입력에 붙이는 [지수 값]. 값을 직접 적어 정제가 뺐더라도 작성이 볼 수 있게 합니다 (검증은 장부 전체로 대조) */
/** 공식 자료가 늦는 이유 한 마디. 국내는 다음 영업일 공개, 미국(FRED)은 하루 이틀 뒤 */
const lag = (index: IndexName) => (isUs(index) ? "하루 이틀 늦게 올라오는 자료라" : "다음 영업일에 공개되는 자료라");

export function indexNote(evidence: Evidence[], index: IndexName): string {
  const o = officialIndex(evidence, index);
  if (!o) return "";
  const v = o.values;
  const t = todayIndex(evidence, index);
  const lines = [
    `[지수 값] 질문이 물은 ${index} 지수의 값입니다. 지수 값에는 "원" 을 붙이지 않습니다.`,
    `공식 자료 (ref ${o.id}, ${lag(index)} ${v["latest.date"]} 종가가 최신입니다):`,
    `- 종가 ${points(v["latest.close"] as number)} (${v["latest.date"]}), 전일 대비 ${signed(v["latest.changePct"] as number, "%")}`,
    `- ${v["period.from"]} 종가 ${points(v["period.closeFrom"] as number)} 와 비교해 ${signed(v["period.returnPct"] as number, "%")}`,
  ];
  if (t) {
    lines.push(
      `기사 보도 (ref ${t.id}, ${t.source.name}. 공식 전일 종가로 검산한 값입니다):`,
      `- ${t.values.date} 종가 ${points(t.values.close as number)}, 전일 대비 ${signed(t.values.changePct as number, "%")} (${signed(t.values.change as number, "포인트")})`,
      `요약은 가장 최근인 ${t.values.date} 값을 먼저 쓰고 "기사 보도" 라고 밝힙니다. 공식 자료의 값은 기준일(${v["latest.date"]})과 함께 따로 씁니다. 두 날짜의 값을 섞지 않습니다.`,
    );
  } else {
    lines.push(`공식 자료의 기준일(${v["latest.date"]}) 뒤의 움직임은 기사 내용으로만 쓰고, 기준일과 구분해 적습니다.`);
  }
  lines.push(`지수 값이 없다거나 확인할 수 없다고 쓰지 않습니다. 이 밖에 기사 본문에만 있는 숫자는 장부에 없어 검증에서 빠지므로 쓰지 않고, 내용만 숫자 없이 씁니다.`);
  return lines.join("\n");
}

/**
 * 지수 숫자가 "오늘의 숫자" 에 없으면 맨 앞에 넣습니다. 작성이 [지수 값] 을 보고도 숫자 칸을 비우는 일이 있어(11/20 실측 3번 중 1번) 코드가 보장합니다.
 * 값은 장부 그대로라 검증을 통과하고, 작성이 이미 같은 값을 썼으면(값 · 변화 칸) 넣지 않습니다. 순서는 당일(기사 보도) → 공식 종가 → 기간 변화.
 */
export function withIndexNumbers(output: WriterOutput, evidence: Evidence[], index: IndexName): WriterOutput {
  const o = officialIndex(evidence, index);
  if (!o) return output;
  // 글자가 아니라 값으로 비교합니다 ("23,879.20" 과 "23,879.2포인트" 는 같은 값). 변화 칸에 적혀 있어도 있는 것으로 봅니다
  const written = output.numbers.flatMap((n) => (`${n.value} ${n.change}`.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, ""))));
  const has = (value: number) => written.some((w) => Math.abs(w - Math.abs(value)) < 0.005);
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
export function indexCaveats(evidence: Evidence[], index: IndexName, caveats: string[] = []): string[] {
  const o = officialIndex(evidence, index);
  if (!o || caveats.some((c) => /하루 늦|하루 이틀|늦게 올라|다음 영업일|T\+1|직전 영업일/.test(c))) return [];
  const t = todayIndex(evidence, index);
  const date = o.values["latest.date"];
  return [
    t
      ? `${index} 공식 자료는 다음 영업일에 공개돼 ${date} 종가가 최신입니다. ${t.values.date} 종가는 ${t.source.name} 기사에 실린 값이고, 공식 전일 종가에 기사의 변화폭을 더해 맞는지 확인했습니다.`
      : isUs(index)
        ? `${index} 지수 값은 하루 이틀 늦게 올라오는 자료라 ${date} 종가가 최신입니다. 그 뒤의 움직임은 숫자로 확인한 값이 아닙니다.`
        : `${index} 공식 자료는 다음 영업일에 공개돼 ${date} 종가가 최신입니다. 그 뒤의 움직임은 기사 내용이며, 숫자로 확인한 값이 아닙니다.`,
  ];
}
