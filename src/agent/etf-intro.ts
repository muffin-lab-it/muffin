/**
 * Easy 요약의 ETF 소개 한 문장 (리더, 11/25 · QA-02).
 *
 * QA-02 (11/21): Easy 에서 상품을 처음 소개할 때 무엇에 투자하는지 한 문장으로 설명해 달라. 상품명에 든 브랜드 · 지수 이름을 안다고 전제하지 않는다.
 * 깊이 규칙(depth.ts Easy "처음 나오는 금융 상품 · 지수는 … 한 문장으로 먼저 풉니다")이 있지만 11/25 로컬 "KODEX 200 요즘 어때?" (Easy) 요약은
 * "KODEX 200은 2026-11-24 하루 반등했지만 …" 으로 바로 시작했습니다. 화면은 카드 아래 한 줄(app/components/format.ts etfBasisNote)로 같은 내용을 보여 줍니다.
 * Easy 요약이 ETF 이름을 설명 없이 쓰면, 그 이름이 처음 나오는 문장 앞에 장부의 기초지수(baseIndex)로 만든 한 문장을 넣습니다.
 * 대표 ETF 여럿을 비교하는 질문(이름 셋 이상)은 카드 이름에 자산군이 붙어 있어 넣지 않습니다.
 */
import { areaTools } from "./plan";
import type { Depth, Evidence } from "./schema";

const DIGIT_BATCHIM: Record<string, boolean> = { "0": true, "1": true, "2": false, "3": true, "4": false, "5": false, "6": true, "7": true, "8": true, "9": false };
/** 읽는 소리가 받침으로 끝나는 영문자 (엘 · 엠 · 엔 · 알) */
const LETTER_BATCHIM = /[LMNR]/i;

/** 마지막 글자를 읽은 소리에 받침이 있는지. 숫자는 끝자리로 (0 은 십 · 백 · 천 · 만 모두 받침), 괄호 · 기호는 건너뜀 */
export function hasBatchim(word: string): boolean {
  const last = word.replace(/\s*\([^)]*\)\s*$/, "").replace(/[^0-9A-Za-z가-힣]+$/, "").slice(-1);
  if (!last) return false;
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return code % 28 !== 0;
  if (/\d/.test(last)) return DIGIT_BATCHIM[last]!;
  return LETTER_BATCHIM.test(last);
}

const topic = (word: string) => (hasBatchim(word) ? "은" : "는");
const object = (word: string) => (hasBatchim(word) ? "을" : "를");

/** "KODEX 200은 코스피 200 지수를 따라가는 국내 상장 ETF예요." */
export function etfIntro(name: string, baseIndex: string): string {
  const base = baseIndex.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const target = /지수$/.test(base) ? base : `${base} 지수`;
  return `${name}${topic(name)} ${target}${object(target)} 따라가는 국내 상장 ETF예요.`;
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** Easy 요약에 설명 없이 나온 ETF(하나 · 둘)의 소개 문장을 그 이름이 처음 나오는 문장 앞에 넣습니다. 바뀐 것이 없으면 받은 그대로 */
export function withEtfIntro<T extends { summary: string }>(output: T, evidence: Evidence[], depth: Depth): T {
  if (depth !== "easy") return output;
  const etfs = new Map<string, string>();
  for (const e of evidence) {
    if (e.tool !== areaTools.etf) continue;
    const name = typeof e.values.name === "string" ? e.values.name.trim() : "";
    const base = typeof e.values.baseIndex === "string" ? e.values.baseIndex.trim() : "";
    if (name && base && output.summary.includes(name)) etfs.set(name, base);
  }
  if (etfs.size === 0 || etfs.size > 2) return output;
  const sentences = output.summary.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  let changed = false;
  for (const [name, base] of etfs) {
    const plainBase = squash(base.replace(/\s*\([^)]*\)\s*$/, ""));
    // 요약이 이미 기초지수나 "따라가 · 추종" 으로 그 상품을 설명하면 두지 않습니다. 상품 이름에 든 지수 이름("TIGER 미국S&P500" 의 S&P500)은 설명이 아님
    const rest = squash(sentences.join(" ").split(name).join(" "));
    if (rest.includes(plainBase) || sentences.some((s) => s.includes(name) && /따라가|추종/.test(s))) continue;
    const at = sentences.findIndex((s) => s.includes(name));
    if (at < 0) continue;
    sentences.splice(at, 0, etfIntro(name, base));
    changed = true;
  }
  return changed ? { ...output, summary: sentences.join(" ") } : output;
}
