/**
 * ④ 검증 (코드). 모델을 쓰지 않습니다 (원인의 근거 판정은 3단계).
 *
 *  - 숫자: numbers 의 모든 숫자를 ref 가 가리키는 증거 장부 항목의 값과 대조합니다.
 *    정책은 엄격한 순서로 정확 일치 / 표기 반올림 / 단위 환산(비율 ↔ %, %p ↔ bp) / 허용오차(상대 0.1%) 이고,
 *    표기 단위와 장부 키의 단위가 호환돼야 합니다 (25bp 는 25% 가 아닙니다). 정책에 없는 차이는 실패입니다.
 *    부호 대신 하락 낱말로 쓴 변화량("34.69원 낮아")은 장부의 음수 값과 맞춰 보고, 환율 기준 단위("1달러당")는 숫자로 보지 않습니다.
 *  - 본문: summary · why · impact · caveats 에 쓴 금융 숫자(단위 · 소수점 · 천 단위 쉼표가 있는 것)도 장부 어딘가에 있어야 합니다.
 *  - 원인: refs 가 장부에 있는 id 인지, basis(data · news · none)가 refs 와 맞는지 봅니다.
 *  - 권유: guard.ts 의 표현 목록.
 *
 * 결과는 두 번 쓰입니다. 실패 목록을 작성 Agent 에게 돌려 1회 수정시키고(muffin.ts),
 * 그래도 남은 실패는 applyVerification 이 리포트에서 빼거나 낮춥니다 (fail-closed: 검증 안 된 숫자는 화면에 나가지 않음).
 */
import { findAdvice, hasAdvice, stripAdvice } from "./guard";
import { UNSUPPORTED_EVIDENCE, summarizeWhy } from "./report";
import type { Evidence, NumberCheck, Verification, WriterOutput } from "./schema";

export type MatchPolicy = "exact" | "rounded" | "scaled" | "tolerance";

/** 표기 반올림 외에 허용하는 상대 오차. 환율 소수 셋째 자리 같은 차이를 위한 것이고, 숫자가 다른 것은 걸립니다. */
export const RELATIVE_TOLERANCE = 0.001;

/** 데이터 값이 아닌 숫자의 단위: 비교 기간 · 날짜 · 횟수. 검증 대상에서 뺍니다. */
const PERIOD_UNITS = new Set(["일", "개월", "년", "주", "월", "분기", "회", "건", "개", "번"]);
const MAGNITUDE: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3, 백: 1e2 };
/** "천억", "백만" 처럼 이어 쓴 자릿수 단위의 배율. */
function magnitudeOf(unit: string): number {
  return [...unit].reduce((acc, ch) => acc * (MAGNITUDE[ch] ?? 1), 1);
}
const isMagnitude = (unit: string) => /^[조억만천백]+$/.test(unit);
/** 통화 단위. 표기에 붙으면 장부의 % · bp 값과는 맞춰 보지 않습니다. */
const CURRENCY_UNITS = new Set(["원", "달러", "엔", "유로", "위안", "파운드"]);
/** 금융 값이 아닌 장부 키: 비교 기간 · 관측 수 · 요청 개수. "30%" 가 requestedDays 30 과 맞는 일을 막습니다. */
const META_KEY = /days|months|weeks|years|count|limit|window|length|size|turns?$|^requested/i;

export type ParsedNumber = {
  value: number;
  /** "%", "%p", "bp", "원", "일" 같은 단위. 없으면 빈 문자열 */
  unit: string;
  /** 원문 표기 ("1,392.40", "-0.5"). 반올림 자릿수를 세는 데 씁니다 */
  text: string;
  /** 부호 없이 쓰고 바로 뒤에 하락 낱말이 붙은 숫자 ("34.69원 낮아졌습니다"). 장부의 음수 값과도 맞춰 봅니다 */
  falling?: true;
};

const TOKEN = /([-+−]?)(\d[\d,]*(?:\.\d+)?)\s*([조억만천백]+|%p|%|bp|원|달러|엔|유로|위안|파운드|포인트|개월|분기|일|년|주|월|회|건|개|번)?/g;
/**
 * 숫자 바로 뒤에 붙어 부호 대신 하락폭을 뜻하는 말. "34.69원 낮아" · "2.55% 하락" · "1,080원가량 떨어져" · "(2.55%) 낮아".
 * "21.47%로 하락" 처럼 로 · 으로 · 까지가 붙은 숫자는 하락폭이 아니라 도착한 수준이라 해당하지 않습니다.
 */
const FALLING = /^\s*\)?\s*(?:가량|정도|만큼|씩|이나|나|이|가)?\s*(?:낮|하락|내려|내렸|내린|내리|떨어|감소|줄었|줄어|줄며|축소)/;

/**
 * 환율을 읽는 기준 단위인지. "1달러당 1,324원" · "100엔당 912원" · "1달러에 1,324원" · "같은 1달러를 사는 데" 의 외화 금액은 데이터 숫자가 아닙니다.
 * 뒤에 "당" 이 붙거나, 기준 금액(1달러 · 100엔) 뒤에 "에 <숫자>" · "를 사다 · 바꾸다 · 환전" 이 올 때만 기준 단위로 봅니다. "유가가 1달러 하락" 은 숫자입니다.
 */
function isQuoteBasis(value: number, unit: string, rest: string): boolean {
  if (unit === "원" || !CURRENCY_UNITS.has(unit)) return false;
  if (/^\s*당/.test(rest)) return true;
  const unitAmount = value === 1 || (unit === "엔" && value === 100);
  return unitAmount && /^\s*(?:에\s*\d|[을를]\s*(?:사|살|바꾸|바꿀|환전))/.test(rest);
}

/**
 * 문자열에서 숫자를 모두 뽑습니다. "1,392.40원" → 1392.4 원 / "-38.1원 (-2.79%)" → -38.1 원, -2.79 % /
 * "1조 2,000억 원" → 1.2e12 원 / "0.88%p" → 0.88 %p / "30일 +2.00%" → 30 일, 2 % / "34.69원 낮아" → 34.69 원 (falling).
 * 날짜(2026-10-22) · 연월(2026-08) · 지수 기준 "(2020=100)" · 환율 기준 단위("1달러당")는 뺍니다.
 */
export function extractNumbers(text: string): ParsedNumber[] {
  const cleaned = text
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\b\d{4}-(?:0[1-9]|1[0-2])\b/g, " ")
    .replace(/\(\s*\d{4}\s*(?:년)?\s*=\s*100\s*\)/g, " ");
  const out: ParsedNumber[] = [];
  let group: ParsedNumber | null = null;
  let groupSign = 1;
  let lastMagnitude = Infinity;

  for (const m of cleaned.matchAll(TOKEN)) {
    const sign = m[1] === "-" || m[1] === "−" ? -1 : 1;
    const digits = m[2].replace(/,/g, "");
    const unit = m[3] ?? "";
    const value = sign * Number(digits);

    if (isMagnitude(unit)) {
      // "1조 2,000억" · "1조 2천억" 처럼 자릿수가 줄어들며 이어지는 단위는 하나의 숫자로 합칩니다. 부호는 맨 앞 것이 금액 전체에 걸립니다 (-1조 2,000억 = -1.2조).
      // 통화 단위가 이미 붙었거나, 새 부호가 있거나, 자릿수가 커지면("3,500만 원과 2억") 새 금액입니다.
      const factor = magnitudeOf(unit);
      const magnitude = Number(digits) * factor;
      const continues = group !== null && group.unit === "" && m[1] === "" && factor < lastMagnitude;
      if (continues && group) {
        group.value += groupSign * magnitude;
        group.text += ` ${m[2]}${unit}`;
      } else {
        if (group) out.push(group);
        groupSign = sign;
        group = { value: sign * magnitude, unit: "", text: `${m[2]}${unit}` };
      }
      lastMagnitude = factor;
      // 그룹 뒤에 통화 단위가 붙어 있으면 단위로 삼습니다.
      const rest = cleaned.slice((m.index ?? 0) + m[0].length);
      const currency = /^\s*(원|달러|엔|유로|위안|파운드)/.exec(rest);
      if (currency) group.unit = currency[1];
      continue;
    }
    if (group) {
      out.push(group);
      group = null;
    }
    const rest = cleaned.slice((m.index ?? 0) + m[0].length);
    if (isQuoteBasis(value, unit, rest)) continue;
    // 하락 낱말은 숫자 바로 뒤에서만 찾습니다. 붙은 괄호("34.69원(-2.55%) 낮습니다")는 건너뜁니다.
    const falling = m[1] === "" && !PERIOD_UNITS.has(unit) && FALLING.test(rest.replace(/^\s*\([^)]*\)/, ""));
    out.push(falling ? { value, unit, text: m[2], falling: true } : { value, unit, text: m[2] });
  }
  if (group) out.push(group);
  return out;
}

/** 비교 기간 · 연도 · 횟수가 아닌, 대조해야 할 데이터 숫자인지. */
export function isDataNumber(n: ParsedNumber): boolean {
  if (PERIOD_UNITS.has(n.unit)) return false;
  if (n.unit === "" && Number.isInteger(n.value) && n.value >= 1900 && n.value <= 2100 && !n.text.includes(",")) return false;
  return true;
}

/**
 * 본문(summary · why · impact · caveats)에서 검사할 금융 숫자인지. 단위가 있거나 소수점 · 천 단위 쉼표가 있는 것만 봅니다.
 * "KODEX 200", "S&P500" 같은 이름 속 정수는 검사하지 않습니다.
 */
export function isStrictNumber(n: ParsedNumber): boolean {
  return isDataNumber(n) && (n.unit !== "" || /[.,조억만천백]/.test(n.text));
}

function decimalsOf(text: string): number {
  const i = text.indexOf(".");
  return i === -1 ? 0 : text.length - i - 1;
}

function roundTo(x: number, decimals: number): number {
  return Number(x.toFixed(Math.min(decimals, 12)));
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * 장부 값의 단위 종류. 키 이름으로 추정합니다 (changeBp → bp, changePp → pp, changePct → pct, 그 외 plain).
 * delta 는 단위를 알 수 없는 변화량(키가 그냥 change) 입니다. 장부에 changeUnit 메타가 있으면 그것을 따릅니다.
 */
export type CandidateUnit = "bp" | "pp" | "pct" | "ratio" | "plain" | "delta";
export type Candidate = { key: string; value: number; unit: CandidateUnit };

function unitOfKey(key: string, values: Evidence["values"]): CandidateUnit {
  const k = key.toLowerCase();
  if (/bp\b|basispoint|_bp$|bp$/.test(k)) return "bp";
  if (/pp\b|changepp|percentagepoint|spread|diff|gap|delta|result$/.test(k)) return "pp";
  // 비율(0.02 = 2%) 로 저장된 값. 퍼센트로 적힌 값(changePct 2.0)과 달리 ×100 환산이 필요합니다
  if (/ratio|fraction|share|weight/.test(k)) return "ratio";
  if (/pct|percent|yoy|mom|qoq|return|premium/.test(k)) return "pct";
  if (/change/.test(k)) {
    // 거시지표 tool 처럼 변화량의 단위를 changeUnit 으로 따로 알려 주는 경우
    const meta = String(values.changeUnit ?? "").toLowerCase();
    if (/percentage_?points?/.test(meta)) return "pp";
    if (/percent/.test(meta)) return "pct";
    return "delta";
  }
  // 금리 tool 처럼 값의 단위를 unit 으로 알려 주면(unit: "%") 수준 값(rate 3, comparisonRate 2.75)도 퍼센트입니다.
  // 메타가 없는 plain 값(환율 1392.4)은 "%" 표기와 맞춰 보지 않습니다 ("1,392%" 를 통과시키지 않기 위해).
  if (String(values.unit ?? "").includes("%")) return "pct";
  return "plain";
}

function unitOfText(unit: string): CandidateUnit {
  if (unit === "bp") return "bp";
  if (unit === "%p") return "pp";
  if (unit === "%") return "pct";
  return "plain";
}

/**
 * 장부 항목의 values 에서 숫자를 뽑습니다. 숫자형과 "3.00" 같은 숫자 문자열, 그리고 짧은 문장(기사 제목 등)에 든 금융 숫자.
 * 날짜 · 연도는 뺍니다. 키 이름으로 단위 종류를 추정합니다.
 */
export function numericCandidates(evidence: Evidence): Candidate[] {
  const out: Candidate[] = [];
  const push = (key: string, value: number) => {
    const unit = unitOfKey(key, evidence.values);
    out.push({ key, value, unit });
    // "trackingDiffPct" 처럼 두 퍼센트의 차이(%p)를 Pct 이름으로 저장한 키는 "0.36%" 와 "0.36%p" 를 둘 다 받습니다.
    if (unit === "pp" && /pct$/i.test(key)) out.push({ key, value, unit: "pct" });
  };
  for (const [key, v] of Object.entries(evidence.values)) {
    if (META_KEY.test(key.split(".").at(-1) ?? key)) continue;
    if (typeof v === "number" && Number.isFinite(v)) push(key, v);
    else if (typeof v === "string") {
      const t = v.trim();
      if (/^[-+]?\d[\d,]*(\.\d+)?$/.test(t) && !/^\d{4}$/.test(t)) push(key, Number(t.replace(/,/g, "")));
      else if (/^\d{4}-\d{2}-\d{2}/.test(t)) continue;
      else for (const n of extractNumbers(t).filter(isStrictNumber)) out.push({ key: `${key}#text`, value: n.value, unit: unitOfText(n.unit) });
    }
  }
  return out;
}

/**
 * 표기 단위와 장부 단위가 호환되는지. 같은 종류면 그대로, 환산이 필요하면 배율을 돌려줍니다.
 *  - bp ↔ pp 는 ×100 / ÷100, 비율(0.02)은 pct 표기와 ×100. 금리처럼 plain 으로 저장된 퍼센트는 장부의 unit 메타("%")로 pct 가 됩니다.
 *  - 통화 표기("원")는 plain 값만, 단위 없는 표기는 plain · pct 값.
 */
function scalesFor(display: string, candidate: CandidateUnit): number[] {
  const d = unitOfText(display);
  // delta(단위 모를 변화량, 예: 환율 change 27.3) 는 통화 · 단위 없는 표기와만 맞춥니다. "27.3%" 로 적으면 걸립니다.
  if (CURRENCY_UNITS.has(display)) return candidate === "plain" || candidate === "delta" ? [1] : [];
  if (d === "bp") return candidate === "bp" ? [1] : candidate === "pp" ? [100] : [];
  if (d === "pp") return candidate === "pp" ? [1] : candidate === "bp" ? [0.01] : [];
  if (d === "pct") {
    if (candidate === "pct") return [1];
    if (candidate === "ratio") return [100]; // 비율 0.02 → "2%"
    return []; // plain · delta 값(환율 · 지수 · 금액)은 % 표기와 맞지 않음
  }
  // 단위 없는 표기
  if (candidate === "plain" || candidate === "pct" || candidate === "delta" || candidate === "ratio") return [1];
  return [];
}

/**
 * 표기된 숫자 하나가 후보 값 중 하나와 정책 안에서 맞는지. 가장 엄격한 정책부터 봅니다.
 * 부호 대신 하락 낱말로 쓴 숫자("34.69원 낮아")는 장부의 음수 값(change -34.69)과만 맞춥니다. 양수 값(changePct 2.55)과만 맞으면
 * 방향이 틀린 것이라 실패입니다. 반대로 "34.69원 올라" 는 -34.69 와 맞지 않습니다.
 */
export function matchValue(n: ParsedNumber, candidates: Candidate[]): { key: string; policy: MatchPolicy } | null {
  if (n.falling && n.value > 0) return matchByPolicy({ ...n, value: -n.value }, candidates);
  return matchByPolicy(n, candidates);
}

function matchByPolicy(n: ParsedNumber, candidates: Candidate[]): { key: string; policy: MatchPolicy } | null {
  const decimals = decimalsOf(n.text);
  const compatible = candidates.flatMap((c) => scalesFor(n.unit, c.unit).map((scale) => ({ c, scale })));

  for (const { c, scale } of compatible) if (scale === 1 && nearlyEqual(c.value, n.value)) return { key: c.key, policy: "exact" };
  for (const { c, scale } of compatible) if (scale === 1 && nearlyEqual(roundTo(c.value, decimals), n.value)) return { key: c.key, policy: "rounded" };
  for (const { c, scale } of compatible) {
    if (scale !== 1 && (nearlyEqual(c.value * scale, n.value) || nearlyEqual(roundTo(c.value * scale, decimals), n.value))) {
      return { key: c.key, policy: "scaled" };
    }
  }
  for (const { c, scale } of compatible) {
    if (scale !== 1) continue;
    const base = Math.abs(c.value);
    if (base > 0 && Math.abs(c.value - n.value) / base <= RELATIVE_TOLERANCE) return { key: c.key, policy: "tolerance" };
  }
  return null;
}

export type NumberFinding =
  | { index: number; label: string; status: "verified" | "derived"; key: string; policy: MatchPolicy; changeOk: boolean; changeProblem?: string }
  | { index: number; label: string; status: "unverified"; reason: string };

function describe(candidates: Candidate[]): string {
  const shown = new Set(candidates.filter((c) => !c.key.endsWith("#text")).map((c) => `${c.key}=${c.value}`));
  return [...shown].join(", ") || "숫자 없음";
}

/** 비교 시점 값을 가리키는 키 (comparisonRate, latest.previousMonth.value …). */
const PREV_KEY = /comparison|previous|prev\b|ago|before|prior|from$/i;
/** 수준(level)이 아닌 변화량 · 비율 키. 기준일 역할 검사를 하지 않습니다. */
const NOT_LEVEL_KEY = /change|diff|delta|pct|pp\b|bp\b|return|spread|gap|yoy|mom|qoq/i;

/**
 * value 가 맞은 키의 역할(최신 값 / 비교 시점 값)이 asOf 와 어긋나는지. 장부에 든 날짜 문자열(asOf · comparisonDate · latest.month …)과
 * 항목의 asOf 를 맞춰 봅니다. "30일 전 값을 오늘 날짜로 현재 값처럼" 적는 것을 잡습니다. 날짜가 장부에 없으면 판단하지 않습니다.
 */
export function roleConflict(key: string, asOf: string, evidence: Evidence): string | null {
  if (!asOf || NOT_LEVEL_KEY.test(key)) return null;
  const isPrev = PREV_KEY.test(key);
  const dates = Object.entries(evidence.values).filter((kv): kv is [string, string] => typeof kv[1] === "string" && /^\d{4}-\d{2}/.test(kv[1]));
  const hits = dates.filter(([, d]) => asOf.startsWith(d) || d.startsWith(asOf));
  if (hits.length === 0) return null;
  const prevHits = hits.filter(([k]) => PREV_KEY.test(k));
  const currHits = hits.filter(([k]) => !PREV_KEY.test(k));
  if (isPrev && currHits.length && !prevHits.length) return `asOf ${asOf} 는 최신 기준일인데 값(${key})은 비교 시점 값`;
  if (!isPrev && prevHits.length && !currHits.length) return `asOf ${asOf} 는 비교 기준일인데 값(${key})은 최신 값`;
  return null;
}

/**
 * numbers 하나하나를 장부와 대조합니다. value 의 데이터 숫자는 모두 맞아야 하고(하나라도 틀리면 항목 전체가 실패),
 * change 의 데이터 숫자도 모두 맞아야 합니다 (틀리면 change 만 비움).
 */
export function verifyNumbers(numbers: WriterOutput["numbers"], evidence: Evidence[]): NumberFinding[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return numbers.map((n, index) => {
    const label = n.label;
    if (!n.ref) return { index, label, status: "unverified", reason: "ref 없음 (장부에 없는 숫자)" };
    const e = byId.get(n.ref);
    if (!e) return { index, label, status: "unverified", reason: `장부에 없는 id ${n.ref}` };

    const candidates = numericCandidates(e);
    // label 에 숫자를 적었으면("USD/KRW 1,500원") 그것도 장부와 맞아야 합니다. 이름 속 정수("KODEX 200")는 보지 않습니다.
    const labelBad = extractNumbers(n.label).filter(isStrictNumber).find((c) => !matchValue(c, candidates));
    if (labelBad) return { index, label, status: "unverified", reason: `label 의 숫자 ${labelBad.text}${labelBad.unit} 가 ${n.ref} 의 값과 다름` };
    const valueNumbers = extractNumbers(n.value).filter(isDataNumber);
    if (valueNumbers.length === 0) return { index, label, status: "unverified", reason: `value "${n.value}" 에 숫자가 없음` };
    const matches = valueNumbers.map((v) => matchValue(v, candidates));
    const failedAt = matches.findIndex((m) => m === null);
    if (failedAt !== -1) {
      const v = valueNumbers[failedAt];
      return { index, label, status: "unverified", reason: `value ${v.text}${v.unit} 가 ${n.ref} 의 값과 다름 (장부: ${describe(candidates)})` };
    }
    const m = matches[0]!;
    const conflict = roleConflict(m.key, n.asOf, e);
    if (conflict) return { index, label, status: "unverified", reason: conflict };

    // change 는 value 와 같은 값(현재가를 변화처럼 적는 것)이면 안 되므로, value 가 맞은 키는 후보에서 뺍니다.
    const changeCandidates = candidates.filter((c) => c.key !== m.key);
    const bad = extractNumbers(n.change).filter(isDataNumber).find((c) => !matchValue(c, changeCandidates));
    return {
      index,
      label,
      status: n.ref.startsWith("C") ? "derived" : "verified",
      key: m.key,
      policy: m.policy,
      changeOk: !bad,
      ...(bad ? { changeProblem: `change 의 ${bad.text}${bad.unit} 가 ${n.ref} 의 변화 값과 다름 (장부: ${describe(changeCandidates)})` } : {}),
    };
  });
}

export type TextField = "summary" | "why" | "impact" | "caveats";
export type TextFinding = { field: TextField; index: number; text: string; unmatched: string[] };

/**
 * 본문에 쓴 금융 숫자가 장부 어딘가에 있는지. numbers 와 달리 ref 가 없으니 장부 전체와 대조합니다.
 * 단위 · 소수점 · 천 단위 쉼표가 있는 숫자만 봅니다 (이름 속 정수 "KODEX 200" 은 제외).
 */
export function verifyText(output: WriterOutput, evidence: Evidence[]): TextFinding[] {
  const all = evidence.flatMap(numericCandidates);
  const check = (field: TextField, index: number, text: string): TextFinding | null => {
    const unmatched = extractNumbers(text)
      .filter(isStrictNumber)
      .filter((n) => !matchValue(n, all))
      .map((n) => `${n.text}${n.unit}`);
    return unmatched.length ? { field, index, text, unmatched: [...new Set(unmatched)] } : null;
  };
  const findings: (TextFinding | null)[] = [
    check("summary", 0, output.summary),
    ...output.why.map((w, i) => check("why", i, `${w.claim} ${w.evidence}`)),
    ...output.impact.map((t, i) => check("impact", i, t)),
    ...output.caveats.map((t, i) => check("caveats", i, t)),
  ];
  return findings.filter((f): f is TextFinding => f !== null);
}

export type WhyFinding = {
  index: number;
  ok: boolean;
  problems: string[];
  /** 수정 후에도 남으면 applyVerification 이 이렇게 고칩니다 */
  fix: { basis?: "none"; refs?: string[]; evidence?: string };
};

const NO_EVIDENCE = "데이터로 확인되지 않음";
/** summary 전체를 지웠을 때 대신 보여주는 문장. */
export const SUMMARY_FALLBACK = "요약이 검증 규칙(출처에 없는 숫자 · 투자 권유 금지)에 걸려 뺐습니다. 아래 숫자와 원인을 참고하세요.";

/** why 의 근거 표시가 규칙대로인지. 주장이 맞는지(근거 판정)는 보지 않습니다 — 3단계. */
export function verifyWhy(why: WriterOutput["why"], evidence: Evidence[]): WhyFinding[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const isNews = (id: string) => /news/i.test(byId.get(id)?.tool ?? "");
  // data 근거는 숫자가 있는 증거여야 합니다. 글만 있는 tool 결과로 "데이터가 뒷받침한다" 고 말할 수 없습니다.
  const hasNumbers = (id: string) => numericCandidates(byId.get(id)!).some((c) => !c.key.endsWith("#text"));

  return why.map((w, index) => {
    const problems: string[] = [];
    const fix: WhyFinding["fix"] = {};
    const known = w.refs.filter((r) => byId.has(r));
    const unknown = w.refs.filter((r) => !byId.has(r));
    if (unknown.length) {
      problems.push(`장부에 없는 id ${unknown.join(", ")}`);
      fix.refs = known;
    }

    if (w.basis === "data" && !known.some((r) => !isNews(r) && hasNumbers(r))) {
      problems.push("basis 가 data 인데 숫자 데이터가 있는 증거(refs)가 없음");
      fix.basis = "none";
    } else if (w.basis === "news" && !known.some(isNews)) {
      problems.push("basis 가 news 인데 뉴스 증거(refs)가 없음");
      fix.basis = "none";
    } else if (w.basis === "none") {
      if (known.length) {
        problems.push("basis 가 none 인데 refs 가 있음 (근거가 있으면 data 나 news 로)");
        fix.refs = [];
      }
      if (!UNSUPPORTED_EVIDENCE.test(w.evidence)) {
        problems.push(`basis 가 none 이면 evidence 는 "${NO_EVIDENCE}" 이어야 함`);
        fix.evidence = NO_EVIDENCE;
      }
    }
    if (fix.basis === "none") {
      fix.refs = [];
      fix.evidence = NO_EVIDENCE;
    }
    return { index, ok: problems.length === 0, problems, fix };
  });
}

export type VerifyResult = {
  numbers: NumberFinding[];
  text: TextFinding[];
  why: WhyFinding[];
  /** 권유 표현이 든 문장 */
  advice: string[];
  ok: boolean;
  /** 작성 Agent 에게 돌려줄 실패 목록 (사람이 읽는 문장) */
  failures: string[];
};

export function verify(output: WriterOutput, evidence: Evidence[]): VerifyResult {
  const numbers = verifyNumbers(output.numbers, evidence);
  const text = verifyText(output, evidence);
  const why = verifyWhy(output.why, evidence);
  const advice = findAdvice(output);
  const failures: string[] = [];
  for (const f of numbers) {
    if (f.status === "unverified") failures.push(`numbers "${f.label}": ${f.reason}`);
    else if (!f.changeOk) failures.push(`numbers "${f.label}": ${f.changeProblem}`);
  }
  for (const t of text) failures.push(`${t.field} 의 숫자 ${t.unmatched.join(", ")} 가 장부에 없음: "${t.text}"`);
  for (const w of why) if (!w.ok) failures.push(`why "${output.why[w.index].claim}": ${w.problems.join("; ")}`);
  for (const a of advice) failures.push(`투자 권유 표현: "${a}"`);
  return { numbers, text, why, advice, ok: failures.length === 0, failures };
}

export type Applied = {
  output: WriterOutput;
  /** 남은 numbers 와 같은 순서 */
  checks: NumberCheck[];
  /** 뺀 것 · 낮춘 것. verification.removed 로 나갑니다 */
  removed: string[];
};

/** 문장 단위로 나눠, 지워야 할 숫자나 권유 표현이 든 문장만 뺍니다. */
function stripSentences(text: string, unmatched: string[]): string {
  return text
    .split(/(?<=[.!?。])\s+/)
    .filter((s) => s.trim() && !unmatched.some((u) => s.includes(u)))
    .join(" ");
}

/**
 * 수정 뒤에도 남은 실패를 리포트에서 처리합니다 (fail-closed).
 *  - value 가 틀린 숫자: 항목을 뺍니다. change 만 틀리면 change 를 비웁니다.
 *  - 본문의 장부에 없는 숫자: summary 는 그 문장만 지우고, why · impact · caveats 는 항목을 뺍니다.
 *  - 근거 표시가 틀린 원인: basis 를 none 으로 낮추거나 없는 id 를 지웁니다. 주장 자체는 남깁니다.
 *  - 권유 표현: 목록 항목(why · impact · caveats · nextTopics)이면 뺍니다. summary 는 그 문장만 지우고, 남는 문장이 없으면 안내 문장으로 바꿉니다.
 *  - 뺀 숫자가 있으면 dataGaps 에 한 줄 적어 사용자에게 보입니다.
 */
export function applyVerification(output: WriterOutput, result: VerifyResult): Applied {
  // removed 에는 문장 원문을 되풀이하지 않습니다 (권유 표현이 거기로 새지 않게). 숫자 항목은 라벨과 값만 적습니다.
  const removed: string[] = [];
  const textByField = (field: TextField) => new Map(result.text.filter((t) => t.field === field).map((t) => [t.index, t]));

  let summary = output.summary;
  const summaryText = textByField("summary").get(0);
  if (summaryText) {
    summary = stripSentences(summary, summaryText.unmatched);
    removed.push(`summary 의 문장 삭제: 장부에 없는 숫자 ${summaryText.unmatched.join(", ")}`);
  }
  if (hasAdvice(summary)) {
    summary = stripAdvice(summary);
    removed.push("summary 의 권유 문장 삭제");
  }
  if (summary.trim() === "") summary = SUMMARY_FALLBACK;

  const numbers: WriterOutput["numbers"] = [];
  const checks: NumberCheck[] = [];
  let droppedNumbers = 0; // 출처 값과 맞지 않아 뺀 숫자 (dataGaps 안내용)
  output.numbers.forEach((n, i) => {
    const f = result.numbers[i];
    if (hasAdvice(n.label) || hasAdvice(n.value) || hasAdvice(n.change)) {
      removed.push(`숫자 ${i + 1}번째 항목 삭제: 투자 권유 표현`);
      return;
    }
    if (!f || f.status === "unverified") {
      removed.push(`숫자 "${n.label}" ${n.value}: ${f?.reason ?? "검증 결과 없음"}`);
      droppedNumbers += 1;
      return;
    }
    if (!f.changeOk) {
      removed.push(`숫자 "${n.label}" 의 change "${n.change}" 삭제: ${f.changeProblem}`);
      numbers.push({ ...n, change: "" });
    } else {
      numbers.push(n);
    }
    checks.push(f.status);
  });

  const whyText = textByField("why");
  const why = output.why
    .map((w, i) => {
      const f = result.why[i];
      if (!f || f.ok) return w;
      removed.push(`원인 ${i + 1}번째 근거 표시 수정: ${f.problems.join("; ")}`);
      return {
        ...w,
        ...(f.fix.basis ? { basis: f.fix.basis } : {}),
        ...(f.fix.refs ? { refs: f.fix.refs } : {}),
        ...(f.fix.evidence ? { evidence: f.fix.evidence } : {}),
      };
    })
    .filter((w, i) => {
      const t = whyText.get(i);
      if (t) {
        removed.push(`원인 ${i + 1}번째 항목 삭제: 장부에 없는 숫자 ${t.unmatched.join(", ")}`);
        return false;
      }
      // 근거 표시를 고친 뒤의 문장으로 다시 봅니다 (원문 집합과 비교하면 고친 항목을 놓침)
      if (hasAdvice(`${w.claim} ${w.evidence}`)) {
        removed.push(`원인 ${i + 1}번째 항목 삭제: 투자 권유 표현`);
        return false;
      }
      return true;
    });

  const dropItems = (xs: string[], field: "impact" | "caveats" | "nextTopics" | "dataGaps") => {
    const texts = field === "nextTopics" || field === "dataGaps" ? new Map<number, TextFinding>() : textByField(field);
    return xs.filter((x, i) => {
      const t = texts.get(i);
      if (t) {
        removed.push(`${field} ${i + 1}번째 항목 삭제: 장부에 없는 숫자 ${t.unmatched.join(", ")}`);
        return false;
      }
      if (hasAdvice(x)) {
        removed.push(`${field} ${i + 1}번째 항목 삭제: 투자 권유 표현`);
        return false;
      }
      return true;
    });
  };

  const dataGaps = dropItems(output.dataGaps, "dataGaps");
  if (droppedNumbers > 0) dataGaps.push(`검증을 통과하지 못해 뺀 숫자 ${droppedNumbers}개 (출처 값과 맞지 않았습니다)`);

  return {
    output: {
      ...output,
      summary,
      numbers,
      why,
      impact: dropItems(output.impact, "impact"),
      caveats: dropItems(output.caveats, "caveats"),
      nextTopics: dropItems(output.nextTopics, "nextTopics"),
      dataGaps,
    },
    checks,
    removed,
  };
}

/** 리포트에 붙는 검증 요약. pass 는 뺀 것도 낮춘 것도 없고 권유 표현도 0 일 때. advice 는 처리 뒤에도 남은 권유 문장 수(목표 0). */
export function summarizeVerification(applied: Applied, revisions: number): Verification {
  const verified = applied.checks.filter((c) => c === "verified").length;
  const derived = applied.checks.filter((c) => c === "derived").length;
  const advice = findAdvice(applied.output).length;
  return {
    status: applied.removed.length === 0 && advice === 0 ? "pass" : "partial",
    numbers: { total: applied.checks.length, verified, derived, unverified: applied.checks.length - verified - derived },
    why: summarizeWhy(applied.output.why),
    advice,
    revisions,
    removed: applied.removed,
  };
}
