/**
 * 관계 질문의 공통 틀 (리더, 11/21 물가–금리 · 11/22 환율–금리 → 11/23 공통 틀).
 *
 * 11/20 베타: "물가와 금리, cpi 상관관계 알려줘" 에 "실제 상관관계는 확인할 수 없으며, 기준금리는 3.00% 입니다" 가 나왔습니다. 조합마다 따로
 * 고쳤더니 11/23 점검 10문항 중 다른 조합(금리–코스피 · 환율–코스피 · 미국 금리–나스닥 · 물가–실업률 · 엔화–일본 금리 · 환율–수입물가)은 그대로였습니다.
 *  - 기간이 섞임: 금리는 1년, 지수는 30일이라 두 지표를 나란히 볼 수 없음
 *  - 일반 설명 거부: "환율 상승이 코스피에 미치는 일반적인 방향은 자료로 확인되지 않았어요"
 *  - 한 줄 요약이 부정문: 10개 중 6개가 "확인되지 않아요 · 자료가 부족해요" 로 끝남
 *
 * 그래서 지표 목록 하나(환율 · 정책금리 · 물가 상승률 · 실업률 · 주가지수)를 두고 다음을 코드가 합니다.
 *  1. 질문이 말한 지표를 찾습니다 (relationPlan). 나라는 지표 앞의 나라 이름으로, 없으면 질문 전체의 나라로 정합니다.
 *  2. 모든 지표를 같은 1년으로 받습니다 (ensureRelation). 조사가 이미 받은 것은 다시 부르지 않습니다.
 *  3. 작성에 [지표 나란히] 로 두 시점의 값 · 방향과, 그 조합의 일반적인 관계("일반적으로 …")를 알립니다 (relationNote).
 *  4. 숫자 카드 (withRelationNumbers) 와 부정문 · 숫자 없는 한 줄 요약 (relationHeadline) 을 장부 값으로 만듭니다.
 * 조합을 더할 때는 지표 목록(아래 NODE 들)이나 일반 설명(GENERAL) 한 줄만 더합니다. 상관계수는 계산하지 않습니다 (두 시점 비교).
 */
import { RunContext } from "@openai/agents";
import { krIndexTool } from "../tools/kr-index";
import { usIndexTool } from "../tools/us-index";
import type { ResearchContext } from "./context";
import { INDEX_TODAY_TOOL, INDEX_TOOL, INDEX_WORDS, US_INDEX_TOOL, isUs, points, type IndexName } from "./index-quote";
import { NEGATIVE, endsPast } from "./negatives";
import { areaTools } from "./plan";
import type { Evidence, WriterOutput } from "./schema";
import type { InvokableTool } from "./supplement";

type Kind = "fx" | "rate" | "cpi" | "jobs" | "stock";
type Currency = "USD" | "JPY" | "EUR";
type RateSeries = "BOK" | "DFF" | "DGS10" | "JP" | "GB" | "CA" | "AU" | "CH" | "CN" | "BR";
/** KR · US 와 금리 tool 이 받는 나라(BIS), 그리고 받지 않는 나라(DE 등 · WORLD "해외"). 받지 않는 나라를 말하면 한국 자료로 바꾸지 않고 missing 에 둡니다 (#144 Codex 리뷰) */
type Country = "KR" | "US" | "JP" | "GB" | "CA" | "AU" | "CH" | "CN" | "BR" | "EU" | "DE" | "FR" | "IT" | "ES" | "IN" | "TW" | "VN" | "RU" | "MX" | "SG" | "HK" | "WORLD";

/** 관계 질문이 말한 지표 하나. key 는 같은 지표를 두 번 넣지 않는 데 씁니다 ("rate:BOK") */
export type RelationNode =
  | { kind: "fx"; key: string; name: string; currency: Currency; pair: string; card: string }
  | { kind: "rate"; key: string; name: string; series: RateSeries; indicator: string }
  | { kind: "cpi" | "jobs"; key: string; name: string; country: "KR" | "US" }
  | { kind: "stock"; key: string; name: string; index: IndexName };

/** nodes: 받을 지표(질문에 나온 순서). missing: 질문이 말했지만 머핀이 받지 않는 것("수입물가") */
export type RelationPlan = { nodes: RelationNode[]; missing: string[] };

const FX: Record<Currency, RelationNode> = {
  USD: { kind: "fx", key: "fx:USD", name: "원/달러 환율", currency: "USD", pair: "USD/KRW", card: "달러당 원화 환율" },
  JPY: { kind: "fx", key: "fx:JPY", name: "원/엔 환율", currency: "JPY", pair: "JPY(100)/KRW", card: "100엔당 원화 환율" },
  EUR: { kind: "fx", key: "fx:EUR", name: "원/유로 환율", currency: "EUR", pair: "EUR/KRW", card: "유로당 원화 환율" },
};
/** 금리 tool 의 지표 이름(indicator)과 같아야 장부에서 찾습니다 (src/tools/rate) */
const RATE: Record<RateSeries, [name: string, indicator: string]> = {
  BOK: ["한국 기준금리", "한국은행 기준금리"],
  DFF: ["미국 정책금리", "미국 실효 연방기금금리"],
  DGS10: ["미국 10년물 국채 금리", "미국 국채 10년물 금리"],
  JP: ["일본 정책금리", "일본 정책금리"],
  GB: ["영국 정책금리", "영국 정책금리"],
  CA: ["캐나다 정책금리", "캐나다 정책금리"],
  AU: ["호주 정책금리", "호주 정책금리"],
  CH: ["스위스 정책금리", "스위스 정책금리"],
  CN: ["중국 1년 만기 LPR", "중국 1년 만기 LPR"],
  BR: ["브라질 정책금리", "브라질 정책금리"],
};
const rateNode = (series: RateSeries): RelationNode => ({ kind: "rate", key: `rate:${series}`, name: RATE[series][0], series, indicator: RATE[series][1] });
const macroNode = (kind: "cpi" | "jobs", country: "KR" | "US"): RelationNode => ({
  kind,
  key: `${kind}:${country}`,
  name: `${country === "US" ? "미국 " : ""}${kind === "cpi" ? "물가 상승률" : "실업률"}`,
  country,
});
const stockNode = (index: IndexName): RelationNode => ({ kind: "stock", key: `stock:${index}`, name: index, index });

const COUNTRY_NAME: Record<Country, string> = {
  KR: "한국", US: "미국", JP: "일본", GB: "영국", CA: "캐나다", AU: "호주", CH: "스위스", CN: "중국", BR: "브라질", EU: "유럽",
  DE: "독일", FR: "프랑스", IT: "이탈리아", ES: "스페인", IN: "인도", TW: "대만", VN: "베트남", RU: "러시아", MX: "멕시코", SG: "싱가포르", HK: "홍콩", WORLD: "해외",
};
const COUNTRY_WORDS: [RegExp, Country[]][] = [
  [/한\s*[·-]?\s*미/g, ["KR", "US"]],
  [/한국|국내|우리나라|한은|한국은행/g, ["KR"]],
  [/미국|연준|\bFed\b|FOMC|미\s*연방/gi, ["US"]],
  [/일본|일본은행|\bBOJ\b/gi, ["JP"]],
  [/영국/g, ["GB"]],
  [/캐나다/g, ["CA"]],
  [/호주/g, ["AU"]],
  [/스위스/g, ["CH"]],
  [/중국/g, ["CN"]],
  [/브라질/g, ["BR"]],
  [/유럽|유로존|\bECB\b/gi, ["EU"]],
  [/독일/g, ["DE"]],
  [/프랑스/g, ["FR"]],
  [/이탈리아/g, ["IT"]],
  [/스페인/g, ["ES"]],
  [/인도(?!네시아)/g, ["IN"]],
  [/대만/g, ["TW"]],
  [/베트남/g, ["VN"]],
  [/러시아/g, ["RU"]],
  [/멕시코/g, ["MX"]],
  [/싱가포르/g, ["SG"]],
  [/홍콩/g, ["HK"]],
  [/해외|글로벌|세계|각국|주요국/g, ["WORLD"]],
];
const POLICY_RATE: Partial<Record<Country, RateSeries>> = { KR: "BOK", US: "DFF", JP: "JP", GB: "GB", CA: "CA", AU: "AU", CH: "CH", CN: "CN", BR: "BR" };
/** 통화 → 상대국 정책금리. 유로 지역 정책금리는 금리 tool 에 없습니다 */
const FOREIGN_RATE: Record<Currency, RateSeries | null> = { USD: "DFF", JPY: "JP", EUR: null };

/** 관계를 묻는 말. "환율이 오르면 코스피는?" 처럼 한 지표가 움직이면 다른 지표가 어떻게 되는지 묻는 꼴도 봅니다 */
const RELATION = /상관|관계|연관|영향|같이\s*움직|따라\s*움직|함께\s*움직|반대로\s*움직|연동|(?:오르|올라가|내리|내려가|떨어지|하락하|상승하|높아지|낮아지|인상하|인하하|올리)면/;
/** 과거 연도 · 기간이나 짧은 기간을 정한 질문은 대상이 아닙니다. 이 틀은 "최근 1년" 만 비교합니다 (#128 Codex 리뷰) */
const OTHER_PERIOD = /(19|20)\d{2}\s*년|\d+\s*년\s*(전|간|동안)|작년|지난해|재작년|오늘|어제|이번\s*주|지난\s*주|한\s*달|석\s*달|\d+\s*(?:일|주일|개월)(?:간|동안|사이|전|의|(?![가-힣]))/;
/** 현물 지표로 답할 수 없는 질문(선물 · 옵션), 가상의 숫자를 든 질문(example-calc 가 맡음)은 대상이 아닙니다 */
const NOT_SERIES = /선물|옵션|스왑|파생|레버리지|인버스|\d+(?:\.\d+)?\s*(?:%|퍼센트|프로|원)/;

/** 질문이 말했지만 머핀이 받지 않는 것. 관계를 물은 지표가 하나뿐이어도 이것이 있으면 그 지표의 1년 비교와 일반 설명으로 답합니다 */
const UNAVAILABLE: [RegExp, string][] = [
  [/수입\s*물가/, "수입물가"],
  [/수출\s*물가/, "수출물가"],
  [/생산자\s*물가|\bPPI\b/i, "생산자물가"],
  [/예금|적금/, "예적금 금리"],
  [/대출|주담대|주택\s*담보|코픽스|COFIX/i, "대출 금리"],
  [/국고채|회사채|채권/, "채권 금리 · 가격"],
  [/집값|부동산|아파트|주택\s*가격/, "집값"],
  [/유가|기름값|원유|휘발유/, "국제 유가"],
  [/금값|금\s*(?:가격|시세)/, "금 가격"],
  [/\bGDP\b|성장률/i, "경제성장률"],
  [/임금|월급|연봉/, "임금"],
  [/위안/, "위안화 환율"],
];
/** "금리" 앞에 이 말이 붙으면 정책금리가 아닙니다 (예적금 · 대출 · 채권 금리는 UNAVAILABLE 로) */
const NOT_POLICY_RATE = /(?:예금|적금|대출|주담대|실질|채권|국고채|회사채|코픽스|CD|시장)\s*$/;

type Mention = { at: number; node: RelationNode | null };
type MacroNode = Extract<RelationNode, { kind: "cpi" | "jobs" }>;

/** at 바로 앞(12자 안)의 가장 가까운 나라 이름 */
function countryBefore(question: string, at: number): Country[] | null {
  let best: { end: number; countries: Country[] } | null = null;
  for (const [re, countries] of COUNTRY_WORDS) {
    for (const m of question.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      const end = m.index + m[0].length;
      if (end <= at && at - end <= 12 && (!best || end > best.end || (end === best.end && countries.length > best.countries.length))) best = { end, countries };
    }
  }
  return best?.countries ?? null;
}

/** 질문 전체에 나온 나라 (한 나라만 말했으면 나라 없는 지표도 그 나라로 봅니다: "미국 물가와 금리") */
function questionCountries(question: string): Country[] {
  const found = new Set<Country>();
  for (const [re, countries] of COUNTRY_WORDS) if (new RegExp(re.source, re.flags.replace("g", "")).test(question)) for (const c of countries) found.add(c);
  return [...found];
}

/**
 * 관계 질문이면 받을 지표와 받지 않는 것을 돌려줍니다. 아니면 null.
 * 대상: 관계를 묻는 말이 있고, 받을 지표가 둘 이상이거나(금리–코스피), 하나라도 받지 않는 것과 함께 물은 질문(환율–수입물가).
 */
export function relationPlan(question: string): RelationPlan | null {
  if (!RELATION.test(question) || OTHER_PERIOD.test(question) || NOT_SERIES.test(question)) return null;
  const all = questionCountries(question);
  const fallback = (kinds: Country[] | null): Country[] => kinds ?? (all.length === 1 ? all : ["KR"]);
  const mentions: Mention[] = [];
  const missing: string[] = [];
  const add = (at: number, node: RelationNode | null, miss?: string) => {
    if (miss) missing.push(miss);
    mentions.push({ at, node });
  };
  const named = (re: RegExp) => [...question.matchAll(re)];

  // 환율: 통화를 말했으면 그 통화, "환율 · 원화" 만 말했으면 원/달러
  const currencies: [RegExp, Currency][] = [[/달러/g, "USD"], [/엔화|엔\s*환율|원\s*\/?\s*엔|100\s*엔|\d*\s*엔당/g, "JPY"], [/유로(?!존)/g, "EUR"]];
  const currencyHits = currencies.flatMap(([re, currency]) => named(re).map((m) => ({ at: m.index, currency })));
  for (const h of currencyHits) add(h.at, FX[h.currency]);
  if (currencyHits.length === 0) for (const m of named(/환율|원화/g)) add(m.index, FX.USD);

  // 정책금리: 앞의 나라 이름으로 정합니다. "국채 · 10년" 이 붙은 미국 금리는 10년물. "한미 금리차" 는 두 나라 모두
  for (const m of question.matchAll(/(?:기준|정책)?\s*금리|연준|\bFed\b|FOMC/gi)) {
    const before = question.slice(Math.max(0, m.index - 8), m.index);
    if (/금리/.test(m[0]) && NOT_POLICY_RATE.test(before)) continue;
    const near = countryBefore(question, m.index) ?? (/연준|Fed|FOMC/i.test(m[0]) ? (["US"] as Country[]) : null);
    const after = question.slice(m.index + m[0].length, m.index + m[0].length + 3);
    const countries = near ?? (/^\s*(?:차|격차)/.test(after) ? (["KR", "US"] as Country[]) : fallback(null));
    for (const c of countries) {
      if (c === "US" && /국채|10\s*년|장기/.test(question.slice(Math.max(0, m.index - 10), m.index))) add(m.index, rateNode("DGS10"));
      else if (POLICY_RATE[c]) add(m.index, rateNode(POLICY_RATE[c]!));
      else add(m.index, null, `${COUNTRY_NAME[c]} 정책금리`);
    }
  }

  // 물가 · 실업률: 한국 · 미국만 받습니다. 수입 · 수출 · 생산자 물가는 UNAVAILABLE 로
  const macro: [RegExp, "cpi" | "jobs"][] = [[/(?<!수입\s*|수출\s*|생산자\s*)물가|인플레|\bCPI\b/gi, "cpi"], [/실업|고용|일자리|취업자/g, "jobs"]];
  for (const [re, kind] of macro) {
    for (const m of question.matchAll(re)) {
      for (const c of fallback(countryBefore(question, m.index))) {
        if (c === "KR" || c === "US") add(m.index, macroNode(kind, c));
        else add(m.index, null, `${COUNTRY_NAME[c]} ${kind === "cpi" ? "물가" : "실업률"}`);
      }
    }
  }

  // 주가지수: 지수 이름이 없으면 "주가 · 증시 · 주식" 을 한국은 코스피, 미국은 S&P 500 으로. 다른 나라 증시는 코스피로 바꾸지 않고 missing (#144 Codex 리뷰)
  const indexHits = INDEX_WORDS.map(([re, index]) => ({ at: question.search(re), index })).filter((h) => h.at >= 0);
  for (const h of indexHits) add(h.at, stockNode(h.index));
  // "해외 주식" 은 어느 지수인지 정할 수 없어 받지 않습니다
  if (indexHits.length === 0) {
    for (const m of named(/주가|증시|주식/g)) {
      if (/(?:해외|외국)\s*$/.test(question.slice(0, m.index))) continue;
      const c = fallback(countryBefore(question, m.index))[0]!;
      if (c === "KR" || c === "US") add(m.index, stockNode(c === "US" ? "S&P 500" : "코스피"));
      else add(m.index, null, `${COUNTRY_NAME[c]} 주가`);
    }
  }

  for (const [re, label] of UNAVAILABLE) if (re.test(question) && !missing.includes(label)) missing.push(label);

  const nodes: RelationNode[] = [];
  for (const m of mentions.sort((a, b) => a.at - b.at)) if (m.node && !nodes.some((n) => n.key === m.node!.key)) nodes.push(m.node);
  // 환율과 금리를 함께 물으면 두 나라 금리를 다 봅니다: 환율은 두 통화의 금리 차이와 함께 움직이는 일이 많아서 ("미국 금리가 환율에 미치는 영향" 에도 한국 기준금리)
  const fx = nodes.find((n) => n.kind === "fx");
  if (fx && fx.kind === "fx" && nodes.some((n) => n.kind === "rate")) {
    const foreign = FOREIGN_RATE[fx.currency];
    for (const series of [foreign, "BOK" as const]) if (series && !nodes.some((n) => n.key === `rate:${series}`)) nodes.push(rateNode(series));
    if (!foreign && !missing.includes("유럽 정책금리")) missing.push("유럽 정책금리");
  }
  const kept = nodes.slice(0, 4);
  return kept.length >= 2 || (kept.length === 1 && missing.length > 0) ? { nodes: kept, missing: [...new Set(missing)] } : null;
}

// ── 장부에서 1년 비교 항목 찾기 ──────────────────────────────────────────────

const YEAR_MIN_DAYS = 330;
const days = (from: unknown, to: unknown) => (Date.parse(String(to)) - Date.parse(String(from))) / 86_400_000;
const yoy = (e: Evidence) => e.values["latest.previousYear.change"];
const monthOf = (e: Evidence) => String(e.values["latest.month"] ?? "");
const monthIso = (m: string) => `${m.slice(0, 4)}-${m.slice(4, 6)}`;
const shiftMonth = (m: string, by: number) => {
  const total = Number(m.slice(0, 4)) * 12 + Number(m.slice(4, 6)) - 1 + by;
  return `${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, "0")}`;
};

const isFx = (e: Evidence, n: Extract<RelationNode, { kind: "fx" }>) => e.tool === areaTools.fx && e.values.pair === n.pair;
const isRate = (e: Evidence, n: Extract<RelationNode, { kind: "rate" }>) => e.tool === areaTools.rate && e.values.indicator === n.indicator;
const isMacro = (e: Evidence, n: MacroNode) =>
  e.tool === areaTools.macro && e.values.indicator === (n.kind === "cpi" ? "cpi" : "unemployment") && e.values.country === n.country && /^\d{6}$/.test(monthOf(e));
const isStock = (e: Evidence, n: Extract<RelationNode, { kind: "stock" }>) => (e.tool === INDEX_TOOL || e.tool === US_INDEX_TOOL) && e.values.index === n.index;

/** 이 지표의 장부 항목이면 true (기간과 상관없이). 같은 지표의 다른 기준 카드를 뺄 때 씁니다 */
function sameNode(e: Evidence, n: RelationNode): boolean {
  if (n.kind === "fx") return isFx(e, n);
  if (n.kind === "rate") return isRate(e, n);
  if (n.kind === "stock") return isStock(e, n);
  return isMacro(e, n);
}

/** 전년 같은 달 대비 값이 있는 가장 최근 관측 월의 물가와, 그 12개월 전 관측 월의 물가 (미국은 2025-10 자료가 비어 한 달 앞 달을 씁니다) */
export function cpiPair(evidence: Evidence[], country: "KR" | "US" = "KR"): { now?: Evidence; before?: Evidence } {
  const node = macroNode("cpi", country) as MacroNode;
  const rows = evidence.filter((e) => isMacro(e, node) && typeof yoy(e) === "number").sort((a, b) => monthOf(a).localeCompare(monthOf(b)));
  const now = rows.at(-1);
  if (!now) return {};
  return { now, before: rows.find((e) => monthOf(e) === shiftMonth(monthOf(now), -12)) };
}

/** 1년 전 값이 있는 가장 최근 관측 월의 실업률 */
function jobsItem(evidence: Evidence[], node: MacroNode): Evidence | undefined {
  return evidence
    .filter((e) => isMacro(e, node) && typeof e.values["latest.value"] === "number" && typeof e.values["latest.previousYear.value"] === "number" && typeof yoy(e) === "number")
    .sort((a, b) => monthOf(a).localeCompare(monthOf(b)))
    .at(-1);
}

export type RelationRow = {
  node: RelationNode;
  from: { date: string; value: number; ref: string };
  to: { date: string; value: number; ref: string };
  /** 방향을 정하는 변화. 환율 · 지수는 1년 변화율(%, 장부 값), 금리 · 실업률은 %p(장부 값), 물가 상승률은 두 상승률의 차이(방향에만 씀) */
  change: number;
};

function rowOf(evidence: Evidence[], node: RelationNode): RelationRow | null {
  if (node.kind === "fx") {
    const e = evidence.find((x) => isFx(x, node) && typeof x.values.changePct === "number" && days(x.values["comparison.asOf"], x.values.asOf) >= YEAR_MIN_DAYS);
    return e ? { node, from: { date: String(e.values["comparison.asOf"]), value: Number(e.values["comparison.rate"]), ref: e.id }, to: { date: String(e.values.asOf), value: Number(e.values.rate), ref: e.id }, change: Number(e.values.changePct) } : null;
  }
  if (node.kind === "rate") {
    const e = evidence.find((x) => isRate(x, node) && Number(x.values.requestedDays) === 365);
    return e ? { node, from: { date: String(e.values.comparisonDate), value: Number(e.values.comparisonRate), ref: e.id }, to: { date: String(e.values.asOf), value: Number(e.values.rate), ref: e.id }, change: Number(e.values.changePp) } : null;
  }
  if (node.kind === "stock") {
    const e = evidence.find((x) => isStock(x, node) && typeof x.values["period.returnPct"] === "number" && days(x.values["period.from"], x.values["period.to"]) >= YEAR_MIN_DAYS);
    return e ? { node, from: { date: String(e.values["period.from"]), value: Number(e.values["period.closeFrom"]), ref: e.id }, to: { date: String(e.values["latest.date"]), value: Number(e.values["latest.close"]), ref: e.id }, change: Number(e.values["period.returnPct"]) } : null;
  }
  if (node.kind === "cpi") {
    const { now, before } = cpiPair(evidence, node.country);
    if (!now || !before) return null;
    return { node, from: { date: monthIso(monthOf(before)), value: yoy(before) as number, ref: before.id }, to: { date: monthIso(monthOf(now)), value: yoy(now) as number, ref: now.id }, change: (yoy(now) as number) - (yoy(before) as number) };
  }
  const e = jobsItem(evidence, node);
  return e ? { node, from: { date: monthIso(String(e.values["latest.previousYear.month"] ?? shiftMonth(monthOf(e), -12))), value: Number(e.values["latest.previousYear.value"]), ref: e.id }, to: { date: monthIso(monthOf(e)), value: Number(e.values["latest.value"]), ref: e.id }, change: yoy(e) as number } : null;
}

/**
 * 받은 지표들의 1년 비교. 받지 못한 지표는 빠집니다. 최신 시점이 다른 것들보다 다섯 달 넘게 이른 줄도 뺍니다
 * (과거 물가에 지금 금리를 나란히 놓지 않게. 물가는 한두 달 늦게 발표되므로 다섯 달까지는 같은 시점으로 봅니다)
 */
export function relationRows(evidence: Evidence[], plan: RelationPlan): RelationRow[] {
  const rows = plan.nodes.map((n) => rowOf(evidence, n)).filter((r): r is RelationRow => r !== null);
  const latest = Math.max(...rows.map((r) => Date.parse(r.to.date)));
  return rows.filter((r) => latest - Date.parse(r.to.date) <= 150 * 86_400_000);
}

/**
 * 작성에게 보이지 않게 할 항목: 1년 비교에 쓴 것 말고 같은 지표의 다른 기간 항목(조사가 받은 30일 환율 등)과 그것으로 만든 계산.
 * 카드는 1년인데 요약은 30일 값을 쓰는 일이 있었습니다 (11/23 점검: 엔화 카드 1년 -10.53%, 요약 "최근 30일 0.55% 내렸어요").
 * 같은 지표를 한 기준으로만 보게 합니다. 검증은 장부 전체로 하므로 값이 사라지지는 않습니다. 기사로 검산한 당일 지수 종가는 남깁니다.
 */
export function relationHidden(evidence: Evidence[], plan: RelationPlan): Set<string> {
  const rows = relationRows(evidence, plan);
  const used = new Set(rows.flatMap((r) => [r.from.ref, r.to.ref]));
  const hidden = new Set(evidence.filter((e) => !used.has(e.id) && rows.some((r) => sameNode(e, r.node))).map((e) => e.id));
  for (const e of evidence) if (e.tool !== INDEX_TODAY_TOOL && e.lineage?.inputs.some((id) => hidden.has(id))) hidden.add(e.id);
  return hidden;
}

/** 정제가 뺐더라도 작성이 보는 항목들 (extra-facts) */
export function relationRefs(evidence: Evidence[], plan: RelationPlan): string[] {
  return [...new Set(relationRows(evidence, plan).flatMap((r) => [r.to.ref, r.from.ref]))];
}

// ── 모자란 자료 채우기 ──────────────────────────────────────────────────────

/**
 * 관계 질문이면 지표마다 1년 비교 자료 중 없는 것을 받습니다. 대상 질문이 아니면 아무것도 부르지 않고 null.
 * 실패해도 리포트는 이어집니다 (error step 만 남음). 분류가 고르지 않은 tool 도 부르므로 tools 는 레지스트리 전체를 받고,
 * 지수 tool 은 레지스트리에 없어 직접 부릅니다 (index-quote 와 같음).
 */
export async function ensureRelation(ctx: ResearchContext, question: string, tools: readonly InvokableTool[], indexTools: { kr: InvokableTool; us: InvokableTool } = { kr: krIndexTool as unknown as InvokableTool, us: usIndexTool as unknown as InvokableTool }): Promise<RelationPlan | null> {
  const plan = relationPlan(question);
  if (!plan) return null;
  const tool = (name: string) => tools.find((t) => t.name === name);
  const rc = new RunContext(ctx);
  const call = (t: InvokableTool | undefined, args: object) => (t ? t.invoke(rc, JSON.stringify(args)).catch(() => undefined) : undefined);
  const latestMacro = (node: MacroNode) =>
    ctx.evidence.filter((e) => isMacro(e, node)).sort((a, b) => monthOf(a).localeCompare(monthOf(b))).at(-1);

  await Promise.all(
    plan.nodes.map(async (node) => {
      if (rowOf(ctx.evidence, node)) return;
      if (node.kind === "fx") return call(tool(areaTools.fx), { currency: node.currency, days: 365 });
      if (node.kind === "rate") return call(tool(areaTools.rate), { series: node.series, days: 365 });
      if (node.kind === "stock") return call(isUs(node.index) ? indexTools.us : indexTools.kr, { index: node.index, days: 365 });
      const macro = tool(areaTools.macro);
      const indicator = node.kind === "cpi" ? "cpi" : "unemployment";
      const get = (endMonth: string | null) => call(macro, { country: node.country, indicator, endMonth, months: 1 });
      // 최신 관측 월을 받고, 그 달의 1년 전 값이 비어 있으면(미국 2025-10) 한 달 앞 달을 받습니다
      if (!latestMacro(node)) await get(null);
      const latest = latestMacro(node);
      if (!latest) return;
      const ready = node.kind === "cpi" ? cpiPair(ctx.evidence, node.country).now : jobsItem(ctx.evidence, node);
      if (!ready && typeof yoy(latest) !== "number") await get(shiftMonth(monthOf(latest), -1));
      // 물가는 "1년 전의 상승률" 이 또 필요합니다 (12개월 전 관측 월)
      if (node.kind === "cpi") {
        const { now, before } = cpiPair(ctx.evidence, node.country);
        if (now && !before) await get(shiftMonth(monthOf(now), -12));
      }
    }),
  );
  return plan;
}

// ── 작성 안내 · 카드 · 한 줄 요약 ─────────────────────────────────────────────

const won = (n: number) => n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedPct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const pp = (d: number) => (Math.abs(d) < 0.005 ? "변동 없음" : `${d > 0 ? "+" : ""}${d.toFixed(2)}%p`);
const isPrice = (n: RelationNode) => n.kind === "fx" || n.kind === "stock";
/** 값 한 개를 장부 표기대로: 환율은 원, 지수는 포인트 없이, 물가 상승률은 소수 둘째 자리, 금리 · 실업률은 그대로 */
function fmt(n: RelationNode, v: number): string {
  if (n.kind === "fx") return `${won(v)}원`;
  if (n.kind === "stock") return points(v);
  if (n.kind === "cpi") return `${v.toFixed(2)}%`;
  return `${v}%`;
}
const flat = (r: RelationRow) => Math.abs(r.change) < 0.005;
const up = (r: RelationRow) => r.change > 0;

function rowLine(r: RelationRow): string {
  const { node, from, to } = r;
  const refs = from.ref === to.ref ? `${from.date} ${fmt(node, from.value)} → ${to.date} ${fmt(node, to.value)} (ref ${to.ref})` : `${from.date} ${fmt(node, from.value)} (ref ${from.ref}) → ${to.date} ${fmt(node, to.value)} (ref ${to.ref})`;
  const change = isPrice(node) ? `, 1년 변화 ${signedPct(r.change)}` : node.kind === "cpi" ? "" : `, 1년 ${pp(r.change)}`;
  const way = flat(r) ? "그대로입니다" : node.kind === "fx" ? (up(r) ? "올랐습니다 (원화가 약해진 방향)" : "내렸습니다 (원화가 강해진 방향)") : up(r) ? (isPrice(node) ? "올랐습니다" : "높아졌습니다") : isPrice(node) ? "내렸습니다" : "낮아졌습니다";
  return `- ${node.name}: ${refs}${change}. 1년 사이 ${way}`;
}

/** 한국 기준금리와 상대국 정책금리가 함께 있으면, 두 금리 차이가 1년 사이 어떻게 됐는지 (숫자는 쓰지 않음: 장부에 없는 값) */
function gapLine(rows: RelationRow[]): string {
  const bok = rows.find((r) => r.node.key === "rate:BOK");
  const other = rows.find((r) => r.node.kind === "rate" && r.node.key !== "rate:BOK" && r.node.key !== "rate:DGS10");
  if (!bok || !other) return "";
  const country = other.node.name.split(" ")[0]!;
  const now = other.to.value - bok.to.value;
  const before = other.from.value - bok.from.value;
  if (Math.sign(now) !== Math.sign(before) && now !== 0 && before !== 0) return `- 두 나라 금리의 높고 낮음이 1년 사이 바뀌었습니다 (지금은 ${now > 0 ? country : "한국"} 금리가 더 높습니다).`;
  const [hi, lo] = now >= 0 ? [country, "한국"] : ["한국", country];
  const way = Math.abs(Math.abs(now) - Math.abs(before)) < 0.005 ? "그대로입니다" : Math.abs(now) > Math.abs(before) ? "벌어졌습니다" : "좁혀졌습니다";
  return `- ${hi} 금리가 ${lo}보다 높은 폭은 1년 사이 ${way}. 이 폭을 숫자로 쓰려면 장부의 계산 항목(C 번호)이 있을 때만 씁니다.`;
}

const has = (rows: RelationRow[], kind: Kind) => rows.some((r) => r.node.kind === kind);
/**
 * 조합마다의 일반적인 관계. 작성은 "일반적으로" 라고 밝혀 쓰고, 이번 1년이 그 설명대로였는지를 값으로 말합니다.
 * 새 조합은 여기에 한 줄을 더합니다. 투자 권유 · 전망 표현은 넣지 않습니다.
 */
function generalLines(rows: RelationRow[], missing: string[]): string[] {
  const lines: string[] = [];
  const fx = rows.find((r) => r.node.kind === "fx")?.node;
  const currency = fx?.kind === "fx" ? fx.currency : "USD";
  const foreign = COUNTRY_NAME[currency === "USD" ? "US" : currency === "JPY" ? "JP" : "EU"];
  const money = { USD: "달러", JPY: "엔화", EUR: "유로" }[currency];
  const stocks = rows.filter((r) => r.node.kind === "stock").map((r) => r.node);
  const usStock = stocks.some((n) => n.kind === "stock" && isUs(n.index));
  const krStock = stocks.some((n) => n.kind === "stock" && !isUs(n.index));
  if (fx && has(rows, "rate")) lines.push(`${foreign} 금리가 한국보다 높아질수록 ${money}를 가지려는 수요가 늘어 ${fx.name}이 오르기 쉽다`);
  if (has(rows, "cpi") && has(rows, "rate")) lines.push("물가가 오르면 중앙은행이 금리를 올려 대응하고, 물가가 안정되면 금리를 내리는 일이 많다");
  if (has(rows, "rate") && stocks.length) lines.push("금리가 오르면 기업의 이자 부담과, 미래 이익을 지금 가치로 바꿀 때 쓰는 할인율이 커져 주가에 부담이 되기 쉽고, 기술주 비중이 큰 지수일수록 더 민감한 편이다");
  if (fx && krStock) lines.push("원화가 약해지면(환율 상승) 외국인 투자자의 환차손 우려로 국내 증시에서 자금이 빠지기 쉬워 코스피와 환율이 반대로 움직이는 때가 많다. 다만 수출 기업 실적에는 도움이 되기도 한다");
  if (fx && usStock) lines.push("해외 지수를 따르는 상품에 원화로 투자하면(환헤지를 하지 않는 상품) 원화 기준 수익률은 지수 수익률에 환율 변화가 더해진 것에 가깝다. 환율이 오르면 더해지고 내리면 깎인다");
  if (has(rows, "cpi") && has(rows, "jobs")) lines.push("경기가 좋아 실업률이 낮아지면 물가가 오르기 쉽다는 설명(필립스 곡선)이 있지만, 늘 들어맞지는 않는다");
  if (has(rows, "jobs") && has(rows, "rate")) lines.push("고용이 약해지면(실업률 상승) 중앙은행이 금리를 내려 경기를 받치려는 일이 많다");
  if (has(rows, "cpi") && fx) lines.push("환율이 오르면 수입품 가격이 올라 시간을 두고 소비자물가에 반영되기 쉽다");
  if (has(rows, "cpi") && stocks.length && !has(rows, "rate")) lines.push("물가가 높게 이어지면 금리 인상 우려로 주가에 부담이 되기 쉽다");
  if (krStock && usStock) lines.push("나라마다 증시는 같은 방향으로 움직이는 때가 많지만, 업종 구성과 환율에 따라 폭은 다르다");
  if (fx && missing.includes("수입물가")) lines.push("환율이 오르면 같은 달러 가격의 수입품을 원화로 더 많이 주고 사야 해 수입물가가 오르기 쉽다");
  if (has(rows, "rate") && missing.includes("예적금 금리")) lines.push("기준금리가 내리면 은행 예적금 금리도 시차를 두고 따라 내리는 일이 많다");
  if (has(rows, "rate") && missing.includes("대출 금리")) lines.push("기준금리가 오르내리면 변동금리 대출의 금리도 시차를 두고 따라가는 일이 많다");
  if (has(rows, "rate") && missing.includes("채권 금리 · 가격")) lines.push("금리가 오르면 이미 발행된 채권의 가격은 내려간다");
  return lines.map((l) => `- 일반적으로 ${l}.`);
}

/** 작성 입력에 붙이는 [지표 나란히]. 값을 직접 적어 정제가 뺐더라도 작성이 볼 수 있게 합니다 (검증은 장부 전체로 대조) */
export function relationNote(evidence: Evidence[], plan: RelationPlan): string {
  const rows = relationRows(evidence, plan);
  if (rows.length === 0) return "";
  const names = plan.nodes.map((n) => n.name).concat(plan.missing).join(" · ");
  const lines = [`[지표 나란히] 질문은 ${names}의 관계를 물었습니다. 상관계수는 계산하지 않았지만, 지난 1년 각 지표의 움직임을 나란히 볼 수 있습니다.`, ...rows.map(rowLine)];
  if (rows.length === 2) {
    const [a, b] = rows as [RelationRow, RelationRow];
    lines.push(`- 방향: ${flat(a) || flat(b) ? (flat(a) && flat(b) ? "두 지표 모두 그대로였습니다" : "한 지표만 움직였습니다") : up(a) === up(b) ? "두 지표가 같은 방향으로 움직였습니다" : "두 지표가 반대 방향으로 움직였습니다"}.`);
  }
  const gap = gapLine(rows);
  if (gap) lines.push(gap);
  const lost = plan.nodes.filter((n) => !rows.some((r) => r.node.key === n.key));
  if (lost.length) lines.push(`- ${lost.map((n) => n.name).join(" · ")}의 1년 비교 자료는 받지 못했습니다. 확인하지 못한 것에 한 줄로 적습니다.`);
  if (plan.missing.length) {
    const asked = plan.missing.map((m) => `"${m}"`).join(" · ");
    lines.push(
      `- 질문의 ${asked}은(는) 머핀이 받는 자료가 아닙니다. "확인하지 못한 것" 에 한 줄로만 적고, 요약 · 한 줄 요약에 "자료가 없어 확인할 수 없어요" 를 쓰지 않습니다.`,
      `  요약은 받은 지표의 1년 변화로 시작하고, 아래 일반적인 관계대로라면 그 변화가 ${asked}에 어느 쪽으로 작용하는지 씁니다. 그 쪽은 일반적인 관계에서 나온 것이지 확인한 값이 아니라고 한 번 밝힙니다.`,
    );
  }
  const general = generalLines(rows, plan.missing);
  lines.push(`요약의 첫 문장은 이 1년 비교를 두 시점의 값과 함께 씁니다. "상관관계는 확인할 수 없어요 · 판단하기 어려워요" 로 시작하거나 한 줄 요약을 그 말로 끝내지 않습니다.`);
  if (general.length) {
    lines.push(`아래는 이 조합의 일반적인 관계입니다. 쓸 때는 "일반적으로" 라고 밝히고, 이번 1년이 그 설명대로 움직였는지 반대였는지를 위 값으로 말합니다. 이번 움직임의 원인이라고 쓰지 않고, 일반적인 관계를 "자료로 확인되지 않았다" 고 쓰지 않습니다. 일반적인 관계는 요약 · 생활 영향에 쓰고 원인(why) 칸에는 넣지 않습니다.`, ...general);
  }
  lines.push(`두 시점을 비교한 것이라 통계적 상관관계나 인과관계를 뜻하지 않는다는 점은 주의점에 한 번만 쓰고, 요약 · 확인하지 못한 것에서 되풀이하지 않습니다. 숫자 카드는 코드가 넣으므로 이 지표들의 카드는 쓰지 않아도 됩니다.`);
  return lines.join("\n");
}

function cardsOf(r: RelationRow): WriterOutput["numbers"] {
  const { node, from, to } = r;
  if (node.kind === "fx") return [{ label: node.card, value: fmt(node, to.value), change: `1년 ${signedPct(r.change)}`, asOf: to.date, ref: to.ref }];
  if (node.kind === "stock") return [{ label: `${node.index} 종가`, value: fmt(node, to.value), change: `1년 ${signedPct(r.change)}`, asOf: to.date, ref: to.ref }];
  if (node.kind === "rate") return [{ label: node.indicator, value: fmt(node, to.value), change: `1년 ${pp(r.change)}`, asOf: to.date, ref: to.ref }];
  if (node.kind === "jobs") return [{ label: `${node.name} (${to.date})`, value: fmt(node, to.value), change: `1년 ${pp(r.change)}`, asOf: to.date, ref: to.ref }];
  return [
    { label: `${node.name} (${to.date}, 전년 같은 달 대비)`, value: fmt(node, to.value), change: "", asOf: to.date, ref: to.ref },
    { label: `${node.name} (1년 전, ${from.date})`, value: fmt(node, from.value), change: "", asOf: from.date, ref: from.ref },
  ];
}

/**
 * 지표마다의 1년 비교 카드를 "오늘의 숫자" 맨 앞에 넣습니다. 작성이 같은 지표로 쓴 카드(30일 비교 · 지수 수준 등)와 그 항목으로 만든 계산 카드는
 * 빼서 같은 지표가 다른 기준으로 겹쳐 나오지 않게 합니다 (11/21 실측: 1년 전 물가 상승률과 지금 금리의 차이 카드). 기사로 검산한 당일 지수 종가는 남깁니다.
 * 값은 장부 그대로라 검증을 통과합니다. 비교할 자료가 없으면 받은 그대로 돌려줍니다.
 */
export function withRelationNumbers(output: WriterOutput, evidence: Evidence[], plan: RelationPlan): WriterOutput {
  const rows = relationRows(evidence, plan);
  if (rows.length === 0) return output;
  const same = new Set(evidence.filter((e) => rows.some((r) => sameNode(e, r.node))).map((e) => e.id));
  for (const e of evidence) if (e.tool !== INDEX_TODAY_TOOL && e.lineage?.inputs.some((id) => same.has(id))) same.add(e.id);
  return { ...output, numbers: [...rows.flatMap(cardsOf), ...output.numbers.filter((n) => !(n.ref && same.has(n.ref)))] };
}

/** 이름 뒤의 은/는. 한글은 받침으로, 숫자 · 영문은 읽는 소리로 ("S&P 500은", "LPR은") */
function topic(name: string): string {
  const last = name.replace(/[\s)]+$/, "").at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  const batchim = code >= 0 && code <= 11171 ? code % 28 !== 0 : /[0136789LMNR]/i.test(last);
  return `${name}${batchim ? "은" : "는"}`;
}

const NEGATIVE_HEADLINE = new RegExp(`${NEGATIVE.source}|자료가?\\s*부족|판단하기\\s*엔|분리해\\s*확인|인과|(?:뜻|의미)하(?:지|진)\\s*않`);
/** 값이 적힌 숫자 ("3.88%", "9.27%", "1,335.94원", "0.50%p"). "지난 1년" 의 1 은 값이 아닙니다 */
const VALUE = /\d[\d,]*(?:\.\d+)?\s*(?:%|원|포인트|bp)/;

/**
 * 관계 질문의 한 줄 요약이 없거나, 부정문("…단정할 수 없어요 · 자료가 부족해요")이거나, 숫자 없는 일반론이면 장부 값으로 만든 한 줄로 바꿉니다
 * (11/22 실측: 1년 비교를 주고도 한 줄이 "금리 차이는 환율에 영향을 줄 수 있지만 … 단정할 수는 없어요"). 값은 숫자 카드와 같습니다.
 */
export function relationHeadline(headline: string | null | undefined, evidence: Evidence[], plan: RelationPlan): string | null | undefined {
  if (headline && !NEGATIVE_HEADLINE.test(headline) && VALUE.test(headline)) return headline;
  const rows = relationRows(evidence, plan);
  if (rows.length === 0) return headline;
  const parts = rows.map((r) => {
    const { node, from, to } = r;
    if (flat(r)) return isPrice(node) ? `${topic(node.name)} 그대로였` : `${topic(node.name)} ${fmt(node, to.value)}로 그대로였`;
    const verb = up(r) ? "올랐" : "내렸";
    return isPrice(node) ? `${topic(node.name)} ${Math.abs(r.change).toFixed(2)}% ${verb}` : `${topic(node.name)} ${fmt(node, from.value)}에서 ${fmt(node, to.value)}로 ${verb}`;
  });
  return `지난 1년 ${parts.map((p, i) => `${p}${i === parts.length - 1 ? "어요." : "고"}`).join(", ")}`;
}

const CAUSAL = /(?:상관|인과)\s*관계|원인|관계를|관계\s*때문|때문이라고|일으켰/;
/** 한계를 말하는 끝: "…뜻하지는 않아요 · 말할 수는 없어요 · 볼 수는 없어요 · 입증할 수는 없어요" */
const LIMIT = new RegExp(`${NEGATIVE.source}|(?:뜻|의미)하(?:지|진)(?:는|도)?\\s*않|(?:말|판단|입증|단정|설명)할\\s*수\\s*(?:는|도)?\\s*없|볼\\s*수\\s*(?:는|도)?\\s*없`);
const CAUSAL_CAVEAT = "두 시점을 비교한 것이라 통계적 상관관계나 인과관계를 뜻하지는 않아요.";
/** "-지만" 앞 구절을 해요체로 끝맺기. 과거형(했 · 였)과 흔한 끝(있 · 없 · 쉽 · 않 · 같 · 많 · 하)만 바꾸고, 나머지는 null (어미를 안전하게 바꿀 수 없음) */
const POLITE: [string, string][] = [["있", "있어요"], ["없", "없어요"], ["않", "않아요"], ["같", "같아요"], ["많", "많아요"], ["쉽", "쉬워요"], ["어렵", "어려워요"], ["하", "해요"]];
function politeEnd(head: string): string | null {
  if (endsPast(head)) return `${head}어요.`;
  const hit = POLITE.find(([end]) => head.endsWith(end));
  return hit ? `${head.slice(0, -hit[0].length)}${hit[1]}.` : null;
}

/**
 * 한계 문장 정리. "A지만, (한계)" 꼴이면 A 만 해요체로 남기고, "(한계)고, B" 꼴이면 B 만 남깁니다.
 * 그 밖에 한계만 말한 문장은 null(뺌). 값이 든 문장과 일반적인 관계를 말한 문장은 그대로 둡니다.
 */
function cutLimit(sentence: string, about: (s: string) => boolean): string | null {
  if (!about(sentence) || !LIMIT.test(sentence)) return sentence;
  const trimmed = sentence.trim();
  const tail = /^(.+?)(?:지만|으나|는데|으며),?\s+([^.]*)\.?$/.exec(trimmed);
  if (tail && about(tail[2]!) && LIMIT.test(tail[2]!) && !LIMIT.test(tail[1]!)) {
    const head = politeEnd(tail[1]!);
    if (head) return head;
  }
  const lead = /^(.+?(?:없|않|어렵))(?:고|으며),\s*(.+)$/.exec(trimmed);
  if (lead && about(lead[1]!) && LIMIT.test(lead[1]!) && !LIMIT.test(lead[2]!)) return lead[2]!;
  return VALUE.test(sentence) || /일반적으로/.test(sentence) ? sentence : null;
}

/**
 * 관계 질문 요약에서 되풀이되는 한계 문장을 정리합니다 (검증 뒤, 사실은 바꾸지 않음). 11/23 점검 12문항 중 7개가 요약 끝에
 * "두 시점만으로 상관관계나 인과관계를 판단할 수는 없어요" 를 쓰고 주의점에도 같은 말을 썼습니다 ("확인하지 못한 것이 너무 반복된다", 11/21).
 *  - 상관 · 인과관계 한계: 요약에서 빼고 주의점에 한 번만 둡니다 (주의점에 없으면 한 줄 넣음)
 *  - 받지 않는 지표("수입물가 자료가 없어 확인할 수 없어요"): 요약에서 빼고 확인하지 못한 것에 한 번만 둡니다 (없으면 그 문장을 옮김)
 * 요약이 비게 되면 받은 그대로 돌려줍니다.
 */
export function trimRelationRepeats(output: WriterOutput, plan: RelationPlan): WriterOutput {
  const missingRes = UNAVAILABLE.filter(([, label]) => plan.missing.includes(label)).map(([re]) => re);
  const aboutMissing = (s: string) => missingRes.some((re) => re.test(s));
  const causal = (s: string) => CAUSAL.test(s);
  let caveats = output.caveats;
  let dataGaps = output.dataGaps;
  const paragraphs = output.summary.split(/\n{2,}/).map((p) => {
    const kept: string[] = [];
    for (const s of p.split(/(?<=[.!?])\s+/).filter(Boolean)) {
      let t = cutLimit(s, causal);
      if (t !== s && !caveats.some(causal)) caveats = [...caveats, CAUSAL_CAVEAT];
      if (t !== null && missingRes.length) {
        const cut = cutLimit(t, aboutMissing);
        if (cut !== t && !dataGaps.some(aboutMissing)) dataGaps = [...dataGaps, `질문의 ${plan.missing.map((m) => `"${m}"`).join(" · ")}은(는) 머핀이 받는 자료가 아니라 확인하지 못했어요.`];
        t = cut;
      }
      if (t) kept.push(t);
    }
    return kept.join(" ");
  });
  // 날짜 뒤에 붙은 "년" 을 뗍니다 ("2025-11-17년 0.50%", 11/23 점검 8번)
  const summary = paragraphs.filter(Boolean).join("\n\n").replace(/(\d{4}-\d{2}-\d{2})년/g, "$1");
  if (!summary.trim()) return output;
  return summary === output.summary && caveats === output.caveats && dataGaps === output.dataGaps ? output : { ...output, summary, caveats, dataGaps };
}
