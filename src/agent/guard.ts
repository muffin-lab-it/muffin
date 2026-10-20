/**
 * 투자 권유 표현 검사. 머핀랩은 리서치 도구이지 추천 서비스가 아닙니다.
 * "매수세", "매도 물량" 처럼 시장 상황을 설명하는 말은 허용하고, 행동을 지시하는 표현만 잡습니다.
 * 1단계에서 SDK output guardrail 로 옮겨 Traces 에 남깁니다. 검사 자체(패턴)는 그대로 둡니다.
 */
const ADVICE_PATTERNS: RegExp[] = [
  /(매수|매도)\s*(추천|권유|하세요|하십시오|해야|할\s*때|타이밍|기회)/,
  /(사|팔)(세요|십시오|야\s*(합니다|해요|할))/,
  /추천(합니다|드립니다|해요|드려요)/,
  /비중을?\s*(늘리|줄이|확대|축소)(세요|십시오|는\s*것이\s*좋|는\s*게\s*좋|라고)/,
  /투자(하세요|하십시오|를\s*권|하기\s*좋은\s*때)/,
  /(진입|매집|손절|익절)(하세요|하십시오|해야|할\s*때)/,
  /지금이\s*(살|팔|들어갈|나올)\s*(때|타이밍|기회)/,
];

/** 검사 대상 문장이 들어 있는 부분. 작성 출력과 최종 리포트 둘 다 이 모양을 만족합니다. */
export type AdviceText = {
  summary: string;
  why: { claim: string; evidence: string }[];
  impact: string[];
  caveats: string[];
  nextTopics: string[];
};

function textOf(report: AdviceText): string[] {
  return [
    report.summary,
    ...report.why.map((w) => `${w.claim} ${w.evidence}`),
    ...report.impact,
    ...report.caveats,
    ...report.nextTopics,
  ];
}

/** 권유 표현이 들어간 문장 목록. 비어 있으면 통과. */
export function findAdvice(report: AdviceText): string[] {
  return textOf(report).filter((t) => ADVICE_PATTERNS.some((p) => p.test(t)));
}
