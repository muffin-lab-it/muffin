import { describe, expect, it } from "vitest";
import { rescueScope, scopeGap, scopeNote } from "./scope-rescue";

describe("일부만 범위 밖인 질문의 구제 (11/21)", () => {
  it("다루는 대상이 있고 자료를 달라는 질문은 그 부분의 tool 로 조사한다", () => {
    expect(rescueScope("물가와 금리, cpi까지 폭넓게 조사하고 한국과 미국의 선물 시장 조사하기")).toEqual({ tools: ["get_rate_data", "get_macro_indicators"], areas: ["금리", "물가 · 고용 지표"] });
    expect(rescueScope("비트코인이랑 경제 뉴스 알려줘")).toEqual({ tools: ["get_korean_economic_news"], areas: ["경제 뉴스"] });
    expect(rescueScope("<img src=x onerror=alert(1)> 환율 알려줘")).toEqual({ tools: ["get_fx_krw_rate"], areas: ["환율"] });
  });

  it("뜻 · 계산법 · 가정을 묻는 질문과, 다루는 대상이 없는 질문은 그대로 범위 밖이다 (11/9~11/20 로그의 질문)", () => {
    for (const q of [
      "비트코인 지금 얼마야?",
      "etf가 뭐야?",
      "물가지수의 기준연도는 무슨 뜻인가요?",
      "환율 우대 90%는 달러 가격을 90% 깎아 준다는 뜻인가요?",
      "물가 상승률이 2%라면 작년에 만 원이던 점심은 얼마인가요?",
      "같은 가격에 과자 양만 줄면 소비자물가에는 어떻게 잡히나요?",
      "듀레이션이 5년인 채권 ETF의 금리 민감도 계산에서 볼록성은 왜 필요한가요?",
      "오늘 점심메뉴 추천해줘",
      "오늘 스포츠 뉴스 알려줘",
    ]) expect(rescueScope(q)).toBeNull();
  });

  it("작성과 리포트에 범위를 한 줄로 알린다", () => {
    const rescue = rescueScope("물가와 금리 조사하고 선물 시장 조사하기")!;
    expect(scopeNote(rescue)).toContain("[질문의 범위]");
    expect(scopeGap(rescue)).toBe("질문의 일부는 머핀이 다루는 범위 밖이라, 금리 · 물가 · 고용 지표 자료로 답할 수 있는 부분만 조사했어요.");
  });
});
