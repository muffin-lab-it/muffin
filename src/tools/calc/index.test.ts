import { describe, expect, it } from "vitest";
import { RunContext } from "@openai/agents";
import { ResearchContext } from "../../agent/context";
import type { Evidence } from "../../agent/schema";
import { extractNumbers, matchValue, numericCandidates, verifyNumbers } from "../../agent/verify";
import { calcEvidence, calcTool, execute, perFromUnit } from "./index";
import { diff, movementZ, pctChange, ppDiff, round, scale, stdev } from "./metrics";

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
  it("변동률 · 차이 · %p 차이 · 표준편차", () => {
    expect(pctChange(1365.1, 1392.4)).toBeCloseTo(2.0, 1);
    expect(pctChange(100, 90)).toBe(-10);
    expect(diff(1365.1, 1392.4)).toBe(27.3);
    expect(ppDiff(3, 3.88)).toBe(0.88); // 0.8799999 가 아니라 0.88
    expect(round(1 / 3)).toBe(0.333333);
    expect(stdev([1, 2, 3, 4, 5])).toBeCloseTo(1.5811, 4);
  });

  it("움직임의 z-score 는 이번 변화 ÷ (하루 변화의 표준편차 × √관측 수) 이고 부호는 이번 변화를 따른다", () => {
    // 하루 변화 -1 · 0 · 1(%) 의 표본 표준편차는 1 → 4일이면 평소 폭 1 × √4 = 2(%)
    const daily = [-1, 0, 1];
    expect(movementZ(3, daily, 4)).toEqual({ z: 1.5, typical: 2 });
    expect(movementZ(-1, daily, 4)).toEqual({ z: -0.5, typical: 2 });
    // 같은 변화라도 기간이 길면(관측 수가 많으면) 평소 폭이 커져 배수가 작아진다
    expect(movementZ(3, daily, 9).z).toBe(1);
  });

  it("정의되지 않는 계산은 throw", () => {
    expect(() => pctChange(0, 5)).toThrow("0");
    expect(() => diff(Number.NaN, 1)).toThrow("숫자가 아닙니다");
    expect(() => stdev([1])).toThrow("2개 이상");
    expect(() => stdev([2, 2, 2])).toThrow("표준편차가 0");
    expect(() => movementZ(1, [0.5, -0.5], 0)).toThrow("1 이상의 정수");
    expect(() => movementZ(Number.NaN, [0.5, -0.5], 3)).toThrow("숫자가 아닙니다");
  });
});

describe("calc_metrics tool", () => {
  it("장부의 두 값으로 %p 차이를 내고 C1 · lineage · 계산 note 를 장부에 남긴다", async () => {
    const ctx = ledger();
    const out = (await invoke(ctx, { op: "pp_diff", amount: null, per: null, a: { ref: "E2", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "한미 기준금리 차이" })) as {
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
    await invoke(ctx, { op: "pct_change", amount: null, per: null, a: { ref: "E1", key: "comparison.rate" }, b: { ref: "E1", key: "rate" }, label: "USD/KRW 30일 변동률" });
    await invoke(ctx, { op: "diff", amount: null, per: null, a: { ref: "E1", key: "comparison.rate" }, b: { ref: "E1", key: "rate" }, label: "USD/KRW 30일 변동폭" });

    const [c1, c2] = [ctx.findEvidence("C1")!, ctx.findEvidence("C2")!];
    expect(c1.values).toEqual({ changePct: 1.999853, from: 1365.1, to: 1392.4 });
    expect(c1.lineage).toEqual({ op: "pct_change", inputs: ["E1"] });
    // 변동률 식은 과거 → 현재 순서. 거꾸로 적으면 오른 것을 내린 것처럼 읽힌다
    expect(c1.note).toContain("E1.comparison.rate 1365.1 → E1.rate 1392.4 = 1.999853%");
    expect(c2.values).toEqual({ change: 27.3, from: 1365.1, to: 1392.4, unit: "KRW per USD" });
    expect(c2.note).toContain("E1.rate 1392.4 − E1.comparison.rate 1365.1 = 27.3KRW per USD");
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

    expect(await fail({ op: "diff", amount: null, per: null, a: { ref: "E9", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "x" })).toContain("장부에 없는 id E9");
    expect(await fail({ op: "diff", amount: null, per: null, a: { ref: "E2", key: "nope" }, b: { ref: "E3", key: "rate" }, label: "x" })).toContain("nope 값이 없습니다");
    expect(await fail({ op: "diff", amount: null, per: null, a: { ref: "E1", key: "pair" }, b: { ref: "E1", key: "rate" }, label: "x" })).toContain("숫자가 아닙니다");
    expect(await fail({ op: "pp_diff", amount: null, per: null, a: { ref: "E1", key: "comparison.rate" }, b: { ref: "E1", key: "rate" }, label: "x" })).toContain("pp_diff 는 % 값");
    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1", "E2", "E3"]);
    expect(ctx.steps.every((s) => s.status === "error")).toBe(true);
    // 다음 성공은 C1 부터
    const ok = (await invoke(ctx, { op: "pp_diff", amount: null, per: null, a: { ref: "E2", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "차이" })) as { id: string };
    expect(ok.id).toBe("C1");
  });

  it("단위를 둘 다 아는데 다르면 어떤 op 도 실패하고, pp_diff 는 양쪽이 모두 % 여야 한다", async () => {
    const ctx = ledger();
    // 단위 메타가 없는 항목 (tool 이 unit 을 안 올린 경우)
    ctx.addEvidence([{ id: "E4", tool: "get_macro_indicators", label: "지표 · ECOS", values: { value: 2.1 }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-09-30" } }]);
    const fail = async (input: unknown) => JSON.stringify(await invoke(ctx, input));

    // 환율(KRW per USD) 과 금리(%) 는 어떤 계산도 안 된다. 예전엔 pp_diff 가 통과해 -1389.4%p 가 장부에 올라갔다
    expect(await fail({ op: "pp_diff", amount: null, per: null, a: { ref: "E1", key: "rate" }, b: { ref: "E2", key: "rate" }, label: "x" })).toContain("단위가 다른 값은 계산하지 않습니다: E1.rate(KRW per USD) · E2.rate(%)");
    expect(await fail({ op: "diff", amount: null, per: null, a: { ref: "E2", key: "rate" }, b: { ref: "E1", key: "rate" }, label: "x" })).toContain("단위가 다른 값");
    expect(await fail({ op: "pct_change", amount: null, per: null, a: { ref: "E2", key: "rate" }, b: { ref: "E1", key: "rate" }, label: "x" })).toContain("단위가 다른 값");
    // 한쪽 단위를 몰라도, 아는 쪽이 % 가 아니면 pp_diff 는 안 된다
    expect(await fail({ op: "pp_diff", amount: null, per: null, a: { ref: "E1", key: "rate" }, b: { ref: "E4", key: "value" }, label: "x" })).toContain("pp_diff 는 % 값 사이에서만 씁니다: E1.rate(KRW per USD) · E4.value(단위 없음)");
    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1", "E2", "E3", "E4"]);
    expect(ctx.steps.every((s) => s.status === "error")).toBe(true);

    // 단위를 모르는 쪽은 키 이름으로 본다. value 는 % 라는 표시가 없어 pp_diff 가 안 된다
    expect(await fail({ op: "pp_diff", amount: null, per: null, a: { ref: "E4", key: "value" }, b: { ref: "E2", key: "rate" }, label: "x" })).toContain("pp_diff 는 % 값 사이에서만 씁니다: E4.value(단위 없음) · E2.rate(%)");
    // diff 는 한쪽 단위를 모르면 막지 않고, 결과 단위는 비워 둔다
    const d = (await invoke(ctx, { op: "diff", amount: null, per: null, a: { ref: "E4", key: "value" }, b: { ref: "E2", key: "rate" }, label: "x" })) as { id: string; data: { unit: string } };
    expect(d).toMatchObject({ id: "C1", data: { unit: "" } });
  });

  it("unit 메타가 없는 ETF 값은 키 이름으로 % 를 가린다: 수익률끼리는 pp_diff 가 되고 종가 · NAV 는 안 된다", async () => {
    const ctx = ledger();
    const etf: Evidence = {
      id: "E4",
      tool: "get_etf_kr_price",
      label: "ETF 확인 · KRX",
      values: { "latest.close": 88905, "latest.nav": 89090.96, "period.returnPct": -3.61, "period.indexReturnPct": -4.37 },
      source: { name: "KRX", url: "https://data.krx.co.kr", asOf: "2026-10-28" },
    };
    ctx.addEvidence([etf]);
    // 예전엔 단위를 모르면 막지 않아 종가 − NAV 가 -185.96%p 로 장부에 올라갔다 (2026-10-28 정제 기준선 eval)
    expect(JSON.stringify(await invoke(ctx, { op: "pp_diff", amount: null, per: null, a: { ref: "E4", key: "latest.nav" }, b: { ref: "E4", key: "latest.close" }, label: "x" }))).toContain(
      "pp_diff 는 % 값 사이에서만 씁니다: E4.latest.nav(단위 없음) · E4.latest.close(단위 없음)",
    );
    const track = (await invoke(ctx, {
      op: "pp_diff", amount: null, per: null,
      a: { ref: "E4", key: "period.indexReturnPct" },
      b: { ref: "E4", key: "period.returnPct" },
      label: "추적 차이",
    })) as { id: string; data: { value: number; unit: string } };
    expect(track).toMatchObject({ id: "C1", data: { value: 0.76, unit: "%p" } });
  });

  it("값의 단위는 키 이름이 먼저다: 통화가 다른 환율도 changePct 끼리는 pp_diff 가 되고, 환율 값끼리 · bp 끼리는 막는다", async () => {
    const ctx = ledger();
    const fxRate = (id: string, pair: string, unit: string, rate: number, changePct: number): Evidence => ({
      id,
      tool: "get_fx_krw_rate",
      label: `환율 확인 · ${pair}`,
      values: { pair, unit, rate, "comparison.rate": rate / (1 + changePct / 100), changePct },
      source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-10-28" },
    });
    const bp = (id: string, changeBp: number): Evidence => ({
      id,
      tool: "get_rate_data",
      label: "금리 확인",
      values: { rate: 3, unit: "%", changePp: changeBp / 100, changeBp },
      source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-10-28" },
    });
    ctx.addEvidence([fxRate("E4", "USD/KRW", "KRW per 1 USD", 1392.4, 2), fxRate("E5", "JPY/KRW", "KRW per 100 JPY", 912.3, -1.5), bp("E6", 25), bp("E7", 50)]);
    const fail = async (input: unknown) => JSON.stringify(await invoke(ctx, input));

    // 예전엔 환율 항목의 unit("KRW per 1 USD" · "KRW per 100 JPY")만 봐서 "엔화가 달러보다 얼마나 더 떨어졌나" 를 계산하지 못했다
    const gap = (await invoke(ctx, { op: "pp_diff", amount: null, per: null, a: { ref: "E5", key: "changePct" }, b: { ref: "E4", key: "changePct" }, label: "달러 − 엔 변동률 차이" })) as {
      id: string;
      data: { value: number; unit: string };
    };
    expect(gap).toMatchObject({ id: "C1", data: { value: 3.5, unit: "%p" } });
    // 환율 값 자체는 통화마다 단위가 달라 어떤 계산도 안 된다
    expect(await fail({ op: "diff", amount: null, per: null, a: { ref: "E5", key: "rate" }, b: { ref: "E4", key: "rate" }, label: "x" })).toContain(
      "단위가 다른 값은 계산하지 않습니다: E5.rate(KRW per 100 JPY) · E4.rate(KRW per 1 USD)",
    );
    // bp 끼리의 차이는 %p 가 아니다 (예전엔 항목 unit "%" 만 봐서 25bp − 50bp 가 "25%p" 로 계산됐다)
    expect(await fail({ op: "pp_diff", amount: null, per: null, a: { ref: "E6", key: "changeBp" }, b: { ref: "E7", key: "changeBp" }, label: "x" })).toContain(
      "pp_diff 는 % 값 사이에서만 씁니다: E6.changeBp(bp) · E7.changeBp(bp)",
    );
    expect(await fail({ op: "diff", amount: null, per: null, a: { ref: "E6", key: "changeBp" }, b: { ref: "E7", key: "changePp" }, label: "x" })).toContain("단위가 다른 값");

    // bp 끼리 · %p 끼리의 diff 는 결과 단위를 키 이름으로, 계산에 쓴 값의 단위를 unit 으로 남겨 리포트가 "25bp" · "0.25%p" 로 인용할 수 있다
    await invoke(ctx, { op: "diff", amount: null, per: null, a: { ref: "E6", key: "changeBp" }, b: { ref: "E7", key: "changeBp" }, label: "변동폭 차이 (bp)" });
    await invoke(ctx, { op: "diff", amount: null, per: null, a: { ref: "E6", key: "changePp" }, b: { ref: "E7", key: "changePp" }, label: "변동폭 차이 (%p)" });
    const [bpGap, ppGap] = [ctx.findEvidence("C2")!, ctx.findEvidence("C3")!];
    expect(bpGap.values).toEqual({ changeBp: 25, from: 25, to: 50, unit: "bp" });
    expect(ppGap.values).toEqual({ changePp: 0.25, from: 0.25, to: 0.5, unit: "%p" });
    const keyOf = (text: string, e: Evidence) => matchValue(extractNumbers(text)[0], numericCandidates(e))?.key ?? null;
    expect(keyOf("25bp", bpGap)).toBe("changeBp");
    expect(keyOf("0.25%p", ppGap)).toBe("changePp");
    expect(keyOf("0.5%p", ppGap)).toBe("to"); // 계산에 쓴 값도 %p 로 맞춰 본다
    expect(keyOf("0.5%", ppGap)).toBeNull(); // %p 값을 % 로 적으면 걸린다
  });

  it("같은 항목에 크기가 같은 값이 이미 있으면 다시 계산하지 않는다 (앞뒤를 바꿔 부호만 반대인 C 번호가 생기던 것, 11/20 eval)", async () => {
    const ctx = ledger();
    const etf: Evidence = {
      id: "E4",
      tool: "get_etf_kr_price",
      label: "ETF 확인 · KRX",
      values: { "period.returnPct": -7.060111809117631, "period.indexReturnPct": -6.894664524092309, "period.trackingDiffPp": -0.1654472850253219, "latest.close": 80630, "period.closeFrom": 86755 },
      source: { name: "KRX", url: "https://data.krx.co.kr", asOf: "2026-11-19" },
    };
    const fxWithChange: Evidence = { ...fx, id: "E5", values: { ...fx.values, change: 27.3, changePct: 2 } };
    ctx.addEvidence([etf, fxWithChange]);
    const call = (op: string, ref: string, a: string, b: string) => invoke(ctx, { op, amount: null, per: null, a: { ref, key: a }, b: { ref, key: b }, label: "x" });

    // 실제 사례: a = ETF 수익률, b = 지수 수익률 → +0.165447%p (장부의 추적 차이는 −0.165…)
    expect(JSON.stringify(await call("pp_diff", "E4", "period.returnPct", "period.indexReturnPct"))).toContain("이미 장부에 있는 값입니다: E4.period.trackingDiffPp = -0.1654472850253219");
    // 방향이 맞아도 이미 있는 값은 그 E 번호를 쓰게 한다. tool 이 반올림해 준 값(2%)과 계산값(1.999853%)도 같은 값으로 본다
    expect(JSON.stringify(await call("pp_diff", "E4", "period.indexReturnPct", "period.returnPct"))).toContain("이미 장부에 있는 값입니다");
    expect(JSON.stringify(await call("pct_change", "E5", "comparison.rate", "rate"))).toContain("이미 장부에 있는 값입니다: E5.changePct = 2");
    expect(JSON.stringify(await call("diff", "E5", "comparison.rate", "rate"))).toContain("이미 장부에 있는 값입니다: E5.change = 27.3");
    expect(ctx.findEvidence("C1")).toBeUndefined();

    // 장부에 없는 계산은 그대로 된다 (30일 종가 변화), 다른 항목 사이의 계산은 보지 않는다
    expect(await call("diff", "E4", "period.closeFrom", "latest.close")).toMatchObject({ id: "C1", data: { value: -6125 } });
    expect(await invoke(ctx, { op: "pp_diff", amount: null, per: null, a: { ref: "E2", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "한미 금리차" })).toMatchObject({ id: "C2", data: { value: 0.88 } });
  });

  it("장부 없이 단독으로 부르면 throw (Agent 밖에서는 ResearchContext 를 만들어 넘긴다)", async () => {
    const input = { op: "diff" as const, amount: null, per: null, a: { ref: "E2", key: "rate" }, b: { ref: "E3", key: "rate" }, label: "x" };
    await expect(execute(input)).rejects.toThrow("장부(ResearchContext)");
    const result = await execute(input, ledger());
    expect(result.data.value).toBe(0.88);
    // diff 는 입력 단위를 따르되, 두 퍼센트 값의 차이는 %p 다 (3.88% − 3% = 0.88%p). pp_diff 와 같은 키로 올라간다
    expect(result.data.unit).toBe("%p");
    expect(result.data.formula).toBe("E3.rate 3.88 − E2.rate 3 = 0.88%p");
    const values = calcEvidence(result.data);
    expect(values).toEqual({ changePp: 0.88, from: 3, to: 3.88, unit: "%" });
    // 예전엔 { change, unit: "%" } 로 올라가 리포트가 "0.88%p" 로도 "0.88%" 로도 인용할 수 없었다 (2026-10-30 한미 물가 상승률 차이)
    const c: Evidence = { id: "C1", tool: "calc_metrics", label: "계산 · x", values, source: { name: "x", url: "", asOf: "2026-10-16" } };
    expect(matchValue(extractNumbers("0.88%p")[0], numericCandidates(c))?.key).toBe("changePp");
  });
});

describe("scale: 단위당 값을 사용자가 말한 금액으로 환산 (11/19)", () => {
  const jpy: Evidence = {
    id: "E4",
    tool: "get_fx_krw_rate",
    label: "환율 확인 · Frankfurter",
    values: { rate: 836.49, "comparison.rate": 839.69, change: -3.2, changePct: -0.38, unit: "KRW per 100 JPY", pair: "JPY(100)/KRW" },
    source: { name: "Frankfurter", url: "https://api.frankfurter.dev", asOf: "2026-11-19" },
  };
  it("100엔당 변화 −3.2원 × 10만 엔 ÷ 100 = −3,200원. 단위는 원, lineage 는 a 하나, 장부엔 scaled 로 올라 '3,200원 감소' 가 맞는다", async () => {
    expect(scale(-3.2, 100000, 100)).toBe(-3200);
    expect(scale(1333.26, 20000)).toBe(26665200);
    const ctx = ledger();
    ctx.addEvidence([jpy]);
    // per 는 장부 단위에서 읽는다 (null 로 넘겨도 100). 금액 · 기준은 장부에 올리지 않아 "100,000원" 이 C1 로 통과하지 않는다
    const input = { op: "scale", a: { ref: "E4", key: "change" }, b: null, amount: 100000, per: null, label: "10만 엔 환전 원화 차이" };
    const r = await execute(input as never, ctx);
    expect(r.data).toMatchObject({ op: "scale", value: -3200, unit: "원", amount: 100000, per: 100 });
    expect(r.data.formula).toBe("E4.change -3.2 × 100000 ÷ 100 = -3200원");
    expect(r.lineage).toEqual({ op: "scale", inputs: ["E4"] });
    expect(r.note).toContain("수수료");
    await invoke(ctx, input);
    const c1 = ctx.evidence.find((e) => e.id === "C1")!;
    expect(c1.values).toEqual({ scaled: -3200, from: -3.2, amount: 100000, unit: "원" });
    const [n] = extractNumbers("3,200원 감소");
    expect(matchValue(n!, numericCandidates(c1))).toMatchObject({ key: "scaled" });
    expect(matchValue(extractNumbers("-3,200원")[0]!, numericCandidates(c1))).toMatchObject({ key: "scaled" });
    // per(100) 는 장부에 없어 "100원" 이 계산값으로 통과하지 않는다
    expect(matchValue(extractNumbers("100원")[0]!, numericCandidates(c1))).toBeNull();
    // 작성이 라벨에 금액을 적어도(10만 엔) 카드 전체가 걸리지 않는다 — amount 가 장부에 있어서
    const [card] = verifyNumbers([{ label: "10만 엔 환전 원화 차이", value: "3,200원 감소", change: "", ref: "C1", asOf: "2026-11-19" }], ctx.evidence);
    expect(card!.status).toBe("derived");
    expect(card!.status === "derived" && card!.key).toBe("scaled");
  });
  it("per 는 단위에서 읽고, 단위와 다른 per 는 실패하며, 단위당 원화 값이 아닌 것(금리 %)은 환산하지 않는다", async () => {
    expect(perFromUnit("KRW per 100 JPY")).toBe(100);
    expect(perFromUnit("KRW per 1 USD")).toBe(1);
    expect(perFromUnit("%")).toBeNull();
    const ctx = ledger();
    ctx.addEvidence([jpy]);
    await expect(execute({ op: "scale", a: { ref: "E4", key: "change" }, b: null, amount: 100000, per: 1, label: "x" } as never, ctx)).rejects.toThrow("단위(KRW per 100 JPY, 100단위당)와 다릅니다");
    // 금리 3% × 100만 원 같은 이자 계산은 결과 단위가 %(30000%) 가 되므로 막는다 (Codex 리뷰)
    await expect(execute({ op: "scale", a: { ref: "E2", key: "rate" }, b: null, amount: 1000000, per: 100, label: "x" } as never, ctx)).rejects.toThrow("단위당 원화 값(KRW per …)에만");
    expect(ctx.evidence.some((e) => e.id.startsWith("C"))).toBe(false);
  });
  it("amount 가 없으면 실패하고, 다른 op 에 b 가 없어도 실패한다 (C 번호를 쓰지 않음)", async () => {
    const ctx = ledger();
    ctx.addEvidence([jpy]);
    await expect(execute({ op: "scale", a: { ref: "E4", key: "change" }, b: null, amount: null, per: 100, label: "x" } as never, ctx)).rejects.toThrow("amount");
    await expect(execute({ op: "diff", a: { ref: "E4", key: "change" }, b: null, amount: null, per: null, label: "x" } as never, ctx)).rejects.toThrow("b(비교 값)");
    expect(ctx.evidence.some((e) => e.id.startsWith("C"))).toBe(false);
  });
});
