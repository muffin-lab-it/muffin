import { describe, expect, it } from "vitest";
import { RunContext } from "@openai/agents";
import { ResearchContext } from "../../agent/context";
import type { Evidence } from "../../agent/schema";
import { extractNumbers, matchValue, numericCandidates } from "../../agent/verify";
import { calcEvidence, calcTool, execute } from "./index";
import { diff, pctChange, ppDiff, round, zScore } from "./metrics";

const kr: Evidence = {
  id: "E2",
  tool: "get_rate_data",
  label: "금리 확인 · 한국은행",
  values: { rate: 3, comparisonRate: 3, unit: "%", asOf: "2026-10-16" },
  source: { name: "한국은행", url: "https://ecos.bok.or.kr", asOf: "2026-10-16" },
};
const us: Evidence = {
  id: "E3",
  tool: "get_rate_data",
  label: "금리 확인 · FRED",
  values: { rate: 3.88, comparisonRate: 3.63, unit: "%", asOf: "2026-10-15" },
  source: { name: "FRED", url: "https://fred.stlouisfed.org", asOf: "2026-10-15" },
};
const fx: Evidence = {
  id: "E1",
  tool: "get_fx_krw_rate",
  label: "환율 확인 · Frankfurter",
  values: { rate: 1392.4, "comparison.rate": 1365.1, unit: "KRW per USD", pair: "USD/KRW" },
  source: { name: "Frankfurter", url: "https://api.frankfurter.dev", asOf: "2026-10-19" },
};

function ledger(): ResearchContext {
  const ctx = new ResearchContext();
  ctx.addEvidence([fx, kr, us]);
  return ctx;
}
async function invoke(ctx: ResearchContext, input: unknown) {
  return calcTool.invoke(new RunContext(ctx), JSON.stringify(input));
}

describe("metrics (순수 함수)", () => {
  it("변동률 · 차이 · %p 차이 · z-score", () => {
    expect(pctChange(1365.1, 1392.4)).toBeCloseTo(2.0, 1);
    expect(pctChange(100, 90)).toBe(-10);
    expect(diff(1365.1, 1392.4)).toBe(27.3);
    expect(ppDiff(3, 3.88)).toBe(0.88); // 0.8799999 가 아니라 0.88
    expect(round(1 / 3)).toBe(0.333333);
    expect(zScore([1, 2, 3, 4, 5], 5)).toBeCloseTo(1.2649, 3);
  });

  it("정의되지 않는 계산은 throw", () => {
    expect(() => pctChange(0, 5)).toThrow("0");
    expect(() => diff(Number.NaN, 1)).toThrow("숫자가 아닙니다");
    expect(() => zScore([1], 1)).toThrow("2개 이상");
    expect(() => zScore([2, 2, 2], 2)).toThrow("표준편차가 0");
  });
});

describe("calc_metrics tool", () => {
  it("장부의 두 값으로 %p 차이를 내고 C1 · lineage · 계산 note 를 장부에 남긴다", async () => {
    const ctx = ledger();
    const out = (await invoke(ctx, { op: "pp_diff", a: { ref: "E2", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "한미 기준금리 차이" })) as {
      id: string;
      data: { value: number; unit: string; formula: string };
      lineage: { op: string; inputs: string[] };
    };

    expect(out.id).toBe("C1");
    expect(out.data).toMatchObject({ value: 0.88, unit: "%p", formula: "E3.rate 3.88 − E2.rate 3 = 0.88%p" });
    expect(out.lineage).toEqual({ op: "pp_diff", inputs: ["E2", "E3"] });

    const c1 = ctx.findEvidence("C1")!;
    expect(c1).toMatchObject({
      tool: "calc_metrics",
      label: "계산 · 한미 기준금리 차이",
      values: { changePp: 0.88, from: 3, to: 3.88, unit: "%" },
      source: { name: "한미 기준금리 차이", url: "", asOf: "2026-10-16" },
      lineage: { op: "pp_diff", inputs: ["E2", "E3"] },
    });
    expect(c1.note).toContain("E3.rate 3.88 − E2.rate 3 = 0.88%p");
    // url 이 없으니 출처 목록에는 들어가지 않고, 실행 기록에는 남는다
    expect(ctx.sources.some((s) => s.url === "")).toBe(false);
    expect(ctx.steps).toMatchObject([{ tool: "calc_metrics", status: "ok" }]);
  });

  it("변동률은 changePct, 차이는 change 로 올라가 검증기가 단위를 맞춰 본다", async () => {
    const ctx = ledger();
    await invoke(ctx, { op: "pct_change", a: { ref: "E1", key: "comparison.rate" }, b: { ref: "E1", key: "rate" }, label: "USD/KRW 30일 변동률" });
    await invoke(ctx, { op: "diff", a: { ref: "E1", key: "comparison.rate" }, b: { ref: "E1", key: "rate" }, label: "USD/KRW 30일 변동폭" });

    const [c1, c2] = [ctx.findEvidence("C1")!, ctx.findEvidence("C2")!];
    expect(c1.values).toEqual({ changePct: 1.999853, from: 1365.1, to: 1392.4 });
    expect(c1.lineage).toEqual({ op: "pct_change", inputs: ["E1"] });
    expect(c2.values).toEqual({ change: 27.3, from: 1365.1, to: 1392.4, unit: "KRW per USD" });
    // 검증기 단위 추정: 변동률은 pct, 차이는 delta(통화 표기와 맞춤), 입력값은 plain
    expect(numericCandidates(c1).find((c) => c.key === "changePct")?.unit).toBe("pct");
    expect(numericCandidates(c2).find((c) => c.key === "change")?.unit).toBe("delta");
    expect(numericCandidates(c2).find((c) => c.key === "to")?.unit).toBe("plain");
    // 리포트가 "2.00%" · "27.30원" 으로 적으면 반올림 정책으로 통과하고, "27.3%" 는 단위가 달라 걸린다
    expect(matchValue(extractNumbers("2.00%")[0], numericCandidates(c1))).toMatchObject({ key: "changePct", policy: "rounded" });
    expect(matchValue(extractNumbers("27.30원")[0], numericCandidates(c2))).toMatchObject({ key: "change" });
    expect(matchValue(extractNumbers("27.3%")[0], numericCandidates(c2))).toBeNull();
  });

  it("없는 id · 없는 키 · 숫자가 아닌 값 · % 아닌 값의 pp_diff 는 실패하고 C 번호를 쓰지 않는다", async () => {
    const ctx = ledger();
    const fail = async (input: unknown) => JSON.stringify(await invoke(ctx, input));

    expect(await fail({ op: "diff", a: { ref: "E9", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "x" })).toContain("장부에 없는 id E9");
    expect(await fail({ op: "diff", a: { ref: "E2", key: "nope" }, b: { ref: "E3", key: "rate" }, label: "x" })).toContain("nope 값이 없습니다");
    expect(await fail({ op: "diff", a: { ref: "E1", key: "pair" }, b: { ref: "E1", key: "rate" }, label: "x" })).toContain("숫자가 아닙니다");
    expect(await fail({ op: "pp_diff", a: { ref: "E1", key: "comparison.rate" }, b: { ref: "E1", key: "rate" }, label: "x" })).toContain("pp_diff 는 % 값");
    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1", "E2", "E3"]);
    expect(ctx.steps.every((s) => s.status === "error")).toBe(true);
    // 다음 성공은 C1 부터
    const ok = (await invoke(ctx, { op: "pp_diff", a: { ref: "E2", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "차이" })) as { id: string };
    expect(ok.id).toBe("C1");
  });

  it("장부 없이 단독으로 부르면 throw (Agent 밖에서는 ResearchContext 를 만들어 넘긴다)", async () => {
    const input = { op: "diff" as const, a: { ref: "E2", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "x" };
    await expect(execute(input)).rejects.toThrow("장부(ResearchContext)");
    const result = await execute(input, ledger());
    expect(result.data.value).toBe(0.88);
    expect(result.data.unit).toBe("%"); // diff 는 입력 단위를 따른다
    expect(calcEvidence(result.data)).toEqual({ change: 0.88, from: 3, to: 3.88, unit: "%" });
  });
});
