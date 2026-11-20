import { describe, expect, it } from "vitest";
import type { WriterOutput } from "./schema";
import { overlap, trimRepeats } from "./trim";

const output = (caveats: string[], dataGaps: string[]): WriterOutput => ({ summary: "", numbers: [], why: [], impact: [], caveats, dataGaps, nextTopics: [] });

describe("주의점 · 확인하지 못한 것의 되풀이 줄이기 (11/21)", () => {
  it("주의점에 나온 한계는 확인하지 못한 것에서 다시 쓰지 않는다 (11/21 실측)", () => {
    const out = trimRepeats(output(
      ["두 시점의 비교만으로 통계적 상관관계나 인과관계를 확정할 수 없습니다.", "CPI는 한국 원계열이며, 전월 변화에는 계절성이 포함됩니다."],
      ["통계적 상관관계를 판단할 장기간의 CPI·금리 시계열 분석은 제공되지 않았습니다.", "이번 금리 변동이 CPI 변화에 대응한 것인지 등 구체적인 인과관계는 확인되지 않았습니다.", "품목군 가격이 오른 구체적 배경은 제공된 자료로 확인할 수 없습니다."],
    ));
    expect(out.caveats).toHaveLength(2);
    expect(out.dataGaps).toEqual(["품목군 가격이 오른 구체적 배경은 제공된 자료로 확인할 수 없습니다."]);
  });

  it("글자가 많이 겹치는 줄은 하나만 남기고, 많으면 주의점 3줄 · 확인하지 못한 것 2줄까지만 둔다", () => {
    expect(overlap("기사 제목만 확인했고 본문은 받지 않았습니다.", "기사 제목만 확인했으며 본문은 받지 않았습니다.")).toBeGreaterThan(0.6);
    const out = trimRepeats(output(
      ["환율은 일별 기준환율입니다.", "환율은 일별 기준환율이며 고시 기관마다 다릅니다.", "가", "나", "다"],
      ["첫째 자료가 없습니다.", "둘째 지표를 받지 못했습니다.", "셋째 기간은 지원하지 않습니다."],
    ));
    expect(out.caveats).toEqual(["환율은 일별 기준환율입니다.", "가", "나"]);
    expect(out.dataGaps).toEqual(["첫째 자료가 없습니다.", "둘째 지표를 받지 못했습니다."]);
  });

  it("검증이 넣은 줄은 개수 제한과 상관없이 남긴다", () => {
    const out = trimRepeats(output([], ["첫째 자료가 없습니다.", "둘째 지표를 받지 못했습니다.", "셋째 기간은 지원하지 않습니다.", "검증을 통과하지 못해 뺀 숫자 2개 (출처 값과 맞지 않았습니다)"]));
    expect(out.dataGaps).toEqual(["첫째 자료가 없습니다.", "둘째 지표를 받지 못했습니다.", "검증을 통과하지 못해 뺀 숫자 2개 (출처 값과 맞지 않았습니다)"]);
  });

  it("서로 다른 한계는 그대로 두고, 바뀐 것이 없으면 받은 그대로 돌려준다", () => {
    const kept = output(["환율은 일별 기준환율이며 실시간 호가가 아닙니다.", "뉴스 본문은 확보되지 않았습니다."], ["일중 변동 폭은 확인하지 않았습니다."]);
    expect(trimRepeats(kept)).toBe(kept);
  });
});
