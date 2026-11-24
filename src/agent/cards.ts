/**
 * 같은 값의 숫자 카드가 두 장 나오는 것 정리 (리더, 11/21).
 *
 * 11/21 재실행: "한국은행 기준금리 3%" 가 1년 비교(+0.50%p)와 30일 비교(0%p)로 두 장 나왔습니다. 이름 · 값 · 기준일이 같은 카드는 하나만 남깁니다.
 * 변화가 있는 쪽을 남기고(변화가 없다는 사실은 문장에 있습니다), 둘 다 같으면 먼저 나온 것을 남깁니다.
 */
import type { Evidence, WriterOutput } from "./schema";

// 괄호 안의 구분(한국 · 미국, 공식 자료 · 기사 보도)도 이름의 일부라 지우지 않습니다. 기준일이 다르면 다른 카드입니다: 1년 전 값과 지금 값이 우연히 같아도(둘 다 2.50%) 두 시점 비교가 사라지면 안 됩니다 (#128 Codex 리뷰)
const key = (n: WriterOutput["numbers"][number]) => `${n.label.replace(/\s/g, "")}|${sameValue(n.value)}|${n.asOf}`;
/** 변화 칸이 "변화 없음" 인지: 비었거나, 변동 없음이거나, 숫자가 전부 0 */
export function isFlat(change: string): boolean {
  if (!change.trim() || /변동\s*없|변화\s*없|그대로|동일/.test(change)) return true;
  // 기간을 적은 숫자("30일", "1년")와 날짜는 빼고 봅니다
  const nums = change.replace(/\d{4}-\d{2}(-\d{2})?/g, " ").replace(/\d+\s*(일|개월|년|주)/g, " ").match(/\d+(?:\.\d+)?/g) ?? [];
  // 숫자가 없으면(기간만 적은 경우) 변화를 말한 것이 아닙니다
  return nums.every((x) => Number(x) === 0);
}

/** 값을 숫자로 맞춥니다: "3.00%" 와 "3%", "1,337.98원" 과 "1337.98 원" 은 같은 값입니다 */
function sameValue(value: string): string {
  const m = /^([+-]?)([\d,]*\.?\d+)\s*(.*)$/.exec(value.trim());
  return m ? `${m[1]}${Number(m[2]!.replace(/,/g, ""))}${m[3]!.replace(/\s/g, "")}` : value.replace(/\s/g, "");
}
/** 지표마다 "지금 수준" 을 담은 칸. 기간이 다른 항목(30일 · 365일)에도 같은 뜻으로 들어 있습니다 */
const LEVEL_FIELD: Record<string, string> = {
  get_rate_data: "rate",
  get_fx_krw_rate: "rate",
  get_kr_stock_index: "latest.close",
  get_us_stock_index: "latest.close",
  get_macro_indicators: "latest.value",
};
const numberOf = (value: string): number | null => {
  const m = /^[+-]?[\d,]*\.?\d+/.exec(value.trim());
  return m ? Number(m[0].replace(/,/g, "")) : null;
};
/**
 * 카드 값이 장부 항목의 "지금 수준" 칸과 같으면 그 지표 · 기준일로 된 이름. 아니면 null (이름으로 비교).
 * 같은 항목에 같은 값을 가진 다른 숫자 칸이 있으면(ETF 종가 = 순자산가치처럼) 어떤 값인지 정할 수 없어 null 입니다 (#157 Codex 리뷰)
 */
function levelIdentity(n: WriterOutput["numbers"][number], evidence: readonly Evidence[]): string | null {
  const e = n.ref ? evidence.find((x) => x.id === n.ref) : undefined;
  const field = e && !e.lineage ? LEVEL_FIELD[e.tool] : undefined;
  if (!e || !field) return null;
  const v = numberOf(n.value);
  const level = e.values[field];
  if (v === null || typeof level !== "number" || Math.abs(v - level) > 1e-9) return null;
  if (Object.entries(e.values).some(([k, x]) => k !== field && typeof x === "number" && Math.abs(x - v) < 1e-9)) return null;
  const name = e.values.indicator ?? e.values.pair ?? e.values.index;
  const part = [e.values.country].filter((x) => typeof x === "string").join(":");
  return typeof name === "string" ? `${e.tool}:${name}${part ? `:${part}` : ""}|${field}|${n.asOf}` : null;
}

/**
 * 카드 값이 장부 항목의 숫자 칸 하나에만 맞으면(카드에 적힌 소수 자리로 반올림해 비교) 그 항목 · 칸 · 기준일로 된 이름. 둘 이상 맞거나 없으면 null.
 * 같은 항목의 같은 값을 이름만 달리 쓴 카드를 찾습니다 (11/23 운영: "전년 동월 대비 물가 변화 2.82%" 와 "전년 동월 대비 상승률 2.82%").
 * 종가 = 순자산가치처럼 두 칸에 맞는 값은 어떤 값인지 정할 수 없어 null 입니다.
 */
function fieldIdentity(n: WriterOutput["numbers"][number], evidence: readonly Evidence[]): string | null {
  const e = n.ref ? evidence.find((x) => x.id === n.ref) : undefined;
  const v = numberOf(n.value);
  if (!e || v === null) return null;
  const decimals = /\.(\d+)/.exec(n.value)?.[1]?.length ?? 0;
  const same = (x: number) => Number(x.toFixed(decimals)) === v || Number(Math.abs(x).toFixed(decimals)) === Math.abs(v);
  const hits = Object.entries(e.values).filter(([, x]) => typeof x === "number" && same(x));
  return hits.length === 1 ? `${e.id}|${hits[0]![0]}|${n.asOf}` : null;
}

/**
 * 이름과 값이 같은 카드를 하나로. 바뀐 것이 없으면 받은 그대로 돌려줍니다.
 * evidence 를 주면 같은 지표의 "지금 수준"(금리 · 환율 · 지수 종가 · 물가지수)을 같은 기준일로 보여 주는 카드도 이름이 달라도 한 무리로 봅니다
 * (11/23 녹화 · 로컬 4번 중 2번: "한국 기준금리 3% · 30일 변동 없음" 과 "한국 기준금리 1년 변화 3% · 1년 +0.50%p" 가 함께 나옴). 값은 "3.00%" 와 "3%" 를 같게 봅니다.
 * 같은 장부 항목의 숫자 칸 하나에만 맞는 같은 값의 카드도 한 무리입니다 (물가 "전년 동월 대비 물가 변화 2.82%" · "전년 동월 대비 상승률 2.82%").
 * 한 무리에서 변화가 있는 카드는 남기고 변화 없는 중복만 뺍니다. 변화가 있는 카드가 둘 이상이면(전월 대비 · 전년 동월 대비처럼 비교 기준이 다름) 모두 남깁니다 (#157 Codex 리뷰).
 * 남는 카드는 그 무리가 처음 나온 자리에 둡니다 (1년 카드가 뒤에 있어도 한국 금리 카드가 맨 끝으로 가지 않게).
 */
export function mergeSameCards(output: WriterOutput, evidence: readonly Evidence[] = []): WriterOutput {
  // 이름 · 지금 수준 값 · 같은 항목의 같은 칸 중 하나라도 같으면 한 무리입니다 (서로 이어 붙임)
  const parent = output.numbers.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const firstOf = new Map<string, number>();
  output.numbers.forEach((n, i) => {
    for (const k of [`label:${key(n)}`, levelIdentity(n, evidence), fieldIdentity(n, evidence)]) {
      if (!k) continue;
      const at = firstOf.get(k);
      if (at === undefined) firstOf.set(k, i);
      else parent[root(i)] = root(at);
    }
  });
  const groups = new Map<number, number[]>();
  output.numbers.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
  if (groups.size === output.numbers.length) return output;
  const kept: number[] = [];
  for (const members of groups.values()) {
    const changed = members.filter((i) => !isFlat(output.numbers[i]!.change));
    // 변화 칸까지 같은 카드는 하나만
    const distinct = changed.filter((i, k) => changed.findIndex((j) => output.numbers[j]!.change.replace(/\s/g, "") === output.numbers[i]!.change.replace(/\s/g, "")) === k);
    kept.push(...(distinct.length > 0 ? distinct : [members[0]!]));
  }
  if (kept.length === output.numbers.length) return output;
  return { ...output, numbers: kept.map((i) => output.numbers[i]!) };
}
