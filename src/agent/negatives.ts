/**
 * 한 줄 요약 · 요약에 붙는 "묻지 않은 부정 문장" 정리 (리더, 11/22).
 *
 * 11/21 점검 16문항: 답은 맞는데 한 줄 요약이 "…지만, 인과관계는 확인되지 않아요" · "…지만 근본 원인은 알기 어려워요" 로 끝나는 것이 여럿이었습니다.
 * 지시문으로 막아도 남아서, 코드가 두 가지만 다듬습니다. 사실을 바꾸지 않고 덧붙은 부정 구절만 뗍니다.
 *  - 한 줄 요약: "A했지만, B는 확인되지 않아요" → "A했어요". 앞 구절이 과거형("~했지만 · ~올랐지만")일 때만 (어미를 안전하게 바꿀 수 있는 경우).
 *  - 요약: 원인을 묻지 않은 질문인데 "원인은 확인할 수 없어요" 뿐인 문장은 뺍니다. 문장이 하나뿐이면 그대로 둡니다.
 */
import type { Intent, WriterOutput } from "./schema";

const NEGATIVE = /(확인되지\s*않|확인할\s*수\s*없|확인하지\s*못|단정할\s*수\s*없|판단할\s*수\s*없|알\s*수\s*없|알기\s*어려|특정하기\s*어려|확인하기\s*어려|단정하기\s*어려|판단하기\s*어려|말하기\s*어려)/;
/** 마지막 글자의 받침이 ㅆ 인지 (과거형 "했 · 았 · 었 · 였") */
const endsPast = (text: string) => {
  const code = text.charCodeAt(text.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 20;
};

/** "A했지만, B는 확인되지 않아요" 꼴이면 "A했어요" 로. 아니면 받은 그대로 */
export function trimHeadline(headline: string): string {
  const m = /^(.+?)(지만|으나),?\s+([^.]*)\.?$/.exec(headline.trim());
  if (!m || !NEGATIVE.test(m[3]!) || NEGATIVE.test(m[1]!)) return headline;
  const head = m[1]!;
  if (!endsPast(head)) return headline;
  return `${head}어요.`;
}

/** 원인을 묻지 않은 질문의 요약에서, 원인을 확인하지 못했다는 말뿐인 문장을 뺍니다 */
export function dropUnaskedCause(summary: string, intent: Intent | undefined, hasWhy = false): string {
  // 원인 질문이라도 원인 칸에 보도 · 데이터 근거를 적었으면, 요약의 "원인은 단정하기 어려워요" 문장은 그 근거를 가립니다 (한계는 주의점에 있음)
  if (!intent || (intent === "cause" && !hasWhy)) return summary;
  const paragraphs = summary.split(/\n{2,}/).map((p) => {
    const sentences = p.split(/(?<=[.!?])\s+/).filter(Boolean);
    // 한계만 말한 문장만 뺍니다. "…가 배경으로 보도됐지만, …는 확인되지 않았어요" 처럼 확인된 내용이 같이 든 문장은 그대로 둡니다 (#135 Codex 리뷰)
    const onlyLimit = (s: string) => /원인|이유|배경/.test(s) && NEGATIVE.test(s) && !/\d/.test(s) && !/지만|으나|는데|이며|했고|됐고|이고,/.test(s);
    const kept = sentences.filter((s) => !onlyLimit(s));
    return kept.length > 0 ? kept.join(" ") : p;
  });
  const out = paragraphs.join("\n\n");
  return out.trim().length > 0 ? out : summary;
}

/**
 * 내부 용어가 앞에 붙은 구절을 뗍니다. 작성이 지시문의 말을 그대로 옮겨 "장부의 계산 결과 기준 …" 처럼 쓰는 일이 있습니다 (11/22).
 * 사용자는 "장부" 가 무엇인지 모릅니다. 문장 뜻은 그대로 두고 그 머리 구절만 뺍니다.
 */
export function dropInternalPhrases(text: string): string {
  return text
    .replace(/(?:증거\s*)?장부(?:의|에\s*있는|상의?|에서)?\s*(?:계산\s*결과|계산값|값|자료)?\s*(?:기준(?:으로)?|에\s*따르면|로\s*보면)\s*,?\s*/g, "")
    .replace(/(?:증거\s*)?장부(?:의|에\s*있는|에서)\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 판단 요청 리포트의 요약 · 한 줄이 "매수 여부는 대신 결정할 수 없지만, …" 으로 시작하면 그 앞 구절을 뗍니다.
 * 화면 맨 위에 "투자 판단을 대신하지 않아요" 안내가 이미 있어 같은 말이 두 번 나옵니다 (11/22 QA). 그 말뿐인 첫 문장은 통째로 뺍니다.
 */
const DISCLAIMER = /(?:대신\s*(?:결정|판단)(?:해\s*드릴|할|하지)?\s*(?:수\s*없|않)|대신할\s*수\s*없|대신하지\s*않|판단은\s*(?:본인|사용자|직접)|결정은\s*(?:본인|사용자|직접))/;
export function dropDecisionDisclaimer(text: string): string {
  const lead = /^([^.!?]{0,60}?)(?:지만|으나|는데)\s*,?\s*/.exec(text);
  if (lead && DISCLAIMER.test(lead[1]!)) return text.slice(lead[0].length);
  const first = /^[^.!?]*[.!?]\s*/.exec(text);
  if (first && DISCLAIMER.test(first[0]) && !/\d/.test(first[0]) && text.length > first[0].length) return text.slice(first[0].length);
  return text;
}

/** 검증 뒤의 출력에 두 정리를 적용합니다. 바뀐 것이 없으면 받은 그대로 돌려줍니다 */
export function trimNegatives(output: WriterOutput, intent: Intent | undefined): WriterOutput {
  const decision = (t: string) => (intent === "decision" ? dropDecisionDisclaimer(t) : t);
  const headline = output.headline ? decision(dropInternalPhrases(trimHeadline(output.headline))) : output.headline;
  const summary = decision(dropInternalPhrases(dropUnaskedCause(output.summary, intent, output.why.length > 0)));
  return headline === output.headline && summary === output.summary ? output : { ...output, headline, summary };
}
