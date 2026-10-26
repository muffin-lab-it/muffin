/**
 * ✍️ 작성의 깊이별 금융 규칙. 담당: @kani-market (하니).
 *
 * 같은 사실 목록을 받아도 Easy · Standard · Deep Dive 에서 설명 방식이 달라지는 부분을 여기서 정합니다.
 * write.ts(은선: 구성 · 문장 · 입력)와 파일을 나눠 두어 두 사람이 같은 파일을 고치며 충돌하지 않습니다.
 *
 * 이 파일에서 고치는 것
 *  - byDepth: 깊이별 항목 수 · 용어 처리 · 비유 허용 범위. 금융적으로 빠뜨리면 안 되는 것(예: 환율 상승 = 원화 약세)을 깊이마다 적습니다.
 *  - financeRules: 깊이와 상관없이 지킬 금융 표현 규칙 (예: 금리 차이는 %p, 수익률과 가격 변동률 구분). 비어 있으면 지시문에서 빠집니다.
 *  - modeRules: 판단 요청("사도 돼?") 모드에서 쓰는 문구.
 * README "설명 깊이 정의" 표와 같아야 하고, 바꾸면 표도 같이 고칩니다. 테스트는 depth.test.ts.
 */
import type { Depth, ReportMode } from "./schema";

export const byDepth: Record<Depth, string> = {
  easy: `[설명 깊이: Easy — 금융을 처음 보는 사람]
- summary 2문장. 첫 문장은 질문에 대한 답, 둘째 문장은 핵심 숫자 하나.
- numbers 최대 2개. why 최대 2개, 비유를 하나 써도 좋습니다. impact 2개. nextTopics 2개.
- 전문용어는 쓰지 않습니다. 꼭 써야 하면 괄호로 풀어 씁니다. 예: 괴리율(ETF 가격과 실제 자산가치의 차이). caveats 도 같은 규칙입니다.`,
  standard: `[설명 깊이: Standard — 경제 기사를 읽는 사람]
- summary 3문장. numbers 최대 4개. why 최대 3개. impact 3개. nextTopics 4개.
- 용어는 첫 등장 때 한 번 짧게 설명합니다.`,
  deep: `[설명 깊이: Deep Dive — 숫자를 직접 해석하는 사람]
- summary 3문장 + 배경 1문단. numbers 4개 이상(장부에 있는 만큼), 기간 비교를 반드시 포함합니다.
- why 는 데이터가 뒷받침하는 만큼만. 서로 상충하는 요인이 있으면 함께 적고 어느 쪽이 데이터상 더 설명력이 있는지 씁니다.
- impact 3개 이상. caveats 를 빠짐없이. nextTopics 4개 이상, 같이 볼 지표 이름을 포함합니다.
- 용어는 설명 없이 씁니다.`,
};

/**
 * 깊이와 상관없이 지킬 금융 표현 규칙. 아직 비어 있습니다 (하니가 채움).
 * 예: "- 금리 차이는 %p 로 적고 % 와 섞지 않습니다", "- 환율이 올랐다 = 원화 가치가 내렸다 를 Easy 에서는 함께 적습니다".
 */
export const financeRules = ``;

/** 리포트 모드별 문구. research 는 추가 규칙 없음, out_of_scope 는 작성까지 오지 않습니다. */
export const modeRules: Record<ReportMode, string> = {
  research: "",
  decision_facts: `[모드: 판단 요청]
질문은 "사도 돼?" 같은 판단 요청입니다. 판단을 대신하지 않습니다.
- 판단에 필요한 사실(현재 값 · 최근 변화 · 배경 · 주의점)만 정리합니다. impact 는 "이 변화가 뜻하는 것" 까지만 씁니다.
- 사라 · 팔라 · 기다려라 · 지금이 기회다 같은 결론과 행동 지시를 쓰지 않습니다. summary 첫 문장에 판단은 사용자가 한다는 뜻을 담습니다.`,
  out_of_scope: "",
};

/** 작성 지시문에 들어가는 깊이 · 금융 · 모드 규칙. */
export function depthInstructions(depth: Depth, mode: ReportMode = "research"): string {
  return [byDepth[depth], financeRules, modeRules[mode]].filter(Boolean).join("\n\n");
}
