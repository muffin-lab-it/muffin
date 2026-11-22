import { describe, expect, it } from "vitest";
import { ResearchContext } from "./context";
import { addExampleCalc, exampleIn, exampleNote, withExampleNumbers } from "./example-calc";

describe("질문에 적힌 가상의 숫자 계산 (11/22)", () => {
  it("'A 에서 B 로' 꼴의 두 값을 읽는다. 날짜 · 단위가 다른 값 · 같은 값은 아니다", () => {
    expect(exampleIn("금리가 3%에서 4%로 오르면 얼마나 오른 거야?")).toEqual({ from: 3, to: 4, unit: "%" });
    expect(exampleIn("환율이 1,300원에서 1,400원이 되면?")).toEqual({ from: 1300, to: 1400, unit: "원" });
    expect(exampleIn("2.5퍼센트에서 3퍼센트로 오르면")).toEqual({ from: 2.5, to: 3, unit: "%" });
    expect(exampleIn("10월 21일에서 11월 20일로 환율이 얼마나 변했어?")).toBeNull();
    expect(exampleIn("3%에서 1,400원으로")).toBeNull();
    expect(exampleIn("3%에서 3%로")).toBeNull();
    expect(exampleIn("금리 내려가는 추세야?")).toBeNull();
  });

  it("차이와 비율 변화를 계산해 계산 항목(C 번호)으로 장부에 올린다", () => {
    const ctx = new ResearchContext();
    const e = addExampleCalc(ctx, "금리가 3%에서 4%로 오르면 얼마나 오른 거야?")!;
    expect(e).toMatchObject({ id: "C1", tool: "calc_example", values: { fromPct: 3, toPct: 4, diffPp: 1, relativePct: 33.33 } });
    expect(ctx.steps.at(-1)).toMatchObject({ tool: "calc_example", status: "ok" });
    const won = addExampleCalc(new ResearchContext(), "환율이 1,300원에서 1,400원이 되면?")!;
    expect(won.values).toMatchObject({ unit: "원", from: 1300, to: 1400, diff: 100, relativePct: 7.69 });
    expect(addExampleCalc(new ResearchContext(), "금리 내려가는 추세야?")).toBeUndefined();
  });

  it("작성에는 값과 가상 예시라는 점을 알리고, 숫자 카드를 넣는다", () => {
    const e = addExampleCalc(new ResearchContext(), "금리가 3%에서 4%로 오르면 얼마나 오른 거야?")!;
    const note = exampleNote(e);
    expect(note).toContain("[가상 예시 계산]");
    expect(note).toContain("- 차이: +1%p");
    expect(note).toContain("- 비율로 본 변화: +33.33%");
    expect(note).toContain("실제 금리 · 환율 · 가격을 조회한 값으로 바꿔 답하지 않습니다");
    const out = withExampleNumbers({ summary: "", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] }, e);
    expect(out.numbers.map((n) => [n.label, n.value, n.ref])).toEqual([["차이 (가상 예시)", "+1%p", "C1"], ["비율로 본 변화 (가상 예시)", "+33.33%", "C1"]]);
  });
});
