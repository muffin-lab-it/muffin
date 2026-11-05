/**
 * 근거 판정 테스트 (리더). 모델을 부르지 않습니다. run 을 모킹해 "무엇을 판정에 보내나" · "출력을 why 에 어떻게 맞추나" ·
 * "실패 시 행동" 을 확인합니다. 실제 정확도는 `pnpm judge` (보정 세트) 로 봅니다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  return { ...actual, run: vi.fn() };
});

import { run } from "@openai/agents";
import { alignVerdicts, comparisonHints, createJudgeAgent, directionHint, judgeable, judgeInput, judgeInstructions, judgeSchema, judgeWhy, summarizeJudge, valueHints, verdictMark } from "./judge";
import type { Evidence, WriterOutput } from "./schema";

const runMock = run as unknown as ReturnType<typeof vi.fn>;
afterEach(() => {
  runMock.mockReset();
  vi.unstubAllEnvs();
});

const evidence: Evidence[] = [
  {
    id: "E1",
    tool: "get_fx_krw_rate",
    label: "환율 확인 · Frankfurter v2",
    values: { pair: "USD/KRW", rate: 1392.4, "comparison.rate": 1365.1, changePct: 2 },
    source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-10-19" },
    note: "일별 mid-market 기준환율입니다",
  },
  {
    id: "E2",
    tool: "get_rate_data",
    label: "금리 확인 · FRED — DFF",
    values: { indicator: "미국 실효연방기금금리", rate: 3.88, unit: "%", changePp: 0.25 },
    source: { name: "FRED — DFF", url: "https://fred.stlouisfed.org/series/DFF", asOf: "2026-10-16" },
  },
  {
    id: "E3-1",
    tool: "get_korean_economic_news",
    label: "경제 뉴스 확인 · 예시 기사",
    values: { title: "외국인, 이번 주 국내 주식 1조 2천억 원 순매도", publishedAt: "2026-10-17" },
    // 지어낸 예시 제목이라 실제 언론사 · 기사 주소를 붙이지 않습니다
    source: { name: "예시 기사 (실제 기사 아님)", url: "", asOf: "2026-10-17" },
  },
  {
    id: "C1",
    tool: "calc_metrics",
    label: "계산 · 한미 기준금리 차이",
    values: { changePp: 0.88, from: 3, to: 3.88, unit: "%" },
    source: { name: "한미 기준금리 차이", url: "", asOf: "2026-10-16" },
    lineage: { op: "pp_diff", inputs: ["E4", "E2"] },
  },
];

const why: WriterOutput["why"] = [
  { claim: "미국 금리가 한국보다 높은 상태에서 환율이 올랐습니다.", evidence: "환율 +2.00%, 금리 차이 0.88%p", basis: "data", refs: ["E1", "C1"] },
  { claim: "글로벌 위험 회피 심리가 커졌습니다.", evidence: "데이터로 확인되지 않음", basis: "none", refs: [] },
  { claim: "외국인이 국내 주식을 팔았다는 보도가 있었습니다.", evidence: "연합뉴스 제목", basis: "news", refs: ["E3-1", "E9-9"] },
  { claim: "장부에 없는 id 만 인용한 주장입니다.", evidence: "…", basis: "data", refs: ["E7"] },
];

describe("judgeable · judgeInput", () => {
  it("basis 가 none 이거나 refs 가 장부에 없는 항목은 보내지 않고, refs 는 장부에 있는 것만 남긴다", () => {
    const items = judgeable(why, evidence);
    expect(items.map((i) => [i.index, i.refs])).toEqual([
      [0, ["E1", "C1"]],
      [2, ["E3-1"]],
    ]);
  });

  it("입력은 번호 붙은 원인 목록이고, 항목마다 자기가 인용한 장부 항목만 바로 아래에 둔다 (값 · note · 계산 계보 포함)", () => {
    const input = judgeInput(judgeable(why, evidence), evidence);
    expect(input).toContain("[원인 목록]");
    // 1번 항목 아래에는 E1 · C1, 3번 항목 아래에는 E3-1 만 (다른 항목의 근거로 판정하지 않게)
    const third = input.indexOf("3. claim");
    expect(input.indexOf("- E1 ·")).toBeLessThan(third);
    expect(input.indexOf("- C1 ·")).toBeLessThan(third);
    expect(input.indexOf("- E3-1 ·")).toBeGreaterThan(third);
    expect(input.match(/\[장부 항목\]/g)).toHaveLength(2);
    expect(input).toContain("1. claim: 미국 금리가 한국보다 높은 상태에서 환율이 올랐습니다.");
    expect(input).toContain("evidence(작성의 설명): 환율 +2.00%, 금리 차이 0.88%p");
    expect(input).toContain("basis: data · refs: E1, C1");
    expect(input).toContain("3. claim: 외국인이 국내 주식을 팔았다는 보도가 있었습니다.");
    expect(input).not.toContain("2. claim");
    expect(input).not.toContain("E9-9");
    expect(input).toContain("[장부 항목]");
    expect(input).toContain("- E1 · 환율 확인 · Frankfurter v2 · 기준일 2026-10-19");
    expect(input).toContain('"changePct":2');
    // 환율 항목은 코드가 방향을 적어 준다
    expect(input).toContain("방향(코드): 1 USD 를 사는 데 드는 원화가 1365.1 → 1392.4 로 늘어남 = USD 강세 · 원화 약세");
    expect(input).toContain("note: 일별 mid-market 기준환율입니다");
    expect(input).toContain("계산: pp_diff ← E4, E2");
    expect(input).toContain("외국인, 이번 주 국내 주식 1조 2천억 원 순매도");
    // 인용되지 않은 E2 는 보여 주지 않는다
    expect(input).not.toContain("FRED — DFF");
  });

  it("환율 방향은 코드가 적는다: 100엔당 원화가 줄면 엔화 약세. 환율이 아니거나 값이 없으면 없음", () => {
    const jpy = { ...evidence[0]!, values: { pair: "JPY(100)/KRW", unit: "KRW per 100 JPY", rate: 905.1, "comparison.rate": 912.4, changePct: -0.8 } };
    expect(directionHint(jpy)).toBe("100 JPY 를 사는 데 드는 원화가 912.4 → 905.1 로 줄어듦 = JPY 약세 · 원화 강세");
    expect(directionHint({ ...jpy, values: { ...jpy.values, rate: 912.4 } })).toBe("100 JPY 를 사는 데 드는 원화가 912.4 그대로 (변화 없음)");
    expect(directionHint(evidence[1]!)).toBeUndefined();
    expect(directionHint({ ...evidence[0]!, values: { pair: "USD/KRW" } })).toBeUndefined();
  });

  it("지시문에 세 판정의 뜻 · 장부 밖 지식 금지 · 숫자는 보지 않음 · 전망과 보도 구분 · 항목마다 자기 장부만 · 코드 방향이 있다", () => {
    const text = judgeInstructions();
    for (const phrase of ["supported", "contradicted", "unsupported", "장부에 없는 지식으로 판정하지 않습니다", "숫자가 정확히 맞는지는 보지 않습니다", "전망", "보도 사실", "원화 약세", "둔화", "다른 항목 아래의 장부 항목은 그 항목의 근거가 아닙니다", "방향(코드)", "판단할 값 자체가 없을 때만"]) {
      expect(text).toContain(phrase);
    }
    // 네 Agent 와 같은 persona · 공통 규칙이 앞에 붙는다
    expect(text).toContain("당신은 Muffin");
  });

  it("판정 Agent 는 작은 모델을 쓰고 이름이 고정이며, 분류 · 정제 모델(OPENAI_MODEL_SMALL)과 따로 OPENAI_MODEL_JUDGE 로만 바꿀 수 있다", () => {
    expect(createJudgeAgent().name).toBe("Muffin Judge");
    expect(createJudgeAgent().model).toBe("gpt-5.4-mini");
    vi.stubEnv("OPENAI_MODEL_SMALL", "gpt-test-small");
    expect(createJudgeAgent().model).toBe("gpt-5.4-mini");
    vi.stubEnv("OPENAI_MODEL_JUDGE", "gpt-test-judge");
    expect(createJudgeAgent().model).toBe("gpt-test-judge");
    expect(createJudgeAgent().modelSettings).toMatchObject({ timeoutMs: 15_000, retry: { maxRetries: 1 } });
  });
});

describe("alignVerdicts · judgeWhy", () => {
  it("모델 출력을 why 순서에 맞추고, 보내지 않은 항목은 skipped · 빠뜨린 항목은 missing, 없는 번호는 버린다", () => {
    const items = judgeable(why, evidence);
    const results = alignVerdicts(
      { verdicts: [{ index: 1, verdict: "supported", reason: "E1 changePct 2, C1 0.88%p" }, { index: 8, verdict: "contradicted", reason: "없는 번호" }] },
      items,
      why.length,
    );
    expect(results).toEqual([
      { index: 0, verdict: "supported", reason: "E1 changePct 2, C1 0.88%p" },
      { index: 1, verdict: "skipped", reason: expect.stringContaining("none") },
      { index: 2, verdict: "missing", reason: "모델이 이 항목을 답하지 않음" },
      { index: 3, verdict: "skipped", reason: expect.stringContaining("장부에 없어") },
    ]);
    // 같은 번호를 두 번 주면 처음 것
    const twice = alignVerdicts({ verdicts: [{ index: 3, verdict: "unsupported", reason: "a" }, { index: 3, verdict: "supported", reason: "b" }] }, items, why.length);
    expect(twice[2]).toEqual({ index: 2, verdict: "unsupported", reason: "a" });
  });

  it("한 번의 호출로 판정하고 결과를 why 에 맞춘다", async () => {
    runMock.mockResolvedValue({ finalOutput: { verdicts: [{ index: 1, verdict: "supported", reason: "r1" }, { index: 3, verdict: "unsupported", reason: "r3" }] } });
    const results = await judgeWhy(why, evidence);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect((runMock.mock.calls[0] as unknown[])[0]).toMatchObject({ name: "Muffin Judge" });
    expect((runMock.mock.calls[0] as unknown[])[1]).toContain("[원인 목록]");
    expect(results?.map((r) => r.verdict)).toEqual(["supported", "skipped", "unsupported", "skipped"]);
    expect(summarizeJudge(results!)).toEqual({ supported: 1, unsupported: 1, contradicted: 0, skipped: 2, missing: 0 });
  });

  it("판정할 항목이 없으면 모델을 부르지 않고 모두 skipped 다", async () => {
    const results = await judgeWhy([why[1]!], evidence);
    expect(runMock).not.toHaveBeenCalled();
    expect(results).toEqual([{ index: 0, verdict: "skipped", reason: expect.any(String) }]);
  });

  it("모델이 출력을 내지 못하거나 throw 하면 null 이다 (평가가 '판정 못 함' 으로 표시)", async () => {
    runMock.mockResolvedValueOnce({ finalOutput: undefined });
    expect(await judgeWhy(why, evidence)).toBeNull();
    runMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await judgeWhy(why, evidence)).toBeNull();
  });

  it("출력 스키마는 세 판정만 받고, 표기는 ✓ ✗ ⚡ 다", () => {
    expect(judgeSchema.safeParse({ verdicts: [{ index: 1, verdict: "maybe", reason: "" }] }).success).toBe(false);
    expect(judgeSchema.safeParse({ verdicts: [{ index: 1, verdict: "contradicted", reason: "E1 changePct -0.93" }] }).success).toBe(true);
    expect(verdictMark).toEqual({ supported: "✓", unsupported: "✗", contradicted: "⚡", skipped: "-", missing: "?" });
  });
});

describe("코드가 적어 주는 값 비교 (보정 11/5)", () => {
  it("reason 이 verdict 보다 먼저 온다 (근거를 적은 뒤 결론)", () => {
    expect(Object.keys(judgeSchema.shape.verdicts.element.shape)).toEqual(["index", "reason", "verdict"]);
  });

  it("한 항목 안의 비교: 금리 수준 변화 · ETF 대 지수 · 종가 대 NAV · 물가 지수와 둔화", () => {
    const rate: Evidence = { id: "E3", tool: "get_rate_data", label: "금리 확인 · FRED", values: { indicator: "DFF", rate: 3.88, comparisonRate: 3.63, changePp: 0.25 }, source: { name: "FRED", url: "https://fred.stlouisfed.org/series/DFF", asOf: "2026-10-16" } };
    expect(valueHints(rate)).toEqual(["rate 3.63 → 3.88: 올랐음"]);
    const etf: Evidence = { id: "E6", tool: "get_etf_kr_price", label: "ETF", values: { "period.returnPct": -3.61, "period.indexReturnPct": -4.37, "latest.close": 110745, "latest.nav": 110640.5 }, source: { name: "KRX", url: "https://x", asOf: "2026-11-02" } };
    expect(valueHints(etf)).toEqual(["ETF 수익률 -3.61 은 지수 수익률 -4.37 보다 높음 (덜 떨어짐)", "종가 110745 는 NAV 110640.5 보다 높음 → 괴리율 양수"]);
    const cpi: Evidence = { id: "E5", tool: "get_macro_indicators", label: "물가", values: { indicator: "소비자물가지수(CPI)", "latest.value": 116.2, "latest.yoy": 2.4, "previousMonth.value": 115.9, "previousMonth.yoy": 3.1 }, source: { name: "ECOS", url: "https://x", asOf: "2026-09" } };
    expect(valueHints(cpi)).toEqual(["물가 지수 115.9 → 116.2: 올랐음", "전년 대비 +2.4%: 전년보다 올랐음(물가 상승) · 상승률은 3.1 → 2.4 로 둔화(물가가 내린 것은 아님)"]);
    // 실제 물가 tool 의 키 (latest.previousMonth.value · latest.previousMonth.change · latest.previousYear.change), 변화 단위는 changeUnit
    const real: Evidence = { ...cpi, values: { indicator: "cpi", indicatorName: "소비자물가지수 총지수", unit: "2020=100", changeUnit: "percent", "latest.month": "202610", "latest.value": 120.73, "latest.previousMonth.month": "202609", "latest.previousMonth.value": 120.43, "latest.previousMonth.change": 0.25, "latest.previousYear.value": 118.1, "latest.previousYear.change": 2.23 } };
    expect(valueHints(real)).toEqual(["물가 지수 120.43 → 120.73: 올랐음 (전월 대비 +0.25%)", "전년 대비 +2.23%: 전년보다 올랐음(물가 상승)"]);
    // 실업률은 물가로 읽지 않고, 변화는 %p 로 적는다 (label 은 둘 다 "물가·고용 지표 확인" 이라 indicator 로 가림)
    const jobless: Evidence = { ...cpi, label: "물가·고용 지표 확인 · 한국은행 ECOS — 실업률", values: { indicator: "unemployment", indicatorName: "실업률", unit: "%", changeUnit: "percentage_points", "latest.value": 4.2, "latest.previousMonth.value": 4.1, "latest.previousMonth.change": 0.1, "latest.previousYear.value": 3.9, "latest.previousYear.change": 0.3 } };
    expect(valueHints(jobless)).toEqual(["실업률 4.1 → 4.2: 올랐음 (전월 대비 +0.1%p)", "전년 대비 +0.3%p: 전년보다 실업률이 높음"]);
    expect(valueHints({ ...jobless, values: { ...jobless.values, "latest.previousYear.change": -0.2 } })[1]).toBe("전년 대비 -0.2%p: 전년보다 실업률이 낮음");
    // 환율은 방향(코드) 줄이 따로 있어 rate 비교를 다시 적지 않는다
    expect(valueHints({ ...rate, tool: "get_fx_krw_rate", values: { pair: "USD/KRW", rate: 1341.05, "comparison.rate": 1345.67 } })).toEqual([]);
  });

  it("여러 항목의 같은 숫자 키는 크기 순으로 적는다 (음수끼리도 부호대로)", () => {
    const a: Evidence = { id: "E1", tool: "get_etf_kr_price", label: "KODEX 200", values: { name: "KODEX 200", "period.returnPct": -14.36, "period.days": 90, "latest.date": "2026-11-03" }, source: { name: "KRX", url: "https://x", asOf: "2026-11-03" } };
    const b: Evidence = { id: "E2", tool: "get_etf_kr_price", label: "TIGER 200", values: { name: "TIGER 200", "period.returnPct": -14.79, "period.days": 90, "latest.date": "2026-11-03" }, source: { name: "KRX", url: "https://x", asOf: "2026-11-03" } };
    expect(comparisonHints([a, b])).toEqual(["period.returnPct: E1 -14.36 > E2 -14.79 (E1 이 가장 높음)"]);
    expect(comparisonHints([a])).toEqual([]);
    // 같은 값은 = 로, "가장 높음" 대신 "같음"
    const c: Evidence = { ...b, id: "E3", values: { ...b.values, "period.returnPct": -14.36 } };
    expect(comparisonHints([a, c])).toEqual(["period.returnPct: E1 -14.36 = E3 -14.36 (E1 · E3 같음)"]);
    // 견줄 수 없는 것은 비교하지 않음: 다른 tool(환율 rate 와 금리 rate), 다른 통화쌍, 다른 단위
    const fx: Evidence = { id: "E4", tool: "get_fx_krw_rate", label: "환율", values: { pair: "USD/KRW", unit: "KRW per 1 USD", rate: 1392.4 }, source: { name: "F", url: "https://x", asOf: "2026-10-19" } };
    const rate: Evidence = { id: "E5", tool: "get_rate_data", label: "금리", values: { indicator: "DFF", unit: "%", rate: 3.88 }, source: { name: "FRED", url: "https://x", asOf: "2026-10-16" } };
    const jpy: Evidence = { ...fx, id: "E6", values: { pair: "JPY(100)/KRW", unit: "KRW per 100 JPY", rate: 912.4 } };
    expect(comparisonHints([fx, rate])).toEqual([]);
    expect(comparisonHints([fx, jpy])).toEqual([]);
    const kr: Evidence = { ...rate, id: "E7", values: { indicator: "BOK", unit: "%", rate: 3.0 } };
    expect(comparisonHints([rate, kr])).toEqual([]); // 지표가 다르면 비교하지 않음 (한미 금리 차이는 계산 tool 의 몫)
    const kr2: Evidence = { ...rate, id: "E8", values: { indicator: "DFF", unit: "%", rate: 3.63 } };
    expect(comparisonHints([rate, kr2])).toEqual(["rate: E5 3.88 > E8 3.63 (E5 이 가장 높음)"]);
    const input = judgeInput(judgeable([{ claim: "KODEX 가 TIGER 보다 낮았다", evidence: "", basis: "data", refs: ["E1", "E2"] }], [a, b]), [a, b]);
    expect(input).toContain("크기 비교(코드): period.returnPct: E1 -14.36 > E2 -14.79");
  });
});
