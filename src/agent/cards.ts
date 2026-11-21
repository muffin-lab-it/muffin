/**
 * 같은 값의 숫자 카드가 두 장 나오는 것 정리 (리더, 11/21).
 *
 * 11/21 재실행: "한국은행 기준금리 3%" 가 1년 비교(+0.50%p)와 30일 비교(0%p)로 두 장 나왔습니다. 이름과 값이 같은 카드는 하나만 남깁니다.
 * 변화가 있는 쪽을 남기고(변화가 없다는 사실은 문장에 있습니다), 둘 다 같으면 먼저 나온 것을 남깁니다.
 */
import type { WriterOutput } from "./schema";

const key = (n: WriterOutput["numbers"][number]) => `${n.label.replace(/\s|\([^)]*\)/g, "")}|${n.value.replace(/\s/g, "")}`;
/** 변화 칸이 "변화 없음" 인지: 비었거나, 변동 없음이거나, 숫자가 전부 0 */
export function isFlat(change: string): boolean {
  if (!change.trim() || /변동\s*없|변화\s*없|그대로|동일/.test(change)) return true;
  // 기간을 적은 숫자("30일", "1년")와 날짜는 빼고 봅니다
  const nums = change.replace(/\d{4}-\d{2}(-\d{2})?/g, " ").replace(/\d+\s*(일|개월|년|주)/g, " ").match(/\d+(?:\.\d+)?/g) ?? [];
  // 숫자가 없으면(기간만 적은 경우) 변화를 말한 것이 아닙니다
  return nums.every((x) => Number(x) === 0);
}

/** 이름과 값이 같은 카드를 하나로. 바뀐 것이 없으면 받은 그대로 돌려줍니다 */
export function mergeSameCards(output: WriterOutput): WriterOutput {
  const best = new Map<string, number>();
  output.numbers.forEach((n, i) => {
    const k = key(n);
    const at = best.get(k);
    if (at === undefined || (isFlat(output.numbers[at]!.change) && !isFlat(n.change))) best.set(k, i);
  });
  if (best.size === output.numbers.length) return output;
  const keep = new Set(best.values());
  return { ...output, numbers: output.numbers.filter((_, i) => keep.has(i)) };
}
