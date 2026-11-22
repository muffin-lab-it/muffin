import { describe, expect, it } from "vitest";
import { dropInternalPhrases, dropUnaskedCause, trimHeadline, trimNegatives } from "./negatives";
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
