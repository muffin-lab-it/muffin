/**
 * "주의점" 과 "확인하지 못한 것" 의 되풀이 줄이기 (리더, 11/21).
 *
 * 11/20 베타: "글이 너무 많은데 반 이상은 할 수 없음임. 이게 무슨 리포트인가 싶음". 작성은 같은 한계를 요약 · 주의점 · 확인하지 못한 것에 각각 다시 씁니다
 * (11/21 실측: "인과관계를 확정할 수 없습니다" 가 주의점에 한 번, 확인하지 못한 것에 두 번). 모델에 "한 번만" 이라고 일러도 남아서, 코드가 정리합니다.
 *  - 같은 한계(인과관계 · 본문 미확보 · 실시간 값 등)를 다룬 줄은 먼저 나온 하나만 남깁니다. 주의점에 있으면 확인하지 못한 것에서는 뺍니다.
 *  - 글자가 많이 겹치는 줄도 하나만 남깁니다.
 *  - 그래도 많으면 앞에서부터 주의점 3줄, 확인하지 못한 것 2줄까지만 둡니다.
 * tool 실패처럼 코드가 넣는 줄(저장된 응답 사용, 검증에서 뺀 숫자)은 이 뒤에 붙으므로 줄어들지 않습니다.
 */
import type { WriterOutput } from "./schema";

export const CAVEATS_MAX = 3;
export const GAPS_MAX = 2;

/** 한 줄이 다루는 한계의 종류. 같은 종류가 이미 나왔으면 되풀이로 봅니다 */
const TOPICS: [string, RegExp][] = [
  ["인과", /인과\s*관계|상관\s*관계|상관계수|원인(을|은|이|으로)?\s*(단정|확정|특정|확인|판단|설명)/],
  // 기사의 한계는 한 줄이면 됩니다: 제목만 확인 · 본문 미확보 · 기사 수치 미검증 · 중계 링크 (11/21 실측: 주의점 세 줄이 모두 이 종류)
  ["기사 한계", /본문|제목만|기사\s*(제목|속)?의?\s*수치|Google News|중계 링크|별도\s*(로)?\s*검증/],
  ["실시간", /실시간|장중|호가/],
  ["늦은 공개", /다음 영업일|하루 늦|하루 이틀|T\+1|직전 영업일/],
  ["계절성", /계절성|계절조정/],
  ["개인 적합", /투자 목적|감내|개인에게|본인의/],
  ["과거 수익률", /과거 수익률|미래 성과|앞으로의 (수익률|성과)/],
];

const topicsOf = (text: string) => TOPICS.filter(([, re]) => re.test(text)).map(([name]) => name);

const grams = (text: string) => {
  const t = text.replace(/[\s.,·'"‘’“”()]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
};
/** 두 줄의 글자 겹침 (작은 쪽 기준 0~1) */
export function overlap(a: string, b: string): number {
  const x = grams(a);
  const y = grams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both += 1;
  return both / Math.min(x.size, y.size);
}
const SAME = 0.6;
const INTERNAL = /증거 장부|조사 메모|사실 목록|장부에\s|\bref\b|숫자 카드|데이터 도구|\btool\b/i;
const CODE_LINE = /^검증을 통과하지 못해 뺀 숫자/;

/** 되풀이를 뺀 주의점 · 확인하지 못한 것. 바뀐 것이 없으면 받은 그대로 돌려줍니다 */
export function trimRepeats(output: WriterOutput): WriterOutput {
  const seenTopics = new Set<string>();
  const kept: string[] = [];
  const pick = (lines: string[], max: number) => {
    const out: string[] = [];
    for (const line of lines) {
      // 내부 용어가 든 줄은 사용자에게 뜻이 통하지 않아 뺍니다 ("조사 메모의 … 증거 장부에 해당 항목이 없어 인용하지 못했습니다", 11/21 실측)
      if (INTERNAL.test(line)) continue;
      // 검증이 넣은 줄("검증을 통과하지 못해 뺀 숫자 N개")은 사용자에게 꼭 보여야 하므로 세지 않고 그대로 둡니다
      if (CODE_LINE.test(line)) {
        out.push(line);
        continue;
      }
      const topics = topicsOf(line);
      const repeated = (topics.length > 0 && topics.every((t) => seenTopics.has(t))) || kept.some((k) => overlap(k, line) >= SAME);
      if (repeated || out.length >= max) continue;
      out.push(line);
      kept.push(line);
      for (const t of topics) seenTopics.add(t);
    }
    return out;
  };
  const caveats = pick(output.caveats, CAVEATS_MAX);
  const dataGaps = pick(output.dataGaps, GAPS_MAX);
  return caveats.length === output.caveats.length && dataGaps.length === output.dataGaps.length ? output : { ...output, caveats, dataGaps };
}

export const GAP_INPUTS_MAX = 3;
/** 작업 과정을 적은 줄: 본문을 몇 건 받았는지, 링크 확인 실패, tool 의 상태 값. 사용자에게는 의미가 없습니다 */
const PROCESS = /\d+\s*건\s*중\s*\d+\s*건|본문\s*(확보\s*)?목표|원문\s*링크|링크\s*확인|resultStatus|bodyStatus|missingCount|\bpartial\b|수량\s*충족/;

/**
 * 작성에 넘기기 전에 "확인하지 못한 것" 줄을 줄입니다. 조사와 정제가 각각 쓴 줄이 합쳐져 작성 입력의 "[확인하지 못한 것] dataGaps 에 옮깁니다" 로
 * 들어가는데(11/21 실측: 다섯 줄 중 두 쌍이 같은 말), 작성은 시킨 대로 옮기고 요약에도 "확인되지 않았습니다" 를 되풀이합니다.
 * 작업 과정 줄을 빼고, 같은 한계 · 글자가 겹치는 줄은 하나만, 앞에서부터 GAP_INPUTS_MAX 줄까지 남깁니다.
 */
export function trimGapInputs(lines: string[]): string[] {
  const seenTopics = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (PROCESS.test(line)) continue;
    const topics = topicsOf(line);
    if ((topics.length > 0 && topics.every((t) => seenTopics.has(t))) || out.some((k) => overlap(k, line) >= SAME)) continue;
    if (out.length >= GAP_INPUTS_MAX) break;
    out.push(line);
    for (const t of topics) seenTopics.add(t);
  }
  return out;
}
