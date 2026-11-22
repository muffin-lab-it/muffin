import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { dropOffTopic, ensureMentioned, mentionedTools, offTopicGap, offTopicParts, rescueScope, scopeGap, scopeNote } from "./scope-rescue";

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

describe("금융 질문에 섞인 범위 밖 부탁 (11/22 QA)", () => {
  const q = "한국 금리랑 물가도 알려주고 미국 여행 갈 때 환율이 무슨 의미인지도 알려줘. 그리고 오늘 저녁 메뉴도 추천해줘.";

  it("금융 낱말 없이 무언가를 해 달라는 조각만 범위 밖으로 본다", () => {
    expect(offTopicParts(q)).toEqual({ parts: ["오늘 저녁 메뉴도 추천해줘"], keys: ["저녁", "메뉴"] });
    expect(offTopicGap(offTopicParts(q)!)).toBe('질문의 "오늘 저녁 메뉴도 추천해줘" 부분은 머핀이 다루는 금융 정보가 아니라 답하지 않았어요.');
    expect(offTopicParts("환율이 이제 내려갔잖아 그럼 앞으로 etf는 뭘 사면 좋을까??? 난 2030 직장인이야")).toBeNull();
    expect(offTopicParts("오늘 저녁 메뉴 추천해줘")).toBeNull();
    expect(offTopicParts("환율 알려줘. 그리고 금리도 알려줘.")).toBeNull();
  });

  it("작성이 답한 범위 밖 문장 · 항목은 뺀다 (11/22 실측: 김치찌개)", () => {
    const off = offTopicParts(q)!;
    const out = dropOffTopic({
      summary: "한국은행 기준금리는 3%예요. 미국 여행에서는 환율이 달러를 살 때 필요한 원화 금액을 뜻해요. 저녁 메뉴로는 김치찌개를 골라볼 수 있어요.",
      headline: "한국 기준금리는 3%로 유지됐어요",
      why: [],
      impact: ["변동금리 대출이 있으면 이자가 늘 수 있어요.", "저녁으로 김치찌개를 고르면 따뜻한 한 끼가 될 수 있어요."],
      impactTitles: ["대출 이자", "오늘 저녁"],
      caveats: [],
      dataGaps: ["오늘 저녁 메뉴는 금융 정보 범위 밖이라 답하지 않아요.", "최신 환율은 확인하지 않았어요."],
      nextTopics: ["오늘 달러 환율 얼마야?"],
      topicReasons: ["환율을 확인해요"],
    }, off);
    expect(out.summary).toBe("한국은행 기준금리는 3%예요. 미국 여행에서는 환율이 달러를 살 때 필요한 원화 금액을 뜻해요.");
    expect(out.impact).toEqual(["변동금리 대출이 있으면 이자가 늘 수 있어요."]);
    expect(out.impactTitles).toEqual(["대출 이자"]);
    expect(out.headline).toBe("한국 기준금리는 3%로 유지됐어요");
    // 작성이 직접 쓴 범위 밖 줄은 코드가 넣는 한 줄과 겹쳐 뺀다
    expect(out.dataGaps).toEqual(["최신 환율은 확인하지 않았어요."]);
  });

  it("질문에 이름이 나온 영역의 tool 을 찾는다", () => {
    expect(mentionedTools(q)).toEqual(["get_fx_krw_rate", "get_rate_data", "get_macro_indicators"]);
    expect(mentionedTools("요즘 코스피 어때?")).toEqual([]);
    // 분류가 통째로 범위 밖이라 해도 영역을 둘 이상 묻는 복합 질문은 구제한다
    expect(rescueScope(q)).toEqual({ tools: ["get_fx_krw_rate", "get_rate_data", "get_macro_indicators"], areas: ["환율", "금리", "물가 · 고용 지표"] });
  });
});

describe("질문이 이름을 댄 영역을 조사가 건너뛰면 채운다 (11/22 QA)", () => {
  it("장부에 없는 영역만 기본 입력으로 부르고, 나라 · 통화를 따른다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([{ id: "E1", tool: "get_rate_data", label: "금리", values: { indicator: "한국은행 기준금리", rate: 3 }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-11-20" } }]);
    const calls: [string, string][] = [];
    const tool = (name: string) => ({ name, invoke: vi.fn(async (...args: [unknown, string]) => { calls.push([name, args[1]]); return "ok"; }) });
    await ensureMentioned(ctx, "한국 금리랑 물가도 알려주고 미국 여행 갈 때 환율이 무슨 의미인지도 알려줘", [tool("get_fx_krw_rate"), tool("get_rate_data"), tool("get_macro_indicators")]);
    expect(calls).toEqual([
      ["get_fx_krw_rate", '{"currency":"USD","days":30}'],
      ["get_macro_indicators", '{"country":"KR","indicator":"cpi","endMonth":null,"months":1}'],
    ]);
  });
});
