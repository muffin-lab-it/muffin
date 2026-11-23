/**
 * 일부만 범위 밖인 질문의 구제 (리더, 11/21).
 *
 * 11/20 베타: "물가와 금리, cpi까지 폭넓게 조사하고 한국과 미국의 선물 시장 조사하기" 가 통째로 반려됐습니다. 분류 지시문에는 "대상이 범위 밖이면 반드시
 * 범위 밖" 만 있고 일부만 범위 밖인 경우가 없어, 분류가 "선물 시장은 tool 범위를 벗어나므로 전체 요청을 범위 밖으로" 보냅니다 (11/21 실측: 같은 질문 12번 중 5번).
 * 분류가 범위 밖이라 해도, 질문에 머핀이 다루는 대상(환율 · 금리 · 물가 · 뉴스)이 있고 자료를 달라는 요청이면 그 부분만 조사합니다.
 * 뜻 · 계산법 · 가정을 묻는 질문("환율 우대 90% 는 무슨 뜻", "물가 상승률이 2% 라면")은 자료로 답할 수 없어 그대로 범위 밖입니다.
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import type { InvokableTool } from "./supplement";

const AREA_WORDS: [RegExp, string, string][] = [
  [/환율|달러|엔화|유로|원화/, areaTools.fx, "환율"],
  [/금리|국채/, areaTools.rate, "금리"],
  [/물가|인플레|\bcpi\b|실업|고용/i, areaTools.macro, "물가 · 고용 지표"],
  // "뉴스" 라는 형식만으로는 구제하지 않습니다: "오늘 스포츠 뉴스 알려줘" 는 조사할 경제 대상이 없습니다 (#128 Codex 리뷰)
  [/(경제|금융|증시|시장).{0,12}(뉴스|기사|보도)|(뉴스|기사|보도).{0,12}(경제|금융|증시)/, areaTools.news, "경제 뉴스"],
];
/** 자료를 달라는 요청 */
const DATA_REQUEST = /조사|알려|얼마|어때|추이|흐름|현황|비교|분석|살펴|확인해|정리해/;
/** 뜻 · 계산법 · 가정을 묻는 질문. 자료로 답하는 질문이 아닙니다 */
const CONCEPT = /뜻|의미|뭐야|뭔가요|무엇인가|라면|어떻게\s*(잡히|계산|비교|해석)|필요한가|차이를|공식|우대|민감도|볼록성|예로|예를/;

export type ScopeRescue = { tools: string[]; areas: string[] };

/** 범위 밖으로 분류된 질문 중 조사할 수 있는 부분. 없으면 null */
export function rescueScope(question: string): ScopeRescue | null {
  if (!DATA_REQUEST.test(question)) return null;
  const hits = AREA_WORDS.filter(([re]) => re.test(question));
  if (hits.length === 0) return null;
  // 뜻 · 계산법을 묻는 말이 있어도, 다루는 영역을 둘 이상 묻는 복합 질문은 자료로 답할 부분이 있습니다
  // (11/22 QA: "한국 금리랑 물가도 알려주고 … 환율이 무슨 의미인지도 알려줘. 그리고 저녁 메뉴도" 가 "의미" 때문에 통째로 반려)
  if (CONCEPT.test(question) && hits.length < 2) return null;
  return { tools: [...new Set(hits.map(([, tool]) => tool))], areas: [...new Set(hits.map(([, , name]) => name))] };
}

/** 작성 입력에 붙이는 한 줄과, 리포트의 "확인하지 못한 것" 에 코드가 넣는 한 줄 */
export function scopeNote(rescue: ScopeRescue): string {
  return [
    `[질문의 범위] 질문의 일부는 머핀이 다루지 않는 대상입니다. ${rescue.areas.join(" · ")} 자료로 답할 수 있는 부분만 답합니다.`,
    `다루지 않는 대상(선물 · 가상자산 · 개별 주식 등)에 대해서는 전망 · 방향 · 해석을 쓰지 않고, 요약 끝에 "이 부분은 다루지 않는다" 고 한 문장만 씁니다. 그 대상의 자료가 없다는 말을 주의점 · 확인하지 못한 것에 되풀이하지 않습니다.`,
  ].join("\n");
}
export function scopeGap(rescue: ScopeRescue): string {
  return `질문의 일부는 머핀이 다루는 범위 밖이라, ${rescue.areas.join(" · ")} 자료로 답할 수 있는 부분만 조사했어요.`;
}

/**
 * 금융 질문에 섞인 범위 밖 부탁 (11/22 QA: "한국 금리랑 물가도 알려주고 … 그리고 오늘 저녁 메뉴도 추천해줘" 에 생활 영향 카드와 본문이 김치찌개를 추천).
 * 분류는 금융 부분 때문에 범위 안으로 보내고, 작성은 질문의 부탁을 다 들어주려 합니다. 질문을 문장 · "그리고" 단위로 나눠,
 * 금융 낱말이 없는데 무언가를 해 달라는 조각을 범위 밖 부분으로 봅니다.
 */
const FINANCE_WORD = /환율|달러|원화|엔화|유로|위안|금리|물가|인플레|cpi|실업|고용|etf|이티에프|kodex|tiger|코스피|코스닥|나스닥|s&p|다우|지수|주식|주가|증시|투자|경제|뉴스|기사|대출|예금|적금|이자|환전|여행|돈|가격|수익률|채권|국채|저축|월급|소득|세금|연금/i;
const REQUEST_WORD = /알려|추천|해\s*줘|해\s*주세요|골라|짜\s*줘|써\s*줘|만들어|정해\s*줘|찾아\s*줘|소개해/;
const GENERIC = new Set(["오늘", "내일", "이번", "요즘", "추천", "추천해줘", "알려줘", "해줘", "그리고", "같이", "하나", "어떤", "무엇", "뭐", "좀", "그냥"]);
const PARTICLE = /(?:으로|에서|하고|이랑|랑|도|를|을|은|는|이|가|의|로|에|만)$/;

/**
 * 답하는 방식을 정해 달라는 부탁 ("기준일과 출처도 알려줘", "확인이 어려운 부분은 구분해서 알려줘", "표로 정리해줘").
 * 금융 낱말이 없어도 금융 답의 일부라 범위 밖 부탁이 아닙니다 (11/23 운영: 서영 QA 질문 두 개에 "… 부분은 금융 정보가 아니라 답하지 않았어요" 가 붙음)
 */
const ANSWER_FORM = /출처|기준일|기준\s*날|날짜|근거|한계|구분|확인(?:이|하기)?\s*어려|확인\s*(?:못|안)|불확실|단위|표로|표\s*형식|짧게|간단히|쉽게|자세히|요약해|정리해|숫자|수치/g;
/** 답하는 방식 부탁에 함께 쓰이는 말 (이것만 남으면 답하는 방식만 말한 조각) */
const FORMAT_FILLER = /^(?:부분|내용|결과|답|답변|설명|같이|함께|따로|각각|어려운|확인|확인이|해서|나눠서|나눠|가능하면|가능한|모두|전부|있는|없는|것|거)$/;

/** 조각의 내용 낱말 (조사 · 부탁하는 말 · 흔한 말 제외) */
const keysOf = (text: string) =>
  text.split(/\s+/).map((w) => w.replace(/[^가-힣a-zA-Z]/g, "").replace(PARTICLE, "")).filter((w) => w.length >= 2 && !GENERIC.has(w) && !REQUEST_WORD.test(w));

/**
 * 답하는 방식만 말한 조각인지. 방식 낱말을 지운 뒤 다른 내용 낱말이 남으면 아닙니다
 * (#154 Codex 리뷰: "저녁 메뉴도 간단히 추천해줘" 는 "간단히" 가 있어도 저녁 메뉴를 부탁한 조각)
 */
function answerFormOnly(clause: string): boolean {
  if (!new RegExp(ANSWER_FORM.source).test(clause)) return false;
  return keysOf(clause.replace(ANSWER_FORM, " ")).every((w) => FORMAT_FILLER.test(w));
}

export type OffTopic = { parts: string[]; keys: string[] };

export function offTopicParts(question: string): OffTopic | null {
  const clauses = question.split(/[.?!\n]+|그리고|그리구|그런데|근데|또한/).map((c) => c.trim()).filter(Boolean);
  if (clauses.length < 2) return null;
  const parts = clauses.filter((c) => REQUEST_WORD.test(c) && !FINANCE_WORD.test(c) && !answerFormOnly(c));
  // 금융 조각이 하나도 없으면 질문 전체가 범위 밖이라 분류가 처리합니다
  if (parts.length === 0 || parts.length === clauses.length) return null;
  const keys = [...new Set(parts.flatMap(keysOf))];
  return keys.length ? { parts, keys } : null;
}

/** 작성 입력에 붙이는 [범위 밖 부탁] */
export function offTopicNote(off: OffTopic): string {
  return [
    `[범위 밖 부탁] 질문의 ${off.parts.map((p) => `"${p}"`).join(", ")} 부분은 금융 정보가 아니라 머핀이 답하지 않습니다.`,
    `그 부분은 summary · headline · why · impact · impactTitles · nextTopics 어디에도 답하거나 추천하지 않습니다. 금융 부분만 답하고, 다루지 않은 부분은 코드가 "확인하지 못한 것" 에 한 줄 적습니다.`,
  ].join("\n");
}

/** 리포트의 "확인하지 못한 것" 에 코드가 넣는 한 줄 */
export function offTopicGap(off: OffTopic): string {
  return `질문의 ${off.parts.map((p) => `"${p}"`).join(", ")} 부분은 머핀이 다루는 금융 정보가 아니라 답하지 않았어요.`;
}

/**
 * 작성이 그래도 범위 밖 부분에 답했으면 그 문장 · 항목을 뺍니다. 범위 밖 조각의 낱말("저녁", "메뉴")이 든 문장만 대상입니다.
 * 생활 영향과 그 제목은 짝을 맞춰 같이 뺍니다. 요약에서 모든 문장이 빠지면 요약은 그대로 둡니다.
 */
export function dropOffTopic<T extends { summary: string; headline?: string | null; why: { claim: string; evidence: string }[]; impact: string[]; impactTitles?: string[]; caveats: string[]; dataGaps: string[]; nextTopics: string[]; topicReasons?: string[] }>(output: T, off: OffTopic): T {
  const hit = (t: string) => off.keys.some((k) => t.includes(k));
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
  const keepText = (t: string) => {
    const paragraphs = t.split(/\n{2,}/).map((p) => sentences(p).filter((x) => !hit(x)).join(" ")).filter((p) => p.trim());
    return paragraphs.length ? paragraphs.join("\n\n") : t;
  };
  const impactKeep = output.impact.map((x, i) => !hit(x) && !hit(output.impactTitles?.[i] ?? ""));
  const topicKeep = output.nextTopics.map((x) => !hit(x));
  return {
    ...output,
    summary: keepText(output.summary),
    ...(output.headline ? { headline: hit(output.headline) ? keepText(output.headline) : output.headline } : {}),
    why: output.why.filter((w) => !hit(`${w.claim} ${w.evidence}`)),
    impact: output.impact.filter((_, i) => impactKeep[i]),
    ...(output.impactTitles ? { impactTitles: output.impactTitles.filter((_, i) => impactKeep[i]) } : {}),
    caveats: output.caveats.filter((x) => !hit(x)),
    // 작성이 직접 쓴 "저녁 메뉴는 범위 밖이라 답하지 않아요" 는 코드가 넣는 한 줄(offTopicGap)과 겹쳐 뺍니다
    dataGaps: output.dataGaps.filter((x) => !hit(x)),
    nextTopics: output.nextTopics.filter((_, i) => topicKeep[i]),
    ...(output.topicReasons ? { topicReasons: output.topicReasons.filter((_, i) => topicKeep[i]) } : {}),
  };
}

/** 질문에 이름이 나온 영역의 tool. 분류가 빠뜨린 영역을 조사에 보탤 때 씁니다 ("미국 여행 갈 때 환율이 무슨 의미인지" 에 환율 tool 이 빠짐) */
export function mentionedTools(question: string): string[] {
  return [...new Set(AREA_WORDS.filter(([re]) => re.test(question)).map(([, tool]) => tool))];
}

/** 질문에 이름이 나온 영역의 tool 기본 입력. 나라 · 통화를 말했으면 그쪽으로 */
function defaultInput(tool: string, question: string): Record<string, unknown> | null {
  const us = /미국|연준|\bfed\b/i.test(question);
  if (tool === areaTools.fx) return { currency: /엔화|엔\s*환율|일본/.test(question) ? "JPY" : /유로|유럽/.test(question) ? "EUR" : "USD", days: 30 };
  if (tool === areaTools.rate) return { series: us && !/한국/.test(question) ? "DFF" : "BOK", days: 30 };
  if (tool === areaTools.macro) return { country: us && !/한국/.test(question) ? "US" : "KR", indicator: /실업|고용/.test(question) && !/물가/.test(question) ? "unemployment" : "cpi", endMonth: null, months: 1 };
  return null;
}

/**
 * 질문이 이름을 댄 영역(환율 · 금리 · 물가)인데 조사가 그 tool 을 부르지 않았으면 기본 입력으로 한 번 부릅니다 (11/22 QA 복합 질문: 같은 질문 3번 중
 * 한 번은 환율을, 한 번은 금리 · 물가를 조사가 건너뛰어 "환율 자료가 없어요" · "금리와 물가 자료는 근거로 포함되지 않았어요" 가 나옴).
 * 채운 장부 번호를 돌려줍니다. 실패해도 이어 갑니다 (error step 만 남음).
 */
export async function ensureMentioned(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<string[]> {
  const before = new Set(ctx.evidence.map((e) => e.id));
  const called = new Set(ctx.evidence.map((e) => e.tool));
  const missing = mentionedTools(question).filter((t) => t !== areaTools.news && !called.has(t));
  const rc = new RunContext(ctx);
  await Promise.all(missing.map((name) => {
    const tool = tools.find((t) => t.name === name);
    const input = defaultInput(name, question);
    return tool && input ? tool.invoke(rc, JSON.stringify(input)).catch(() => undefined) : undefined;
  }));
  return ctx.evidence.filter((e) => !before.has(e.id)).map((e) => e.id);
}
