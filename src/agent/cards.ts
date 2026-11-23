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
/** 카드가 가리키는 장부 항목의 지표 (금리 · 환율 · 지수 · 물가). 계산 항목이나 지표가 없는 항목은 null */
function indicatorOf(ref: string | null | undefined, evidence: readonly Evidence[]): string | null {
  const e = ref ? evidence.find((x) => x.id === ref) : undefined;
  if (!e || e.lineage) return null;
  const v = e.values;
  const name = v.indicator ?? v.pair ?? v.index ?? v.name;
  return typeof name === "string" ? `${e.tool}:${name}${typeof v.country === "string" ? `:${v.country}` : ""}` : null;
}

/**
 * 이름과 값이 같은 카드를 하나로. 바뀐 것이 없으면 받은 그대로 돌려줍니다.
 * evidence 를 주면 같은 장부 지표 · 같은 값 · 같은 기준일인 카드도 이름이 달라도 하나로 봅니다
 * (11/23 녹화 · 로컬 4번 중 2번: "한국 기준금리 3% · 30일 변동 없음" 과 "한국 기준금리 1년 변화 3% · 1년 +0.50%p" 가 함께 나옴). 값은 "3.00%" 와 "3%" 를 같게 봅니다.
 */
export function mergeSameCards(output: WriterOutput, evidence: readonly Evidence[] = []): WriterOutput {
  const best = new Map<string, number>();
  output.numbers.forEach((n, i) => {
    const indicator = indicatorOf(n.ref, evidence);
    const k = indicator ? `${indicator}|${sameValue(n.value)}|${n.asOf}` : key(n);
    const at = best.get(k);
    if (at === undefined || (isFlat(output.numbers[at]!.change) && !isFlat(n.change))) best.set(k, i);
  });
  if (best.size === output.numbers.length) return output;
  // 남길 카드는 같은 무리에서 처음 나온 자리에 둡니다 (1년 카드가 뒤에 있어도 한국 금리 카드가 맨 끝으로 가지 않게)
  const first = new Map<string, number>();
  const keyAt = output.numbers.map((n) => {
    const indicator = indicatorOf(n.ref, evidence);
    return indicator ? `${indicator}|${sameValue(n.value)}|${n.asOf}` : key(n);
  });
  keyAt.forEach((k, i) => { if (!first.has(k)) first.set(k, i); });
  return { ...output, numbers: [...best].sort((a, b) => first.get(a[0])! - first.get(b[0])!).map(([, i]) => output.numbers[i]!) };
}
