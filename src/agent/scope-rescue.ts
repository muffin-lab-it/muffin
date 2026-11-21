/**
 * 일부만 범위 밖인 질문의 구제 (리더, 11/21).
 *
 * 11/20 베타: "물가와 금리, cpi까지 폭넓게 조사하고 한국과 미국의 선물 시장 조사하기" 가 통째로 반려됐습니다. 분류 지시문에는 "대상이 범위 밖이면 반드시
 * 범위 밖" 만 있고 일부만 범위 밖인 경우가 없어, 분류가 "선물 시장은 tool 범위를 벗어나므로 전체 요청을 범위 밖으로" 보냅니다 (11/21 실측: 같은 질문 12번 중 5번).
 * 분류가 범위 밖이라 해도, 질문에 머핀이 다루는 대상(환율 · 금리 · 물가 · 뉴스)이 있고 자료를 달라는 요청이면 그 부분만 조사합니다.
 * 뜻 · 계산법 · 가정을 묻는 질문("환율 우대 90% 는 무슨 뜻", "물가 상승률이 2% 라면")은 자료로 답할 수 없어 그대로 범위 밖입니다.
 */
import { areaTools } from "./plan";

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
  if (!DATA_REQUEST.test(question) || CONCEPT.test(question)) return null;
  const hits = AREA_WORDS.filter(([re]) => re.test(question));
  if (hits.length === 0) return null;
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
