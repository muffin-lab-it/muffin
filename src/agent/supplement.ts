/**
 * 환율 원인 질문의 필수 근거 보강 (리더, 11/16).
 *
 * 원인 지도(movement.ts causeMap)의 "다른 통화 대비 흐름" 후보는 잰 통화와 같은 기간의 다른 통화(USD · EUR · JPY 중 나머지) 환율이 있어야 확인됩니다.
 * 조사(research.ts)는 그 지도를 모르고, 지시문에 없는 통화를 모델이 알아서 더 조회하는 건 절반쯤이었습니다 (11/16 실측: 같은 질문 3회 중 1회 누락 → 원인 0개).
 * "순서와 필수 근거는 코드가 보장하고 모델은 단계 안에서 판단한다" 는 원칙대로, 조사가 끝난 뒤 장부에 없는 통화만 환율 tool 을 직접 불러 채웁니다.
 *  - 조사와 같은 래퍼(defineTool)를 지나므로 장부(E 번호) · 실행 기록(step · 진행 화면) · 재시도 · 캐시 폴백이 그대로 적용됩니다.
 *  - 실패해도 리포트는 이어집니다 (error step 만 남음). 환율이 주제가 아니거나 잴 대상이 없거나 환율 tool 이 없으면 아무것도 부르지 않습니다.
 *  - 정제 전에 채우므로 정제가 사실 목록에 넣을 수 있고, 큰 움직임이면 정제가 뺐더라도 후보 근거로 다시 봅니다 (movement.ts rescuedRefs).
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { missingPairs, type Target } from "./movement";
import { areaTools } from "./plan";
import type { Area, Evidence, WriterOutput } from "./schema";

/** 레지스트리 tool 중 여기서 쓰는 부분 (Agents SDK FunctionTool 의 name · invoke) */
export type InvokableTool = { name: string; invoke: (runContext: RunContext<ResearchContext>, input: string) => Promise<unknown> };

/** target: muffin.ts 가 보강 전에 고른 잴 대상. 보강으로 통화가 늘어도 게이트가 같은 통화를 재게 밖에서 한 번만 고릅니다 (Codex 리뷰) */
export async function ensureOtherPairs(ctx: ResearchContext, question: string, area: Area | undefined, tools: readonly InvokableTool[], target?: Target): Promise<{ currency: string; days: number }[]> {
  const fx = tools.find((t) => t.name === areaTools.fx);
  if (!fx) return [];
  const missing = missingPairs(ctx.evidence, question, area, target);
  if (missing.length === 0) return [];
  const rc = new RunContext(ctx);
  // 래퍼가 실패를 장부 · step 에 남기므로 여기서는 리포트를 멈추지 않습니다
  await Promise.all(missing.map((m) => fx.invoke(rc, JSON.stringify(m)).catch(() => undefined)));
  return missing;
}

/** 물가 원인 질문인지. 분류 영역과 무관하게 질문 낱말로 봅니다 (뉴스 영역의 "물가가 왜 올랐는지 뉴스에서는…" 도 품목군 자료가 있으면 낫습니다) */
export function isPriceQuestion(question: string): boolean {
  return /물가|소비자물가|인플레|\bcpi\b/i.test(question);
}

/** 품목군 조회 입력. endMonth 는 조사가 받은 총지수의 관측 월로 바꿔 보냅니다 (months 는 tool 이 무시) */
export const CPI_CATEGORIES_INPUT = { country: "KR", indicator: "cpi_categories", endMonth: null, months: 1 } as const;

export function hasCpiCategories(evidence: Evidence[]): boolean {
  return evidence.some((e) => e.values.indicator === "cpi_categories");
}

/** 조사가 받아 온 한국 CPI 총지수 항목의 최신 관측 월 (YYYYMM). 없으면 undefined */
export function krCpiMonth(evidence: Evidence[]): string | undefined {
  const cpi = evidence.find((e) => e.values.indicator === "cpi" && e.values.country === "KR" && /^\d{6}$/.test(String(e.values["latest.month"] ?? "")));
  return cpi ? String(cpi.values["latest.month"]) : undefined;
}

/**
 * 물가 원인 질문이면 품목군별 등락률 · 기여도(get_macro_indicators cpi_categories)를 코드가 채웁니다 (11/19 페르소나 테스트: "왜 올랐어" 에 원인 0개).
 * 조사가 이미 받아 왔거나, 물가 질문이 아니거나, 거시지표 tool 이 없으면 부르지 않습니다. 실패해도 리포트는 이어집니다 (error step 만 남음).
 */
export async function ensureCpiCategories(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<boolean> {
  const macro = tools.find((t) => t.name === areaTools.macro);
  if (!macro || !isPriceQuestion(question) || hasCpiCategories(ctx.evidence)) return false;
  // 조사가 한국 CPI 총지수를 받아 왔을 때만, 그 관측 월에 맞춰 품목군을 받습니다. 미국 물가 질문이나 과거 월 질문에 최신 한국 품목군을 붙이지 않게 (Codex 리뷰)
  const month = krCpiMonth(ctx.evidence);
  if (!month) return false;
  await macro.invoke(new RunContext(ctx), JSON.stringify({ ...CPI_CATEGORIES_INPUT, endMonth: month })).catch(() => undefined);
  return true;
}

/**
 * 지수 질문의 지수 값 보강 (11/20 베타: "요즘 코스피 어때?" 가 뉴스만 불러 기사 제목엔 지수가 있는데 "오늘의 숫자" 는 비어 있었음).
 * 지수만 주는 tool 은 없지만, 국내 ETF tool 의 결과에 기초지수 종가(latest.indexClose) · 기간 수익률(period.indexReturnPct)이 들어 있습니다.
 * 그래서 질문이 지수를 물으면 그 지수를 따라가는 ETF 를 코드가 조회해 장부에 올리고, 작성에는 "지수 값은 여기" 라고 알려 줍니다.
 */
export type IndexProxy = { index: string; query: string };
const INDEX_PROXIES: { match: RegExp; proxy: IndexProxy }[] = [
  { match: /코스피\s*200|KOSPI\s*200/i, proxy: { index: "코스피 200", query: "KODEX 200" } },
  { match: /코스닥\s*150|KOSDAQ\s*150/i, proxy: { index: "코스닥 150", query: "KODEX 코스닥150" } },
  { match: /코스피|KOSPI/i, proxy: { index: "코스피", query: "KODEX 코스피" } },
];
/** ETF 를 묻는 질문의 낱말. 있으면 지수가 아니라 그 ETF 가 주제라 조사에 맡깁니다 */
const ETF_SUBJECT = /ETF|이티에프|KODEX|코덱스|TIGER|타이거|RISE|ACE|PLUS|SOL|KIWOOM|HANARO|\d{6}/i;

/** 질문이 물은 국내 지수와 그 지수를 따라가는 ETF. 지수 질문이 아니거나 ETF 를 묻는 질문이면 null */
export function indexProxyFor(question: string): IndexProxy | null {
  if (ETF_SUBJECT.test(question)) return null;
  return INDEX_PROXIES.find((p) => p.match.test(question))?.proxy ?? null;
}

/** 장부에서 그 지수를 기초지수로 하는 ETF 결과 (지수 종가가 있는 것) */
export function indexEvidence(evidence: Evidence[], proxy: IndexProxy): Evidence | undefined {
  return evidence.find((e) => e.tool === areaTools.etf && e.values.baseIndex === proxy.index && typeof e.values["latest.indexClose"] === "number");
}

/**
 * 지수 질문이면 지수 값을 가진 ETF 결과를 장부에 채웁니다. 분류가 ETF tool 을 고르지 않았어도 부르므로 tools 는 레지스트리 전체를 받습니다.
 * 이미 있거나 지수 질문이 아니면 부르지 않고, 실패해도 리포트는 이어집니다 (error step 만 남음).
 */
export async function ensureIndexProxy(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<IndexProxy | null> {
  const proxy = indexProxyFor(question);
  const etf = tools.find((t) => t.name === areaTools.etf);
  if (!proxy || !etf) return null;
  if (!indexEvidence(ctx.evidence, proxy)) await etf.invoke(new RunContext(ctx), JSON.stringify({ query: proxy.query, days: 30 })).catch(() => undefined);
  return indexEvidence(ctx.evidence, proxy) ? proxy : null;
}

const points = (n: number) => n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 작성 입력에 붙이는 [지수 값]. 정제가 이 항목을 뺐더라도 지수 값은 작성이 볼 수 있게 값을 직접 적습니다 (검증은 장부 전체로 대조) */
export function indexNote(evidence: Evidence[], proxy: IndexProxy): string {
  const e = indexEvidence(evidence, proxy);
  if (!e) return "";
  const v = e.values;
  const lines = [`- ${proxy.index} 지수 종가: ${points(v["latest.indexClose"] as number)} (기준일 ${v["latest.date"]})`];
  if (typeof v["period.indexCloseFrom"] === "number") lines.push(`- 비교 시점 지수: ${points(v["period.indexCloseFrom"])} (${v["period.from"]})`);
  if (typeof v["period.indexReturnPct"] === "number") lines.push(`- 지수 기간 수익률: ${v["period.indexReturnPct"].toFixed(2)}% (${v["period.from"]} → ${v["period.to"]})`);
  return [
    `[지수 값] 질문이 물은 ${proxy.index} 지수의 값입니다. ${proxy.index} 를 따라가는 ETF(${v.name}) 조회 결과 ${e.id} 에 들어 있는 기초지수 값이라 ref 는 ${e.id} 입니다.`,
    ...lines,
    `질문은 지수를 물었으므로 "오늘의 숫자" 와 요약에는 ETF 가격이 아니라 이 지수 값을 씁니다. 지수 값에는 "원" 을 붙이지 않습니다. ETF 의 이름 · 종가 · 괴리율은 쓰지 않습니다.`,
    `이 값은 하루 늦게 공개되는 종가입니다. 지수 값이 없다거나 확인할 수 없다고 쓰지 않고, 기준일 뒤의 움직임(기사 내용)은 기준일과 구분해 적습니다.`,
  ].join("\n");
}

/**
 * 지수 종가 · 기간 수익률이 "오늘의 숫자" 에 없으면 맨 앞에 넣습니다. 작성이 [지수 값] 을 보고도 숫자 칸을 비우는 일이 있어(11/20 실측 3번 중 1번)
 * 코드가 보장합니다. 값은 장부 그대로라 검증을 통과하고, 작성이 이미 같은 값을 썼으면 넣지 않습니다.
 */
export function withIndexNumbers(output: WriterOutput, evidence: Evidence[], proxy: IndexProxy): WriterOutput {
  const e = indexEvidence(evidence, proxy);
  if (!e) return output;
  const v = e.values;
  // 값 칸뿐 아니라 변화 칸에 이미 적혀 있어도 다시 넣지 않습니다 ("코스피 종가 5,137.89 · 30일 -7.47%")
  const has = (text: string) => output.numbers.some((n) => `${n.value} ${n.change}`.replace(/\s/g, "").includes(text));
  const add: WriterOutput["numbers"] = [];
  const close = points(v["latest.indexClose"] as number);
  if (!has(close)) add.push({ label: `${proxy.index} 지수 종가`, value: close, change: "", asOf: String(v["latest.date"]), ref: e.id });
  if (typeof v["period.indexReturnPct"] === "number") {
    const pct = `${v["period.indexReturnPct"].toFixed(2)}%`;
    if (!has(pct)) add.push({ label: `${proxy.index} 지수 기간 수익률`, value: pct, change: `${v["period.from"]}~${v["period.to"]}`, asOf: String(v["latest.date"]), ref: e.id });
  }
  return add.length ? { ...output, numbers: [...add, ...output.numbers] } : output;
}

/** 지수 값의 기준일이 하루 늦다는 주의점 한 줄 (11/20 베타: 기사는 오늘 하락을 말하는데 숫자는 어제라 날짜가 어색함). 검증 뒤에 붙입니다 */
export function indexCaveats(evidence: Evidence[], proxy: IndexProxy, caveats: string[] = []): string[] {
  const e = indexEvidence(evidence, proxy);
  // 작성이 이미 같은 설명을 썼으면 넣지 않습니다 (같은 말이 두 줄 나오지 않게)
  if (!e || caveats.some((c) => /하루 늦|다음 영업일|T\+1|직전 영업일/.test(c))) return [];
  return [`${proxy.index} 지수 값은 다음 영업일에 공개되는 자료라 ${e.values["latest.date"]} 종가입니다. 그 뒤의 움직임은 기사 내용이며, 숫자로 확인한 값이 아닙니다.`];
}
