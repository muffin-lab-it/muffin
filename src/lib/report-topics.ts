import type { Area } from "../agent/schema";

/** 조회 도구가 지원하는 대상·지표·기간으로 한정한 후속 질문. 조회 성공 자체를 보장하지는 않는다. */
export const reportTopics = [
  { area: "fx", question: "최근 30일 달러 대비 원화 환율은 얼마나 변했나요?", reason: "달러를 사는 데 필요한 원화 비용의 변화를 확인해요.", match: /달러|USD|원화|환율/ },
  { area: "fx", question: "최근 30일 100엔당 원화 환율은 얼마나 변했나요?", reason: "같은 엔화를 살 때 드는 원화 비용을 비교해요.", match: /엔화|엔당|일본 여행|JPY/ },
  { area: "fx", question: "최근 30일 유로당 원화 환율은 얼마나 변했나요?", reason: "유로 환전 비용의 변화를 확인해요.", match: /유로|EUR/ },
  { area: "rate", question: "최근 30일 한국 기준금리와 미국 실효연방기금금리는 각각 얼마나 변했나요?", reason: "정책금리와 실제 거래금리의 성격을 구분해 비교해요.", match: /금리|연방기금/ },
  { area: "rate", question: "최근 30일 미국 국채 10년물 금리는 얼마나 변했나요?", reason: "장기 시장금리의 변화를 확인해요.", match: /국채|시장금리/ },
  { area: "macro", question: "한국 소비자물가는 전월과 전년 같은 달보다 얼마나 올랐나요?", reason: "물가 지수와 두 비교 기간의 상승률을 함께 살펴봐요.", match: /물가|CPI|인플레이션/ },
  { area: "macro", question: "한국 소비자물가 상승에 기여한 품목군은 무엇인가요?", reason: "품목군별 상승률과 총지수 기여도를 확인해요.", match: /품목|기여|교통|식료품/ },
  { area: "etf", question: "최근 30일 KODEX 200의 가격과 기초지수 수익률은 얼마나 차이 나나요?", reason: "가격과 기초지수의 움직임을 비교해요. 상품 선택을 권하는 내용은 아니에요.", match: /ETF|상장지수|괴리율|추적|KODEX/ },
  { area: "news", question: "최근 한국 기준금리 관련 경제뉴스는 무엇인가요?", reason: "금리 관련 보도와 자료의 기준일을 함께 확인해요.", match: /뉴스|보도|기사/ },
] satisfies { area: Area; question: string; reason: string; match: RegExp }[];

/** 추천이 비었을 때 영역에 맞는 기본 후속 질문 둘 (11/21 QA-06: 후속 탐색이 없는 리포트가 있었음). 영역이 없으면 환율 · 금리 */
export function fallbackReportTopics(area?: Area, currentQuestion?: string) {
  const byArea = area ? reportTopics.filter(item => item.area === area) : [];
  const pool = byArea.length > 0 ? byArea : reportTopics.filter(item => item.area === "fx" || item.area === "rate");
  return pool.filter(item => item.question !== currentQuestion).slice(0, 2);
}

export function supportedReportTopics(topics: string[], area?: Area, currentQuestion?: string) {
  const selected = topics.map(topic => reportTopics.find(item => item.question === topic) ?? [...reportTopics].reverse().find(item => item.match.test(topic))).filter(item => item !== undefined);
  const candidates = [...selected, ...reportTopics.filter(item => item.area === area)];
  return [...new Set(candidates)].filter(item => item.question !== currentQuestion).slice(0, Math.min(topics.length, 3));
}
