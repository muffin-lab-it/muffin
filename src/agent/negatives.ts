/**
 * 한 줄 요약 · 요약에 붙는 "묻지 않은 부정 문장" 정리 (리더, 11/22).
 *
 * 11/21 점검 16문항: 답은 맞는데 한 줄 요약이 "…지만, 인과관계는 확인되지 않아요" · "…지만 근본 원인은 알기 어려워요" 로 끝나는 것이 여럿이었습니다.
 * 지시문으로 막아도 남아서, 코드가 두 가지만 다듬습니다. 사실을 바꾸지 않고 덧붙은 부정 구절만 뗍니다.
 *  - 한 줄 요약: "A했지만, B는 확인되지 않아요" → "A했어요". 앞 구절이 과거형("~했지만 · ~올랐지만")일 때만 (어미를 안전하게 바꿀 수 있는 경우).
 *  - 요약: 원인을 묻지 않은 질문인데 "원인은 확인할 수 없어요" 뿐인 문장은 뺍니다. 문장이 하나뿐이면 그대로 둡니다.
 */
import type { Intent, WriterOutput } from "./schema";

export const NEGATIVE = /(확인되지\s*않|확인할\s*수\s*(?:는|도)?\s*없|확인하지\s*못|단정할\s*수\s*(?:는|도)?\s*없|판단할\s*수\s*(?:는|도)?\s*없|알\s*수\s*(?:는|도)?\s*없|알기\s*어려|특정하기\s*어려|확인하기\s*어려|단정하기\s*어려|판단하기\s*어려|말하기\s*어려|설명하기\s*어려)/;
/** 마지막 글자의 받침이 ㅆ 인지 (과거형 "했 · 았 · 었 · 였") */
export const endsPast = (text: string) => {
  const code = text.charCodeAt(text.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 20;
};

/** "-지만" 앞 구절을 해요체로 끝맺기. 과거형(했 · 였)과 흔한 끝(있 · 없 · 쉽 · 않 · 같 · 많 · 하)만 바꾸고, 나머지는 null (어미를 안전하게 바꿀 수 없음) */
const POLITE: [string, string][] = [["있", "있어요"], ["없", "없어요"], ["높", "높아요"], ["낮", "낮아요"], ["않", "않아요"], ["같", "같아요"], ["많", "많아요"], ["쉽", "쉬워요"], ["어렵", "어려워요"], ["하", "해요"]];
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
/** 확인된 내용이 함께 들었을 수 있는 이음 ("…했고 · …이며 · …는데") */
const MIXED = /지만|으나|[는은인]데|이며|으며|했고|됐고|였고|이고|하고/;

/**
 * 요약의 첫 문장이 한계만 말하면("기사 본문을 확보하지 못해 오늘 환율 관련 뉴스의 내용과 맥락은 정리할 수 없어요", 11/23 운영) 확인하지 못한 것으로 내립니다.
 * 베타 A2: 요약 첫 문장은 확인된 사실로. 값이 든 문장, 문장이 하나뿐인 요약은 그대로 둡니다. 같은 한계가 이미 있으면 trimRepeats 가 한 줄로 줄입니다.
 */
export function dropLeadingLimit(output: Pick<WriterOutput, "summary" | "dataGaps">): Pick<WriterOutput, "summary" | "dataGaps"> {
  const m = /^([^.!?]*[.!?])\s+(\S[\s\S]*)$/.exec(output.summary.trim());
  if (!m || !LEAD_LIMIT.test(m[1]!) || HAS_VALUE.test(m[1]!)) return output;
  const first = m[1]!;
  // 확인된 내용과 한계가 한 문장에 같이 들었으면("뉴스 제목은 금리 동결을 전하지만 기사 본문은 확인하지 못했어요") 앞 구절을 첫 문장으로 남기고
  // 한계 구절만 내립니다. 어미를 안전하게 바꿀 수 없거나 다른 꼴로 섞인 문장은 그대로 둡니다 (#147 Codex 리뷰)
  const split = /^(.+?)(?:지만|으나),?\s+(.+)$/.exec(first);
  if (split && !LEAD_LIMIT.test(split[1]!) && LEAD_LIMIT.test(split[2]!)) {
    const head = politeEnd(split[1]!.trim());
    return head ? { summary: `${head} ${m[2]!}`, dataGaps: [...output.dataGaps, split[2]!] } : output;
  }
  if (MIXED.test(first)) return output;
  return { summary: m[2]!, dataGaps: [...output.dataGaps, first] };
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

/**
 * "이며" 앞이 명사로 끝난다고 확실한 경우만 나눕니다: 숫자 · 영문 · 닫는 괄호, 또는 지표 · 자료 이름에 흔한 끝 글자(률 · 값 · 기준 · 표기 · 목록 …).
 * 꺾이며 · 출렁이며 · 움직이며 같은 동사는 끝 글자가 이 목록에 없어 그대로 둡니다. 모르는 꼴은 바꾸지 않습니다 (#147 Codex 리뷰: 동사 목록 밖이면 명사로 보던 것)
 */
const NOUN_END = /(?:[0-9A-Za-z)]|률|율|치|값|준|표|기|간|점|료|리|과|용|위|균|록|수|액|량|폭|세|격|가|일|월|날|금|인|향|황|화|장|업|품|국|행|책|계|산|채|권|차|도|대|분|중|문|별|형|식|선|물|해|전|사)$/;
/** 받침이 있으면 "이에요", 없으면 "예요". 숫자 · 영문은 읽는 소리로 ("20이에요", "2예요", "CPI예요", "LPR이에요") */
const copula = (word: string) => {
  const last = word.replace(/\)+$/, "").at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  const batchim = code >= 0 && code <= 11171 ? code % 28 !== 0 : /[0136789LMNR]/i.test(last);
  return batchim ? `${word}이에요.` : `${word}예요.`;
};
/**
 * "A이며 B예요" · "A했으며 B예요" 를 두 문장으로 나눕니다 (베타 D2: "~이며 ~해요 이런 말투 다 티 나요", 11/23 운영 주의점 12개 중 6개).
 * 명사 + 이며 → "명사이에요/예요.", 과거형 + 으며 → "했어요." 만 바꾸고 나머지(동사 + 이며, 모르는 꼴)는 그대로 둡니다.
 */
export function splitEmyeo(text: string): string {
  return text.replace(/([가-힣A-Za-z0-9)]+)(이며|으며),?\s+/g, (all, word: string, suffix: string) => {
    // 과거형("했으며")과 흔한 끝("않으며 · 없으며 · 있으며 · 같으며 · 많으며")만 해요체로 끝맺습니다 (11/23 운영 "뜻하지 않으며")
    if (suffix === "으며") {
      const end = politeEnd(word);
      return end ? `${end} ` : all;
    }
    if (!NOUN_END.test(word)) return all;
    return `${copula(word)} `;
  });
}

/** 조회 과정을 말하는 문장: "조회가 실패해 이전 응답을 재사용했으므로 …", "조회 실패로 13시간 전 뉴스 응답을 재사용했어요" */
const FETCH_FAIL = /조회(?:가|는|에)?\s*실패/;
/** 저장된 응답을 다시 썼다는 말 (저장된 응답을 쓴 조회에만 맞는 말) */
const REUSED = /재사용|이전\s*(?:조회\s*)?응답|저장된\s*응답|전에\s*받은\s*(?:같은\s*조회의\s*)?응답|응답을\s*다시\s*(?:썼|사용)/;
const fetchTalk = (s: string) => FETCH_FAIL.test(s) || REUSED.test(s);
/** tool 이름 → 그 조회를 가리키는 말 (작성은 tool 이름 대신 "뉴스 조회 · 환율 조회" 처럼 씁니다) */
const TOOL_WORDS: Record<string, RegExp> = {
  get_korean_economic_news: /뉴스|기사/,
  get_fx_krw_rate: /환율/,
  get_rate_data: /금리/,
  get_macro_indicators: /물가|실업|CPI|소비자물가/i,
  get_etf_kr_price: /ETF/i,
  get_kr_stock_index: /지수|코스피|코스닥/,
  get_us_stock_index: /지수|S&P|나스닥|다우/i,
};

/**
 * 요약 · 주의점에서 조회 과정(실패 · 저장된 응답을 다시 씀)을 말하는 문장을 뺍니다 (11/23 운영: 뉴스 요약 셋째 문장 "다만 조회가 실패해 이전 응답을 재사용했으므로 …").
 * fallbackTools: 저장된 응답을 쓴 tool. 그 조회는 "확인하지 못한 것" 에 코드가 한 줄 넣으므로(report.ts fallbackGaps) 작성이 쓴 같은 말은 버리고,
 * 확인하지 못한 것에서도 뺍니다. 다른 조회의 실패(저장된 응답도 없던 것)는 그 말이 유일한 안내라 확인하지 못한 것으로 옮기고 그대로 둡니다 (#151 Codex 리뷰).
 * 요약이 그 문장뿐이면 그대로 둡니다.
 */
export function dropFetchTalk(output: WriterOutput, fallbackTools: readonly string[]): WriterOutput {
  const covered = (s: string) => fallbackTools.length > 0 && (REUSED.test(s) || fallbackTools.some((t) => TOOL_WORDS[t]?.test(s)));
  const moved: string[] = [];
  const sentences = output.summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter((s) => !fetchTalk(s));
  const summary = kept.length > 0 && kept.length < sentences.length ? kept.join(" ") : output.summary;
  if (summary !== output.summary) moved.push(...sentences.filter(fetchTalk));
  const caveats = output.caveats.filter((c) => !fetchTalk(c));
  moved.push(...output.caveats.filter(fetchTalk));
  const gaps = [...output.dataGaps.filter((g) => !(fetchTalk(g) && covered(g))), ...moved.filter((m) => !covered(m))];
  if (summary === output.summary && caveats.length === output.caveats.length && gaps.length === output.dataGaps.length && gaps.every((g, i) => g === output.dataGaps[i])) return output;
  return { ...output, summary, caveats, dataGaps: gaps };
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
/** 기사를 고르거나 뺀 작업 설명 ("경제와 관련 없는 기사도 있어 추렸어요", 11/23 화면 QA). 사용자에게 필요 없는 과정 말이라 주의점 · 확인하지 못한 것에서 뺍니다 */
const PICK_TALK = /(?:기사|뉴스)[^.!?]*(?:추렸|추려|걸렀|걸러\s*냈|제외했|골랐|골라\s*(?:냈|썼))|관련\s*(?:없는|없어\s*보이는)\s*(?:기사|뉴스)/;
/** 오늘 날짜를 모른다는 말 (작성 입력에 오늘 날짜를 주므로 맞지 않는 말, src/agent/today.ts) */
const DATE_TALK = /(?:현재|오늘)\s*날짜\s*(?:정보가?\s*없|를\s*(?:알|확인)|와의\s*대응)|날짜\s*정보가?\s*없/;
export function dropPickTalk(lines: string[]): string[] {
  return lines
    .map((l) => l.split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !PICK_TALK.test(s) && !DATE_TALK.test(s)).join(" "))
    .filter((l) => l.trim().length > 0);
}

/**
 * 생활 영향 칸의 한계 문장("…만으로 알 수는 없어요", "…단정할 수 없어요")을 주의점으로 옮깁니다 (QA-03 · 11/21: 영향 카드가 주의 문구의 반복).
 * 작성 지시문(write.ts "주의 문구나 '~만으로는 알 수 없어요' 를 impact 에 쓰지 않습니다")만으로는 11/22 운영에서 영향 274칸 중 17칸에 남았습니다.
 * 관계 질문은 relation.ts 가 상관 · 인과 문장을 따로 모으고, 여기는 모든 질문의 한계 문장입니다.
 *  - "A할 수 있지만, B만으로 알 수는 없어요" → 영향에는 "A할 수 있어요", 주의점에 "B만으로 알 수는 없어요" (앞 구절 어미를 바꿀 수 있을 때만)
 *  - 한계뿐인 문장은 통째로 주의점으로 ("다만" 은 뗌). 칸이 비면 그 칸과 같은 자리의 제목을 함께 뺍니다 (impactTitles 는 impact 와 개수가 같아야 함)
 * 조건부 영향("…달라질 수 있어요")은 한계 문장이 아니라 그대로 둡니다. 주의점에 같은 한계가 겹치면 뒤의 trimRepeats 가 줄입니다
 */
export function moveImpactLimits<T extends WriterOutput>(output: T): T {
  const moved: string[] = [];
  const items = output.impact.map((item) =>
    item
      .split(/(?<=[.!?])\s+/)
      .filter((x) => x.trim())
      .flatMap((sentence) => {
        if (!NEGATIVE.test(sentence)) return [sentence];
        const m = /^(.+?)(지만|으나),?\s+(.+)$/.exec(sentence.trim());
        if (m && !NEGATIVE.test(m[1]!) && NEGATIVE.test(m[3]!)) {
          const head = politeEnd(m[1]!);
          if (head) {
            moved.push(m[3]!.replace(/^다만\s*,?\s*/, ""));
            return [head];
          }
        }
        moved.push(sentence.trim().replace(/^다만\s*,?\s*/, ""));
        return [];
      })
      .join(" "),
  );
  if (moved.length === 0) return output;
  const keep = items.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
  const titles = output.impactTitles;
  return {
    ...output,
    impact: keep.map((i) => items[i]!),
    ...(titles && titles.length === output.impact.length ? { impactTitles: keep.map((i) => titles[i]!) } : {}),
    caveats: [...output.caveats, ...moved.filter((x, i) => moved.indexOf(x) === i && !output.caveats.includes(x))],
  };
}

export function trimNegatives(input: WriterOutput, intent: Intent | undefined): WriterOutput {
  const output = moveImpactLimits(input);
  const decision = (t: string) => (intent === "decision" ? dropDecisionDisclaimer(t) : t);
  const headline = output.headline ? plainWords(decision(dropInternalPhrases(trimHeadline(output.headline)))) : output.headline;
  const lead = dropLeadingLimit({ summary: output.summary, dataGaps: output.dataGaps });
  const summary = splitEmyeo(plainWords(decision(dropInternalPhrases(dropUnaskedCause(lead.summary, intent, output.why.length > 0)))));
  const tidy = (lines: string[]) => lines.map((l) => splitEmyeo(plainWords(l)));
  const caveats = tidy(dropPickTalk(output.caveats));
  const dataGaps = tidy(dropPickTalk(lead.dataGaps));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return output === input && headline === output.headline && summary === output.summary && same(caveats, output.caveats) && same(dataGaps, output.dataGaps)
    ? input
    : { ...output, headline, summary, caveats, dataGaps };
}

/**
 * 사용자에게 보이는 글에 남은 장부 번호를 뗍니다 ("…점검하겠다고 밝혔어요. (E2-1)", "(ref E9-1, 2026-10-22)" → "(2026-10-22)", 11/25 로컬).
 * 작성은 근거를 refs 칸에 적는데, 지시문의 "(ref E…)" 모양을 글에 그대로 옮기는 일이 있습니다. 사용자는 E 번호가 무엇인지 모릅니다.
 * 괄호 안이 번호뿐이면 괄호째, 다른 말(날짜 등)이 함께 있으면 번호만 뗍니다. 괄호 밖 번호는 떼면 문장이 깨질 수 있어 두고, refs · numbers[].ref 같은 구조 칸은 건드리지 않습니다.
 */
const REF_ID = String.raw`(?:E\d+(?:-\d+)?|C\d+)`;
const REF_TOKEN = new RegExp(String.raw`(?:\b(?:refs?|근거|출처)\s*:?\s*)?(?<![A-Za-z0-9-])${REF_ID}(?![A-Za-z0-9-])`, "g");
const REF_GROUP = /\s*([(\[])([^()\[\]]*)([)\]])/g;
const HAS_REF = new RegExp(String.raw`(?<![A-Za-z0-9-])${REF_ID}(?![A-Za-z0-9-])`);

export function stripRefIds(text: string): string {
  if (!HAS_REF.test(text)) return text;
  const out = text
    .replace(REF_GROUP, (whole, open: string, inner: string, close: string) => {
      if (!HAS_REF.test(inner)) return whole;
      const rest = inner.replace(REF_TOKEN, "").replace(/^[\s,·/:]+|[\s,·/:]+$/g, "").replace(/\s*,\s*(?=,)/g, "");
      const lead = /^\s/.test(whole) ? " " : "";
      return rest ? `${lead}${open}${rest}${close}` : "";
    })
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out || text;
}

/** 작성 출력의 글 칸 전부에서 장부 번호를 뗍니다. 바뀐 것이 없으면 받은 그대로 */
export function dropRefIds<T extends WriterOutput>(output: T): T {
  const list = (xs: string[] | undefined) => xs?.map(stripRefIds);
  const next: T = {
    ...output,
    summary: stripRefIds(output.summary),
    headline: output.headline ? stripRefIds(output.headline) : output.headline,
    why: output.why.map((w) => ({ ...w, claim: stripRefIds(w.claim), evidence: stripRefIds(w.evidence) })),
    impact: list(output.impact)!,
    caveats: list(output.caveats)!,
    dataGaps: list(output.dataGaps)!,
    nextTopics: list(output.nextTopics)!,
    ...(output.impactTitles ? { impactTitles: list(output.impactTitles) } : {}),
    ...(output.topicReasons ? { topicReasons: list(output.topicReasons) } : {}),
  };
  return JSON.stringify(next) === JSON.stringify(output) ? output : next;
}
