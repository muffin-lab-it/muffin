/**
 * 한 줄 요약 · 요약에 붙는 "묻지 않은 부정 문장" 정리 (리더, 11/22).
 *
 * 11/21 점검 16문항: 답은 맞는데 한 줄 요약이 "…지만, 인과관계는 확인되지 않아요" · "…지만 근본 원인은 알기 어려워요" 로 끝나는 것이 여럿이었습니다.
 * 지시문으로 막아도 남아서, 코드가 두 가지만 다듬습니다. 사실을 바꾸지 않고 덧붙은 부정 구절만 뗍니다.
 *  - 한 줄 요약: "A했지만, B는 확인되지 않아요" → "A했어요". 앞 구절이 과거형("~했지만 · ~올랐지만")일 때만 (어미를 안전하게 바꿀 수 있는 경우).
 *  - 요약: 원인을 묻지 않은 질문인데 "원인은 확인할 수 없어요" 뿐인 문장은 뺍니다. 문장이 하나뿐이면 그대로 둡니다.
 */
import type { Intent, WriterOutput } from "./schema";

export const NEGATIVE = /(확인되지\s*않|확인할\s*수\s*(?:는|도)?\s*없|확인하지\s*못|단정할\s*수\s*(?:는|도)?\s*없|판단할\s*수\s*(?:는|도)?\s*없|알\s*수\s*(?:는|도)?\s*없|알기\s*어려|특정하기\s*어려|확인하기\s*어려|단정하기\s*어려|판단하기\s*어려|말하기\s*어려)/;
/** 마지막 글자의 받침이 ㅆ 인지 (과거형 "했 · 았 · 었 · 였") */
export const endsPast = (text: string) => {
  const code = text.charCodeAt(text.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 20;
};

/** "-지만" 앞 구절을 해요체로 끝맺기. 과거형(했 · 였)과 흔한 끝(있 · 없 · 쉽 · 않 · 같 · 많 · 하)만 바꾸고, 나머지는 null (어미를 안전하게 바꿀 수 없음) */
const POLITE: [string, string][] = [["있", "있어요"], ["없", "없어요"], ["않", "않아요"], ["같", "같아요"], ["많", "많아요"], ["쉽", "쉬워요"], ["어렵", "어려워요"], ["하", "해요"]];
export function politeEnd(head: string): string | null {
  if (endsPast(head)) return `${head}어요.`;
  const hit = POLITE.find(([end]) => head.endsWith(end));
  return hit ? `${head.slice(0, -hit[0].length)}${hit[1]}.` : null;
}

/** "A했지만, B는 확인되지 않아요" 꼴이면 "A했어요" 로 ("전하지만" → "전해요" 처럼 흔한 끝도, 11/23 뉴스 질문). 아니면 받은 그대로 */
export function trimHeadline(headline: string): string {
  const m = /^(.+?)(지만|으나),?\s+([^.]*)\.?$/.exec(headline.trim());
  if (!m || !NEGATIVE.test(m[3]!) || NEGATIVE.test(m[1]!)) return headline;
  return politeEnd(m[1]!) ?? headline;
}

/** 요약 첫 문장이 될 수 없는 한계 문장: NEGATIVE 와 "정리할 수 없어요 · 답할 수 없어요" 꼴 */
const LEAD_LIMIT = new RegExp(`${NEGATIVE.source}|(?:정리|설명|답|말|요약)할\\s*수\\s*(?:는|도)?\\s*없`);
const HAS_VALUE = /\d[\d,]*(?:\.\d+)?\s*(?:%|원|포인트|bp|건|개)/;

/**
 * 요약의 첫 문장이 한계만 말하면("기사 본문을 확보하지 못해 오늘 환율 관련 뉴스의 내용과 맥락은 정리할 수 없어요", 11/23 운영) 확인하지 못한 것으로 내립니다.
 * 베타 A2: 요약 첫 문장은 확인된 사실로. 값이 든 문장, 문장이 하나뿐인 요약은 그대로 둡니다. 같은 한계가 이미 있으면 trimRepeats 가 한 줄로 줄입니다.
 */
export function dropLeadingLimit(output: Pick<WriterOutput, "summary" | "dataGaps">): Pick<WriterOutput, "summary" | "dataGaps"> {
  const m = /^([^.!?]*[.!?])\s+(\S[\s\S]*)$/.exec(output.summary.trim());
  if (!m || !LEAD_LIMIT.test(m[1]!) || HAS_VALUE.test(m[1]!)) return output;
  return { summary: m[2]!, dataGaps: [...output.dataGaps, m[1]!] };
}

/**
 * 사용자에게 뜻이 통하지 않는 내부 사정 · 영어 용어를 풀어 씁니다 (베타 C3: 주의점에 "본문은 요청하지 않았습니다. RSS 제목 …", 11/23 운영: "mid-market 환율").
 * tool 메모의 말을 작성이 옮긴 것이라 메모도 고쳤고, 그래도 남는 것을 여기서 고칩니다.
 */
export function plainWords(text: string): string {
  return text
    .replace(/요청하지\s*않았/g, "보지 않았")
    .replace(/\bmid-?market\b\s*/gi, "매수·매도 중간값 ")
    .replace(/\bRSS\s*(?:의\s*)?/g, "")
    .replace(/Google\s*News\s*(?:의\s*)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "이며" 앞이 동사 줄기인 경우(보이며 · 움직이며)는 문장을 나누지 않습니다 */
const VERB_STEM = /(?:보|움직|줄|높|늘|쌓|쓰|놓|붙|섞|먹|기울|녹|끓|죽|속|밝히|드러|여)$/;
/** 받침이 있으면 "이에요", 없으면 "예요" */
const copula = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? `${word}이에요.` : `${word}예요.`;
};
/**
 * "A이며 B예요" · "A했으며 B예요" 를 두 문장으로 나눕니다 (베타 D2: "~이며 ~해요 이런 말투 다 티 나요", 11/23 운영 주의점 12개 중 6개).
 * 명사 + 이며 → "명사이에요/예요.", 과거형 + 으며 → "했어요." 만 바꾸고 나머지는 그대로 둡니다.
 */
export function splitEmyeo(text: string): string {
  return text.replace(/([가-힣A-Za-z0-9)]+)(이며|으며),?\s+/g, (all, word: string, suffix: string) => {
    if (suffix === "으며") return endsPast(word) ? `${word}어요. ` : all;
    if (!/[가-힣A-Za-z0-9)]$/.test(word) || VERB_STEM.test(word)) return all;
    return `${copula(word)} `;
  });
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
const DISCLAIMER = /(?:대신\s*(?:결정|판단)(?:해\s*드릴|할|하지)?\s*(?:수\s*(?:는|도)?\s*없|않)|대신할\s*수\s*(?:는|도)?\s*없|대신하지\s*않|판단은\s*(?:본인|사용자|직접)|결정은\s*(?:본인|사용자|직접))/;
export function dropDecisionDisclaimer(text: string): string {
  const lead = /^([^.!?]{0,60}?)(?:지만|으나|는데)\s*,?\s*/.exec(text);
  if (lead && DISCLAIMER.test(lead[1]!)) return text.slice(lead[0].length);
  const first = /^[^.!?]*[.!?]\s*/.exec(text);
  if (first && DISCLAIMER.test(first[0]) && !/\d/.test(first[0]) && text.length > first[0].length) return text.slice(first[0].length);
  return text;
}

/**
 * 검증 뒤의 출력을 다듬습니다 (사실은 바꾸지 않음): 한 줄 요약의 부정 꼬리, 묻지 않은 원인 한계, 첫 문장의 한계(→ 확인하지 못한 것),
 * 내부 용어, "~이며" 문장 나누기. 바뀐 것이 없으면 받은 그대로 돌려줍니다. 같은 한계의 되풀이는 이 뒤에 trimRepeats 가 줄입니다.
 */
export function trimNegatives(output: WriterOutput, intent: Intent | undefined): WriterOutput {
  const decision = (t: string) => (intent === "decision" ? dropDecisionDisclaimer(t) : t);
  const headline = output.headline ? plainWords(decision(dropInternalPhrases(trimHeadline(output.headline)))) : output.headline;
  const lead = dropLeadingLimit({ summary: output.summary, dataGaps: output.dataGaps });
  const summary = splitEmyeo(plainWords(decision(dropInternalPhrases(dropUnaskedCause(lead.summary, intent, output.why.length > 0)))));
  const tidy = (lines: string[]) => lines.map((l) => splitEmyeo(plainWords(l)));
  const caveats = tidy(output.caveats);
  const dataGaps = tidy(lead.dataGaps);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return headline === output.headline && summary === output.summary && same(caveats, output.caveats) && same(dataGaps, output.dataGaps)
    ? output
    : { ...output, headline, summary, caveats, dataGaps };
}
