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
    const kept = sentences.filter((s) => !(/원인|이유|배경/.test(s) && NEGATIVE.test(s) && !/\d/.test(s)));
    return kept.length > 0 ? kept.join(" ") : p;
  });
  const out = paragraphs.join("\n\n");
  return out.trim().length > 0 ? out : summary;
}

/** 검증 뒤의 출력에 두 정리를 적용합니다. 바뀐 것이 없으면 받은 그대로 돌려줍니다 */
export function trimNegatives(output: WriterOutput, intent: Intent | undefined): WriterOutput {
  const headline = output.headline ? trimHeadline(output.headline) : output.headline;
  const summary = dropUnaskedCause(output.summary, intent, output.why.length > 0);
  return headline === output.headline && summary === output.summary ? output : { ...output, headline, summary };
}
