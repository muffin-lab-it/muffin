import { describe, expect, it } from "vitest";
import { dropDecisionDisclaimer, dropFetchTalk, dropPickTalk, dropInternalPhrases, dropLeadingLimit, dropUnaskedCause, plainWords, splitEmyeo, trimHeadline, trimNegatives } from "./negatives";
import type { WriterOutput } from "./schema";

describe("묻지 않은 부정 문장 정리 (11/22)", () => {
  it("한 줄 요약의 '…했지만, …확인되지 않아요' 는 앞 구절만 남긴다 (11/21 실측)", () => {
    expect(trimHeadline("코스닥은 급락했지만, 확인된 자료만으로는 근본 원인이나 촉발 요인을 알기 어려워요.")).toBe("코스닥은 급락했어요.");
    expect(trimHeadline("지난 1년 원/달러 환율은 하락하고 한국 기준금리는 올랐지만, 인과관계는 확인되지 않아요.")).toBe("지난 1년 원/달러 환율은 하락하고 한국 기준금리는 올랐어요.");
    expect(trimHeadline("미국 물가는 2026-10에 전월보다 0.35% 올랐지만 연간 상승률은 확인되지 않아요")).toBe("미국 물가는 2026-10에 전월보다 0.35% 올랐어요.");
  });

  it("부정 구절이 없거나, 앞 구절이 과거형이 아니거나, 앞 구절도 부정이면 그대로 둔다", () => {
    for (const h of [
      "유로당 원화 환율은 한 달 동안 21.97원(1.48%) 내렸어요",
      "최근 환율은 비교 기준일보다 높지만, 환율만으로 투자 판단을 내릴 수는 없어요.",
      "코스피는 내렸지만 코스닥은 올랐어요.",
      "원인은 확인되지 않았지만, 자세한 내용은 알 수 없어요.",
    ]) expect(trimHeadline(h)).toBe(h);
  });

  it("원인을 묻지 않은 질문의 요약에서 '원인은 확인할 수 없어요' 뿐인 문장을 뺀다", () => {
    expect(dropUnaskedCause("한국 계절조정 실업률은 2026-10에 2.50%예요. 자료만으로 낮아진 원인은 확인할 수 없어요.", "status")).toBe("한국 계절조정 실업률은 2026-10에 2.50%예요.");
    // 원인 질문이면 그대로, 숫자가 든 문장이면 그대로, 문장이 그것뿐이면 그대로
    const s = "환율은 0.59% 올랐어요. 구체적인 원인은 확인되지 않았어요.";
    expect(dropUnaskedCause(s, "cause")).toBe(s);
    expect(dropUnaskedCause("환율은 0.59% 올랐지만 원인은 확인되지 않았어요.", "status")).toBe("환율은 0.59% 올랐지만 원인은 확인되지 않았어요.");
    expect(dropUnaskedCause("하락 원인은 확인할 수 없어요.", "status")).toBe("하락 원인은 확인할 수 없어요.");
    // "수는 없어요" 꼴도 잡는다 (11/22 실업률)
    expect(dropUnaskedCause("실업률은 2.5%예요. 실업률 수치만으로 변화의 원인을 단정할 수는 없어요.", "status")).toBe("실업률은 2.5%예요.");
    // 확인된 배경과 한계가 한 문장에 같이 있으면 지우지 않는다
    const mixed = "소비자물가는 올랐어요. 유가 상승이 물가 상승의 배경으로 보도됐지만, 금리와의 인과관계는 확인되지 않았어요.";
    expect(dropUnaskedCause(mixed, "cause", true)).toBe(mixed);
    // 원인 질문이라도 원인 칸에 근거를 적었으면 요약의 "단정하기 어려워요" 문장은 뺀다
    expect(dropUnaskedCause("코스닥 하락 원인은 단정하기 어려워요. 코스닥은 5.71% 내렸어요.", "cause", true)).toBe("코스닥은 5.71% 내렸어요.");
    expect(trimHeadline("코스닥은 2026-11-20에 5.71% 하락했지만, 원인은 제목 수준의 보도만으로 단정하기 어려워요.")).toBe("코스닥은 2026-11-20에 5.71% 하락했어요.");
  });

  it("바뀐 것이 없으면 받은 그대로 돌려준다", () => {
    const output: WriterOutput = { summary: "환율은 올랐어요.", headline: "환율은 올랐어요.", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] };
    expect(trimNegatives(output, "status")).toBe(output);
    expect(trimNegatives({ ...output, headline: "환율은 올랐지만, 원인은 알 수 없어요." }, "status").headline).toBe("환율은 올랐어요.");
  });
});

describe("내부 용어 머리 구절 떼기 (11/22)", () => {
  it("'장부의 계산 결과 기준' 같은 머리 구절만 떼고 뜻은 남긴다", () => {
    expect(dropInternalPhrases("장부의 계산 결과 기준 미국−한국 금리 차이는 0.88%p예요.")).toBe("미국−한국 금리 차이는 0.88%p예요.");
    expect(dropInternalPhrases("증거 장부에 따르면 환율은 0.87% 올랐어요.")).toBe("환율은 0.87% 올랐어요.");
    expect(dropInternalPhrases("환율은 0.87% 올랐어요.")).toBe("환율은 0.87% 올랐어요.");
  });
});

describe("판단 요청의 고지 반복 떼기 (11/22 QA)", () => {
  it("요약 첫머리의 '대신 결정할 수 없지만' 구절이나 그 말뿐인 첫 문장을 뗀다", () => {
    expect(dropDecisionDisclaimer("매수 여부는 대신 결정할 수 없지만, 확인 가능한 최신 종가 기준 KODEX 200은 80,630원이에요.")).toBe("확인 가능한 최신 종가 기준 KODEX 200은 80,630원이에요.");
    expect(dropDecisionDisclaimer("투자 판단은 대신할 수 없어요. 환율은 1,335.94원이에요.")).toBe("환율은 1,335.94원이에요.");
    const plain = "환율은 1,335.94원이에요. 같은 달러를 사는 데 원화가 더 들어요.";
    expect(dropDecisionDisclaimer(plain)).toBe(plain);
  });

  it("판단 요청이 아니면 건드리지 않는다", () => {
    const output = { summary: "매수 여부는 대신 결정할 수 없지만, 환율은 올랐어요.", headline: null, numbers: [], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] };
    expect(trimNegatives(output, "status")).toBe(output);
    expect(trimNegatives(output, "decision").summary).toBe("환율은 올랐어요.");
  });
});

describe("베타 남은 항목 정리 (11/23 운영 실제 문장)", () => {
  it("A2: 한 줄 요약의 부정 꼬리는 과거형이 아닌 흔한 끝(전하지만 → 전해요)도 뗀다", () => {
    expect(trimHeadline("뉴스 제목은 연준의 금리 동결을 전하지만, 기사 본문은 확인되지 않았어요.")).toBe("뉴스 제목은 연준의 금리 동결을 전해요.");
  });

  it("A2: 요약 첫 문장이 한계뿐이면 확인하지 못한 것으로 내린다. 값이 든 문장 · 한 문장뿐인 요약은 그대로", () => {
    const out = dropLeadingLimit({
      summary: "기사 본문을 확보하지 못해 오늘 환율 관련 뉴스의 내용과 맥락은 정리할 수 없어요. 확인 가능한 환율 자료에서는 달러당 원화 환율이 2026-10-24보다 2026-11-23에 높았어요.",
      dataGaps: [],
    });
    expect(out.summary).toBe("확인 가능한 환율 자료에서는 달러당 원화 환율이 2026-10-24보다 2026-11-23에 높았어요.");
    expect(out.dataGaps).toEqual(["기사 본문을 확보하지 못해 오늘 환율 관련 뉴스의 내용과 맥락은 정리할 수 없어요."]);
    const kept = { summary: "환율은 0.87% 올랐지만 원인은 확인되지 않았어요. 금리는 그대로예요.", dataGaps: [] };
    expect(dropLeadingLimit(kept)).toBe(kept);
    const one = { summary: "자료가 없어 확인할 수 없어요.", dataGaps: [] };
    expect(dropLeadingLimit(one)).toBe(one);
    // 확인된 내용과 한계가 한 문장에 같이 들었으면 앞 구절은 첫 문장으로 남기고 한계 구절만 내린다 (#147 Codex 리뷰)
    const mixed = dropLeadingLimit({ summary: "뉴스 제목은 연준의 금리 동결을 전하지만 기사 본문은 확인하지 못했어요. 시장 반응은 더 지켜봐야 해요.", dataGaps: [] });
    expect(mixed.summary).toBe("뉴스 제목은 연준의 금리 동결을 전해요. 시장 반응은 더 지켜봐야 해요.");
    expect(mixed.dataGaps).toEqual(["기사 본문은 확인하지 못했어요."]);
    // 어미를 바꿀 수 없거나 다른 이음으로 섞인 문장은 그대로 둔다
    for (const summary of ["제목은 동결을 전하는 기사가 많은데 본문은 확인하지 못했어요. 시장 반응은 더 지켜봐야 해요.", "연준은 동결을 발표했고 그 이유는 확인되지 않았어요. 시장 반응은 더 지켜봐야 해요."]) {
      const same = { summary, dataGaps: [] };
      expect(dropLeadingLimit(same)).toBe(same);
    }
  });

  it("C3: 수집 과정 · 영어 용어를 풀어 쓴다", () => {
    expect(plainWords("뉴스는 제목만 확인했고 본문은 요청하지 않았어요.")).toBe("뉴스는 제목만 확인했고 본문은 보지 않았어요.");
    expect(plainWords("환율은 일별 mid-market 환율이며 실시간 매수·매도 호가와는 달라요.")).toBe("환율은 일별 매수·매도 중간값 환율이며 실시간 매수·매도 호가와는 달라요.");
    expect(plainWords("기사 본문은 요청하지 않았습니다. RSS 제목·발행 시각·링크만 확인했으며 Google News 링크는 중계 링크일 수 있습니다.")).toBe("기사 본문은 보지 않았습니다. 제목·발행 시각·링크만 확인했으며 링크는 중계 링크일 수 있습니다.");
  });

  it("D2: '명사이며 · 했으며' 는 두 문장으로 나누고, 동사 줄기(보이며 · 움직이며)는 그대로 둔다", () => {
    expect(splitEmyeo("환율은 일별 중간환율이며 실시간 매수·매도 호가가 아니에요.")).toBe("환율은 일별 중간환율이에요. 실시간 매수·매도 호가가 아니에요.");
    expect(splitEmyeo("CPI 기준일은 관측 월의 첫날 표기이며 발표일이나 조회일이 아니에요.")).toBe("CPI 기준일은 관측 월의 첫날 표기예요. 발표일이나 조회일이 아니에요.");
    expect(splitEmyeo("뉴스 기사는 제목만 확인했으며 본문은 확보하지 못했어요.")).toBe("뉴스 기사는 제목만 확인했어요. 본문은 확보하지 못했어요.");
    expect(splitEmyeo("비교 대상은 자산군별로 미리 정한 대표 ETF 목록이며, 과거 수익률이 앞으로의 수익률을 뜻하지는 않아요.")).toBe("비교 대상은 자산군별로 미리 정한 대표 ETF 목록이에요. 과거 수익률이 앞으로의 수익률을 뜻하지는 않아요.");
    for (const t of ["환율이 크게 움직이며 불안이 커졌어요.", "물가가 높게 보이며 부담이 커요.", "금리가 오르며 대출 이자가 늘어요."]) expect(splitEmyeo(t)).toBe(t);
    // 동사 목록 밖의 동사도 그대로 둔다: 명사로 확실한 끝 글자만 나눈다 (#147 Codex 리뷰)
    for (const t of ["물가 오름세가 꺾이며 부담이 줄어요.", "환율이 출렁이며 불안이 커졌어요.", "자금이 모이며 거래가 늘었어요.", "투자자가 몰리며 거래가 늘었어요."]) expect(splitEmyeo(t)).toBe(t);
    expect(splitEmyeo("기준은 2026-11-20이며 발표일이 아니에요.")).toBe("기준은 2026-11-20이에요. 발표일이 아니에요.");
    expect(splitEmyeo("이 값은 전년 같은 달 대비 상승률이며 전월 대비가 아니에요.")).toBe("이 값은 전년 같은 달 대비 상승률이에요. 전월 대비가 아니에요.");
    expect(splitEmyeo("리서치센터장들이 꼽은 배경은 견해이며, 인과관계까지 확인된 것은 아니에요.")).toBe("리서치센터장들이 꼽은 배경은 견해예요. 인과관계까지 확인된 것은 아니에요.");
  });

  it("trimNegatives 는 주의점 · 확인하지 못한 것에도 내부 용어 풀기와 문장 나누기를 적용한다", () => {
    const output: WriterOutput = {
      summary: "기사 본문을 확보하지 못해 내용은 정리할 수 없어요. 연준은 금리를 동결했어요.",
      headline: "뉴스 제목은 연준의 금리 동결을 전하지만, 기사 본문은 확인되지 않았어요.",
      numbers: [], why: [], impact: [],
      caveats: ["뉴스 기사는 제목만 확인했으며 본문은 요청하지 않았어요."],
      dataGaps: [], nextTopics: [],
    };
    const out = trimNegatives(output, "status");
    expect(out.headline).toBe("뉴스 제목은 연준의 금리 동결을 전해요.");
    expect(out.summary).toBe("연준은 금리를 동결했어요.");
    expect(out.caveats).toEqual(["뉴스 기사는 제목만 확인했어요. 본문은 보지 않았어요."]);
    expect(out.dataGaps).toEqual(["기사 본문을 확보하지 못해 내용은 정리할 수 없어요."]);
  });
});

describe("조회 과정 문장 빼기 (11/23 운영 뉴스 질문)", () => {
  const base = (summary: string, caveats: string[] = [], dataGaps: string[] = []): WriterOutput => ({ summary, numbers: [], why: [], impact: [], caveats, dataGaps, nextTopics: [] });
  const NEWS = "get_korean_economic_news";

  it("저장된 응답을 쓴 조회는 요약 · 주의점 · 확인하지 못한 것에서 그 말을 뺀다 (코드가 확인하지 못한 것에 한 줄 넣음)", () => {
    const out = dropFetchTalk(
      base(
        "확인된 환율 관련 기사는 연합뉴스의 2026-11-20 보도예요. 기사에 따르면 원/달러 환율은 달러 강세와 위험회피 심리를 배경으로 올랐어요. 다만 조회가 실패해 이전 응답을 재사용했으므로 오늘의 최신 뉴스로 볼 수는 없고, 확인된 기사는 1건이에요.",
        ["환율 값은 일별 매수·매도 중간값으로, 실시간 매수·매도 호가가 아니에요.", "조회 실패로 13시간 전 뉴스 응답을 재사용했어요. 오늘의 최신 환율 뉴스 여부는 확인되지 않았어요."],
        ["최신 환율 뉴스를 확인하려면 최신 뉴스 조회 결과가 필요해요.", "뉴스는 이전에 받은 응답을 다시 썼어요."],
      ),
      [NEWS],
    );
    expect(out.summary).toBe("확인된 환율 관련 기사는 연합뉴스의 2026-11-20 보도예요. 기사에 따르면 원/달러 환율은 달러 강세와 위험회피 심리를 배경으로 올랐어요.");
    expect(out.caveats).toEqual(["환율 값은 일별 매수·매도 중간값으로, 실시간 매수·매도 호가가 아니에요."]);
    expect(out.dataGaps).toEqual(["최신 환율 뉴스를 확인하려면 최신 뉴스 조회 결과가 필요해요."]);
  });

  it("저장된 응답이 덮지 않는 다른 조회의 실패는 확인하지 못한 것으로 옮기고 남긴다 (#151 Codex 리뷰)", () => {
    // 환율만 저장된 응답을 썼고, 뉴스는 저장된 응답도 없이 실패
    const out = dropFetchTalk(base("기준금리는 3%예요. 뉴스는 조회가 실패해 확인하지 못했어요.", ["환율은 조회가 실패해 이전 응답을 썼어요."], ["뉴스 조회가 실패했어요."]), ["get_fx_krw_rate"]);
    expect(out.summary).toBe("기준금리는 3%예요.");
    expect(out.caveats).toEqual([]);
    expect(out.dataGaps).toEqual(["뉴스 조회가 실패했어요.", "뉴스는 조회가 실패해 확인하지 못했어요."]);
    // 저장된 응답을 쓴 조회가 없으면 실패 문장은 모두 확인하지 못한 것으로
    const none = dropFetchTalk(base("기준금리는 3%예요. 환율은 조회가 실패해 확인하지 못했어요.", ["뉴스 조회가 실패했어요."]), []);
    expect(none.summary).toBe("기준금리는 3%예요.");
    expect(none.dataGaps).toEqual(["환율은 조회가 실패해 확인하지 못했어요.", "뉴스 조회가 실패했어요."]);
  });

  it("요약이 그 문장뿐이거나 조회 과정 말이 없으면 그대로 둔다", () => {
    const one = base("조회가 실패해 이전 응답을 썼어요.");
    expect(dropFetchTalk(one, [NEWS])).toBe(one);
    const clean = base("기준금리는 3%예요. 1년 전보다 0.50%p 올랐어요.", ["정책금리라 시장금리와 달라요."]);
    expect(dropFetchTalk(clean, [NEWS])).toBe(clean);
  });
});

describe("기사 고르기 작업 설명 빼기 (11/23 화면 QA, C3 남은 것)", () => {
  it("주의점 · 확인하지 못한 것에서 기사를 고르거나 뺐다는 문장만 뺀다", () => {
    expect(dropPickTalk(["경제와 관련 없는 기사도 있어 추렸어요.", "기사 속 수치는 별도 검증되지 않았어요.", "기사 본문은 보지 않고 제목만 확인했어요. 상품 할인 기사는 제외했어요."])).toEqual([
      "기사 속 수치는 별도 검증되지 않았어요.",
      "기사 본문은 보지 않고 제목만 확인했어요.",
    ]);
    expect(dropPickTalk(["질문과 관련 없는 뉴스는 근거로 쓰지 않았어요."])).toEqual([]);
    const plain = ["환율은 일별 매수·매도 중간값이에요."];
    expect(dropPickTalk(plain)).toEqual(plain);
  });
});

