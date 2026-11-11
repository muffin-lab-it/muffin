/**
 * 숫자 카드 변화량(change)을 코드가 장부에서 풀어 씁니다 (리더, 11/10).
 * 모델이 쓴 "30일 +2.00%" 가 검증에서 장부의 어느 키와 맞았는지(matches[].change)를 받아, 그 키의 값 · 단위와 장부에 적힌 비교 시점 · 기준일을
 * numbers[].changeDetail 로 내보냅니다. 화면은 문자열을 파싱하지 않고 이 값으로 "30일 전과 비교해 +2.00%" 를 만듭니다.
 * 맞은 키가 없으면(변화량이 장부에 없거나 검증에 걸려 비움) 만들지 않고, 값을 새로 계산하지도 않습니다.
 */
import type { ChangeDetail, Evidence, WriterOutput } from "./schema";
import { PREV_KEY, extractNumbers, isDataNumber, matchValue, numericCandidates, type Applied, type MatchPolicy } from "./verify";

const DATE = /^\d{4}-\d{2}(-\d{2})?/;
const FULL_DATE = /^\d{4}-\d{2}-\d{2}/;
/** 거시지표 tool 처럼 월을 YYYYMM(또는 YYYYMMDD)으로 적는 경우. 숫자 값과 헷갈리지 않게 날짜를 뜻하는 키 이름일 때만 받습니다 */
const COMPACT_DATE = /^(\d{4})(0[1-9]|1[0-2])(\d{2})?$/;
const DATE_KEY = /date|month|asof|period|day|from$|to$/i;

/** 장부 값이 날짜면 YYYY-MM 또는 YYYY-MM-DD 로, 아니면 undefined */
export function isoDateOf(key: string, value: string | number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (DATE.test(value)) return value;
  const m = DATE_KEY.test(key) ? COMPACT_DATE.exec(value) : null;
  if (!m) return undefined;
  return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
}

function daysBetween(from: string, to: string): number | undefined {
  if (!FULL_DATE.test(from) || !FULL_DATE.test(to)) return undefined;
  const ms = Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : undefined;
}

/** 키 이름으로 비교 기준을 읽고, 날짜가 둘 다 있으면 일수로 적습니다 */
export function basisFor(key: string, days: number | undefined): string {
  const k = key.toLowerCase();
  if (/previousyear|yoy/.test(k)) return "전년 같은 달과 비교";
  if (/previousmonth|mom/.test(k)) return "전월과 비교";
  if (/previousquarter|qoq/.test(k)) return "전분기와 비교";
  if (/latest\.change|daily|dod/.test(k)) return "직전 거래일과 비교";
  if (days !== undefined && days > 0) return `${days}일 전과 비교`;
  return "장부의 비교 시점과 비교";
}

/** 장부 단위 → 표기. plain · delta(환율 27.3원처럼 단위를 모르는 변화량)는 카드에 적힌 단위를 씁니다 */
const UNIT_TEXT: Record<string, string> = { pp: "%p", pct: "%", bp: "bp", ratio: "%" };

/**
 * 카드 하나의 changeDetail. hit 은 검증이 change 의 첫 데이터 숫자와 맞춘 장부 키 · 규칙입니다.
 * 날짜는 맞은 키와 같은 묶음(period. · latest. 같은 접두어)에서 찾습니다: 비교 시점은 comparison · previous · from 키, 기준일은 그 밖의 날짜 키, 없으면 출처 기준일.
 */
export function changeDetailFor(n: Pick<WriterOutput["numbers"][number], "change">, entry: Evidence, hit: { key: string; policy: MatchPolicy }): ChangeDetail | null {
  const parsed = extractNumbers(n.change).filter(isDataNumber)[0];
  if (!parsed) return null;
  const candidate = numericCandidates(entry).find((c) => c.key === hit.key && matchValue(parsed, [c])?.policy === hit.policy);
  if (!candidate) return null;
  const value = candidate.unit === "ratio" ? candidate.value * 100 : candidate.value;
  const unit = UNIT_TEXT[candidate.unit] ?? parsed.unit;
  const prefix = hit.key.includes(".") ? hit.key.slice(0, hit.key.lastIndexOf(".") + 1) : "";
  const sameGroup = (k: string) => (prefix ? k.startsWith(prefix) : !k.includes("."));
  const dates = Object.entries(entry.values).flatMap(([k, v]) => {
    const d = isoDateOf(k, v);
    return d ? [[k, d] as [string, string]] : [];
  });
  // 비교 시점: 같은 묶음의 comparison · previous · from 키. 맞은 키가 최상위(changePct)면 환율 tool 처럼 "comparison.asOf" 로 묶어 둔 날짜도 받습니다
  const from = dates.find(([k]) => PREV_KEY.test(k) && sameGroup(k))?.[1] ?? (prefix ? undefined : dates.find(([k]) => PREV_KEY.test(k))?.[1]);
  // 기준일: 같은 묶음의 날짜 → 상위 묶음(latest.previousMonth. 의 상위 latest.month)의 날짜 → 출처 기준일. 월 단위 비교면 기준일도 월로 맞춰집니다
  const groups = [prefix];
  for (let g = prefix; g.includes("."); ) {
    g = g.slice(0, g.lastIndexOf(".", g.length - 2) + 1);
    groups.push(g);
  }
  const inGroup = (g: string, k: string) => (g ? k.startsWith(g) && !k.slice(g.length).includes(".") : !k.includes("."));
  const to = groups.map((g) => dates.find(([k]) => !PREV_KEY.test(k) && inGroup(g, k))?.[1]).find(Boolean) ?? (entry.source.asOf || undefined);
  const days = from && to ? daysBetween(from, to) : undefined;
  return {
    key: hit.key,
    value,
    unit,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(days !== undefined ? { days } : {}),
    basis: basisFor(hit.key, days),
  };
}

/** 검증을 적용한 결과(남은 numbers 와 같은 순서의 matches)에서 카드마다 changeDetail 을 만듭니다. 맞은 키가 없는 자리는 undefined */
export function changeDetailsFor(applied: Applied, evidence: Evidence[]): (ChangeDetail | undefined)[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return applied.output.numbers.map((n, i) => {
    const hit = applied.matches[i]?.change;
    const entry = n.ref ? byId.get(n.ref) : undefined;
    return hit && entry ? (changeDetailFor(n, entry, hit) ?? undefined) : undefined;
  });
}
