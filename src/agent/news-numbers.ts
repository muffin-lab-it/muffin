/**
 * 기사 숫자는 "오늘의 숫자" 카드로 올리지 않습니다 (리더, 11/21).
 *
 * 11/20 베타: "오늘 경제 뉴스 알려줘" 에 기사 제목 속 상품 가격이 "오늘의 숫자" 로 나와 "이상한 게 나옴 · 출처 신뢰도 하락" 이라는 말을 들었습니다.
 * 기사 제목의 숫자는 검증이 "기사 보도(reported)" 로 받아 주지만, 그 숫자가 맞는지 · 질문과 관련 있는지는 확인할 수 없습니다.
 * 카드는 "확인한 숫자" 로 읽히는 자리라, 기사 항목을 가리키는 카드는 코드가 뺍니다. 문장에서 "기사에 따르면" 으로 쓰는 것은 그대로 됩니다.
 * 공식 값으로 검산한 기사 숫자(당일 지수 종가, src/agent/index-quote.ts)는 계산 항목(C 번호)이라 여기에 걸리지 않습니다.
 */
import { areaTools } from "./plan";
import type { Evidence, WriterOutput } from "./schema";

const newsIds = (evidence: Evidence[]) => new Set(evidence.filter((e) => e.tool === areaTools.news).map((e) => e.id));

/** 기사 항목을 가리키는 카드를 뺀 출력. 뺄 것이 없으면 받은 그대로 돌려줍니다. 검증 전에 불러, 뺀 카드는 검증 · 다시 쓰기 대상이 아닙니다 */
export function dropNewsCards(output: WriterOutput, evidence: Evidence[]): WriterOutput {
  const ids = newsIds(evidence);
  if (ids.size === 0) return output;
  const numbers = output.numbers.filter((n) => !(n.ref && ids.has(n.ref)));
  return numbers.length === output.numbers.length ? output : { ...output, numbers };
}

/** 작성 입력에 붙이는 한 줄. 장부에 기사가 있을 때만 */
export function newsCardNote(evidence: Evidence[]): string {
  if (newsIds(evidence).size === 0) return "";
  return [
    `[기사 속 숫자] 기사 제목 · 본문의 숫자는 "오늘의 숫자"(numbers)에 넣지 않습니다. 숫자 카드는 데이터 tool 과 계산(C 번호)의 값만 씁니다.`,
    `기사의 숫자를 문장에 쓸 때는 제목에 있는 숫자만, "○○ 보도에 따르면" 처럼 기사 내용임을 밝혀 씁니다. 상품 가격 · 할인율처럼 질문과 관련 없는 숫자는 쓰지 않습니다.`,
  ].join("\n");
}
