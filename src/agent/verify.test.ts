import { describe, expect, it } from "vitest";
import type { Evidence, WriterOutput } from "./schema";
import {
  SUMMARY_FALLBACK,
  applyVerification,
  extractNumbers,
  isDataNumber,
  matchValue,
  numericCandidates,
  roleConflict,
  summarizeVerification,
  verify,
  verifyNumbers,
  verifyWhy,
} from "./verify";

const src = (name: string, asOf = "2026-10-19") => ({ name, url: `https://example.com/${name}`, asOf });

const fx: Evidence = {
  id: "E1",
  tool: "get_fx_krw_rate",
  label: "환율 확인 · Frankfurter v2",
  values: { pair: "USD/KRW", rate: 1392.4, asOf: "2026-10-19", comparisonRate: 1365.1, change: 27.3, changePct: 2.0 },
  source: src("Frankfurter v2"),
};
const rate: Evidence = {
  id: "E2",
  tool: "get_rate_data",
  label: "금리 확인 · ECOS",
  values: { indicator: "한국은행 기준금리", rate: 3, unit: "%", asOf: "2026-10-16", comparisonDate: "2026-09-16", comparisonRate: 2.75, changePp: 0.25, changeBp: 25, requestedDays: 30 },
  source: src("ECOS", "2026-10-16"),
};
const cpi: Evidence = {
  id: "E3",
  tool: "get_macro_indicators",
  label: "물가 확인 · ECOS",
  values: { indicator: "소비자물가지수", value: 120.43, yoy: 2.878866, mom: 0.316535, asOf: "2026-09-01" },
  source: src("ECOS CPI", "2026-09-01"),
};
const news: Evidence = {
  id: "E4-1",
  tool: "get_korean_economic_news",
  label: "경제 뉴스 확인 · 연합뉴스",
  values: { title: "외국인, 이번 주 국내 주식 1조 2천억 원 순매도", publishedAt: "2026-10-17" },
  source: src("연합뉴스", "2026-10-17"),
};
const calc: Evidence = {
  id: "C1",
  tool: "calc_metrics",
  label: "계산 · 한미 금리 차이",
  values: { op: "spread", result: 0.88, a: 3.88, b: 3 },
  source: { name: "계산 (E3 − E2)", url: "", asOf: "2026-10-16" },
  lineage: { op: "spread", inputs: ["E3", "E2"] },
};
const ledger = [fx, rate, cpi, news, calc];

const n = (value: string, unit = "", text = value) => ({ value: Number(value.replace(/,/g, "")), unit, text });

describe("extractNumbers", () => {
  it("단위 · 쉼표 · 부호 · 괄호를 처리한다", () => {
    expect(extractNumbers("1,392.40원")).toEqual([{ value: 1392.4, unit: "원", text: "1,392.40" }]);
    expect(extractNumbers("30일 -38.1원 (-2.79%)")).toEqual([
      { value: 30, unit: "일", text: "30" },
      { value: -38.1, unit: "원", text: "38.1" },
      { value: -2.79, unit: "%", text: "2.79" },
    ]);
    expect(extractNumbers("0.88%p")).toEqual([{ value: 0.88, unit: "%p", text: "0.88" }]);
    expect(extractNumbers("-0.5bp")).toEqual([{ value: -0.5, unit: "bp", text: "0.5" }]);
  });

  it("조 · 억 단위는 하나의 숫자로 합치고, 날짜는 뺀다", () => {
    expect(extractNumbers("1조 2,000억 원")).toEqual([{ value: 1.2e12, unit: "원", text: "1조 2,000억" }]);
    // "천억" · "천만" 처럼 이어 쓴 자릿수도 읽는다
    expect(extractNumbers("1조 2천억 원")).toEqual([{ value: 1.2e12, unit: "원", text: "1조 2천억" }]);
    expect(extractNumbers("5천만 원")).toEqual([{ value: 5e7, unit: "원", text: "5천만" }]);
    // 부호는 금액 전체에 걸린다 (-1조 2,000억 = -1.2조, -8,000억이 아님)
    expect(extractNumbers("-1조 2,000억원 순매도")).toEqual([{ value: -1.2e12, unit: "원", text: "1조 2,000억" }]);
    expect(extractNumbers("3,500만 원과 -2억 5,000만 원")).toEqual([
      { value: 3.5e7, unit: "원", text: "3,500만" },
      { value: -2.5e8, unit: "원", text: "2억 5,000만" },
    ]);
    expect(extractNumbers("2026-10-22 기준 3%")).toEqual([{ value: 3, unit: "%", text: "3" }]);
  });

  it("비교 기간 · 연도 · 횟수는 데이터 숫자가 아니다", () => {
    const parsed = extractNumbers("2026년 8월 대비 +0.32%");
    expect(parsed.filter(isDataNumber)).toEqual([{ value: 0.32, unit: "%", text: "0.32" }]);
    // "(2020=100)" 은 지수 기준 표기라 숫자로 보지 않는다
    expect(extractNumbers("120.43 (2020=100)").filter(isDataNumber).map((p) => p.value)).toEqual([120.43]);
    expect(isDataNumber({ value: 1392.4, unit: "원", text: "1,392.40" })).toBe(true);
  });

  it("환율 기준 단위(1달러당 · 100엔당 · 1달러에 · 같은 1달러를 사는)와 연월(2026-08)은 숫자로 보지 않는다", () => {
    expect(extractNumbers("2026-10-27 기준 1달러당 1,324.72원")).toEqual([{ value: 1324.72, unit: "원", text: "1,324.72" }]);
    expect(extractNumbers("100엔당 912.30원")).toEqual([{ value: 912.3, unit: "원", text: "912.30" }]);
    expect(extractNumbers("1달러에 1,324.72원")).toEqual([{ value: 1324.72, unit: "원", text: "1,324.72" }]);
    expect(extractNumbers("같은 1달러를 사는 데 필요한 원화")).toEqual([]);
    // 기준 단위 문맥이 없는 외화 금액은 1달러 · 100엔이라도 숫자다 ("유가가 1달러 하락" 이 검사를 건너뛰면 안 됨)
    expect(extractNumbers("5달러")).toEqual([{ value: 5, unit: "달러", text: "5" }]);
    expect(extractNumbers("유가가 1달러 하락했습니다").map((p) => p.value)).toEqual([1]);
    expect(extractNumbers("100엔 올랐습니다").map((p) => p.value)).toEqual([100]);
    expect(extractNumbers("2026-08 대비 상승")).toEqual([]);
  });

  it("부호 없이 쓰고 바로 뒤에 하락 낱말이 붙은 숫자는 falling 이다. 붙은 괄호는 건너뛰고, 다음 숫자의 낱말은 가져오지 않는다", () => {
    expect(extractNumbers("2026-09-27보다 34.69원(-2.55%) 낮습니다")).toEqual([
      { value: 34.69, unit: "원", text: "34.69", falling: true },
      { value: -2.55, unit: "%", text: "2.55" },
    ]);
    expect(extractNumbers("1,324.72원으로 30일 전보다 2.55% 하락했습니다")).toEqual([
      { value: 1324.72, unit: "원", text: "1,324.72" },
      { value: 30, unit: "일", text: "30" },
      { value: 2.55, unit: "%", text: "2.55", falling: true },
    ]);
    expect(extractNumbers("34.69원 올랐습니다")).toEqual([{ value: 34.69, unit: "원", text: "34.69" }]);
    // 로 · 으로가 붙으면 하락폭이 아니라 도착한 수준이다
    expect(extractNumbers("기간 수익률은 21.47%로 하락했습니다")).toEqual([{ value: 21.47, unit: "%", text: "21.47" }]);
  });
});

describe("matchValue 정책", () => {
  it("정확 일치 → exact", () => {
    expect(matchValue(n("1,392.40", "원"), numericCandidates(fx))).toEqual({ key: "rate", policy: "exact" });
    expect(matchValue(n("3.00", "%"), numericCandidates(rate))).toEqual({ key: "rate", policy: "exact" });
  });

  it("표기 자릿수로 반올림하면 같음 → rounded", () => {
    expect(matchValue(n("2.88", "%"), numericCandidates(cpi))).toEqual({ key: "yoy", policy: "rounded" });
    expect(matchValue(n("0.32", "%"), numericCandidates(cpi))).toEqual({ key: "mom", policy: "rounded" });
  });

  it("단위 환산 (비율 ↔ %, %p ↔ bp) → scaled. 이미 퍼센트인 값(changePct 0.02 = 0.02%)은 ×100 하지 않는다", () => {
    expect(matchValue(n("2.00", "%"), [{ key: "ratio", value: 0.02, unit: "ratio" }])).toEqual({ key: "ratio", policy: "scaled" });
    expect(matchValue(n("2", "%"), [{ key: "changePct", value: 0.02, unit: "pct" }])).toBeNull();
    expect(numericCandidates({ ...fx, values: { weightRatio: 0.02, changePct: 0.02 } }).map((c) => c.unit)).toEqual(["ratio", "pct"]);
    expect(matchValue(n("25", "bp"), [{ key: "changePp", value: 0.25, unit: "pp" }])).toEqual({ key: "changePp", policy: "scaled" });
    expect(matchValue(n("0.25", "%p"), [{ key: "changeBp", value: 25, unit: "bp" }])).toEqual({ key: "changeBp", policy: "scaled" });
  });

  it("표기 단위와 장부 단위가 호환돼야 한다: 25bp 는 25% 가 아니고, %p 는 아무 0.25 와 맞지 않고, 환율 1,392 는 1,392% 가 아니다", () => {
    expect(matchValue(n("25", "%"), [{ key: "changeBp", value: 25, unit: "bp" }])).toBeNull();
    expect(matchValue(n("0.25", "%p"), [{ key: "nav", value: 0.25, unit: "plain" }])).toBeNull();
    expect(matchValue(n("1,392.40", "원"), [{ key: "changePct", value: 1392.4, unit: "pct" }])).toBeNull();
    expect(matchValue(n("1,392", "%"), numericCandidates(fx))).toBeNull();
    // 금리처럼 plain 으로 저장된 값은 장부의 unit 메타가 "%" 일 때만 "3%" 와 맞는다
    expect(matchValue(n("3", "%"), [{ key: "rate", value: 3, unit: "plain" }])).toBeNull();
    expect(matchValue(n("3", "%"), numericCandidates(rate))).toEqual({ key: "rate", policy: "exact" });
  });

  it("상대 오차 0.1% 안이면 tolerance, 넘으면 실패", () => {
    expect(matchValue(n("100.05"), [{ key: "v", value: 100, unit: "plain" }])).toEqual({ key: "v", policy: "tolerance" });
    expect(matchValue(n("1,400", "원"), numericCandidates(fx))).toBeNull();
    expect(matchValue(n("3.5", "%"), numericCandidates(rate))).toBeNull();
  });

  it("장부의 숫자 문자열과 짧은 문장 속 금융 숫자도 후보가 되고, 날짜 · 연도 · 라벨은 후보가 아니다", () => {
    const e: Evidence = { ...fx, values: { rate: "1,392.40", asOf: "2026-10-19", year: "2026", label: "USD", title: "환율 1,390원 돌파, 금리 3.00% 동결" } };
    expect(numericCandidates(e)).toEqual([
      { key: "rate", value: 1392.4, unit: "plain" },
      { key: "title#text", value: 1390, unit: "plain" },
      { key: "title#text", value: 3, unit: "pct" },
    ]);
    // 비교 기간 · 관측 수 같은 메타 키는 후보가 아니다 ("30%" 가 requestedDays 30 과 맞으면 안 됨). unit "%" 메타로 수준 값은 pct
    expect(numericCandidates(rate).map((c) => [c.key, c.unit])).toEqual([
      ["rate", "pct"],
      ["comparisonRate", "pct"],
      ["changePp", "pp"],
      ["changeBp", "bp"],
    ]);
    expect(matchValue(n("30", "%"), numericCandidates(rate))).toBeNull();
  });

  it("단위를 모르는 변화량(change)은 changeUnit 메타를 따르고, 없으면 어느 단위와도 맞춰 본다", () => {
    const macro: Evidence = { ...cpi, values: { "latest.value": 2.6, "latest.previousMonth.change": 0.1, changeUnit: "percentage_points" } };
    expect(numericCandidates(macro).map((c) => [c.key, c.unit])).toEqual([
      ["latest.value", "plain"],
      ["latest.previousMonth.change", "pp"],
    ]);
    expect(matchValue(n("0.1", "%p"), numericCandidates(macro))).toEqual({ key: "latest.previousMonth.change", policy: "exact" });
    expect(matchValue(n("0.1", "%"), numericCandidates(macro))).toBeNull();

    const pct: Evidence = { ...cpi, values: { "latest.previousYear.change": 2.88, changeUnit: "percent" } };
    expect(matchValue(n("2.88", "%"), numericCandidates(pct))).toEqual({ key: "latest.previousYear.change", policy: "exact" });

    // 단위를 모르는 변화량은 통화 · 단위 없는 표기와만 맞고, % · %p · bp 로 적으면 걸린다 ("27.3원" 을 "27.3%" 로 쓰는 것)
    const unknown: Evidence = { ...fx, values: { change: 27.3 } };
    expect(numericCandidates(unknown)[0].unit).toBe("delta");
    expect(matchValue(n("27.3", "원"), numericCandidates(unknown))).toEqual({ key: "change", policy: "exact" });
    expect(matchValue(n("27.3"), numericCandidates(unknown))).toEqual({ key: "change", policy: "exact" });
    expect(matchValue(n("27.3", "%"), numericCandidates(unknown))).toBeNull();
    expect(matchValue(n("27.3", "%p"), numericCandidates(unknown))).toBeNull();
  });

  it("하락 낱말로 쓴 변화량은 장부의 음수 값과 맞는다. 상승으로 쓰면 맞지 않고, 수준 값은 쓴 그대로 맞춘다", () => {
    const down: Evidence = { ...fx, values: { rate: 1324.72, change: -34.69, changePct: -2.55 } };
    const [amount, pct] = extractNumbers("34.69원(2.55%) 낮아졌습니다");
    expect(matchValue(amount, numericCandidates(down))).toEqual({ key: "change", policy: "exact" });
    expect(matchValue(pct, numericCandidates(down))).toEqual({ key: "changePct", policy: "exact" });
    expect(matchValue(extractNumbers("34.69원 올랐습니다")[0], numericCandidates(down))).toBeNull();
    expect(matchValue(extractNumbers("1,324.72원으로 낮아졌습니다")[0], numericCandidates(down))).toEqual({ key: "rate", policy: "exact" });
    // 수익률이 -21.47% 인데 "21.47%로 하락" 이라고 쓰면 틀린 수준이라 맞지 않는다
    const etf: Evidence = { ...fx, values: { "period.returnPct": -21.47 } };
    expect(matchValue(extractNumbers("기간 수익률은 21.47%로 하락했습니다")[0], numericCandidates(etf))).toBeNull();
    expect(matchValue(extractNumbers("기간 수익률은 -21.47%로 하락했습니다")[0], numericCandidates(etf))).toEqual({ key: "period.returnPct", policy: "exact" });
    // 장부는 2.55% 상승인데 "2.55% 하락" 이라고 쓰면 방향이 틀려 맞지 않는다 (양수 값으로 다시 맞추지 않음)
    const up: Evidence = { ...fx, values: { rate: 1392.4, changePct: 2.55 } };
    expect(matchValue(extractNumbers("2.55% 하락했습니다")[0], numericCandidates(up))).toBeNull();
  });

  it("두 퍼센트의 차이를 Pct 이름으로 저장한 키(trackingDiffPct)는 % 와 %p 표기를 둘 다 받는다", () => {
    const etf: Evidence = { ...fx, values: { "period.returnPct": -21.47, "period.indexReturnPct": -21.83, "period.trackingDiffPct": 0.36 } };
    expect(matchValue(n("0.36", "%"), numericCandidates(etf))).toEqual({ key: "period.trackingDiffPct", policy: "exact" });
    expect(matchValue(n("0.36", "%p"), numericCandidates(etf))).toEqual({ key: "period.trackingDiffPct", policy: "exact" });
  });
});

const num = (label: string, value: string, change: string, ref: string | null, asOf = "2026-10-19") => ({ label, value, change, asOf, ref });

describe("verifyNumbers", () => {
  it("value 의 첫 데이터 숫자와 change 의 데이터 숫자를 모두 장부와 대조한다", () => {
    const out = verifyNumbers(
      [
        num("USD/KRW", "1,392.40원", "30일 +27.3원 (+2.00%)", "E1"),
        num("기준금리", "3.00%", "30일 +25bp", "E2"),
        num("CPI 전년비", "2.88%", "2025년 9월 대비", "E3"),
        num("한미 금리차", "0.88%p", "", "C1"),
      ],
      ledger,
    );
    expect(out.map((f) => f.status)).toEqual(["verified", "verified", "verified", "derived"]);
    expect(out.map((f) => (f.status === "unverified" ? null : f.changeOk))).toEqual([true, true, true, true]);
    expect(out[0]).toMatchObject({ key: "rate", policy: "exact" });
  });

  it("ref 없음 · 모르는 id · 값 불일치 · label 의 틀린 숫자는 unverified 이고 이유가 적힌다", () => {
    const out = verifyNumbers(
      [
        num("없는 ref", "1.00%", "", null),
        num("모르는 id", "1", "", "E9"),
        num("틀린 값", "1,400원", "", "E1"),
        num("USD/KRW 1,500원", "1,392.40원", "", "E1"),
        num("KODEX 200 · 3년물", "1,392.40원", "", "E1"),
      ],
      ledger,
    );
    expect(out.map((f) => f.status)).toEqual(["unverified", "unverified", "unverified", "unverified", "verified"]);
    const reasons = out.map((f) => (f.status === "unverified" ? f.reason : ""));
    expect(reasons[0]).toContain("ref 없음");
    expect(reasons[1]).toContain("E9");
    expect(reasons[2]).toContain("1,400");
    expect(reasons[2]).toContain("rate=1392.4");
    expect(reasons[3]).toContain("label 의 숫자 1,500원");
  });

  it("value 는 맞는데 change 가 틀리면 verified 지만 changeOk 가 false. change 가 value 와 같은 값이면 틀린 것", () => {
    const [f, sameAsValue] = verifyNumbers(
      [num("USD/KRW", "1,392.40원", "30일 +50원", "E1"), num("USD/KRW", "1,392.40원", "30일 +1,392.40원", "E1")],
      ledger,
    );
    expect(f.status).toBe("verified");
    expect(f.status === "verified" && f.changeOk).toBe(false);
    expect(f.status === "verified" && f.changeProblem).toContain("50");
    expect(sameAsValue.status === "verified" && sameAsValue.changeOk).toBe(false);
  });

  it("비교 시점 값을 최신 기준일로 적으면 (또는 반대면) 실패한다. 날짜가 맞으면 통과", () => {
    const [wrongDate, rightDate, latest, change] = verifyNumbers(
      [
        num("기준금리", "2.75%", "", "E2", "2026-10-16"),
        num("30일 전 기준금리", "2.75%", "", "E2", "2026-09-16"),
        num("기준금리", "3.00%", "", "E2", "2026-10-16"),
        num("기준금리 변화", "0.25%p", "", "E2", "2026-10-16"),
      ],
      ledger,
    );
    expect(wrongDate.status).toBe("unverified");
    expect(wrongDate.status === "unverified" && wrongDate.reason).toContain("비교 시점 값");
    expect(rightDate.status).toBe("verified");
    expect(latest.status).toBe("verified");
    expect(change.status).toBe("verified");
    expect(roleConflict("rate", "2026-09-16", rate)).toContain("최신 값");
    expect(roleConflict("rate", "2026-01-01", rate)).toBeNull();
  });
});

const why = (basis: "data" | "news" | "none", refs: string[], evidence = "근거") => ({ claim: `주장 ${basis}`, evidence, basis, refs });

describe("verifyWhy", () => {
  it("basis 와 refs 가 맞으면 통과", () => {
    const out = verifyWhy([why("data", ["E1"]), why("news", ["E4-1"]), why("none", [], "데이터로 확인되지 않음")], ledger);
    expect(out.map((w) => w.ok)).toEqual([true, true, true]);
  });

  it("basis 와 refs 가 어긋나면 none 으로 낮추는 수정안을 낸다", () => {
    const [onlyNews, onlyData] = verifyWhy([why("data", ["E4-1"]), why("news", ["E1"])], ledger);
    expect(onlyNews.ok).toBe(false);
    expect(onlyNews.fix).toEqual({ basis: "none", refs: [], evidence: "데이터로 확인되지 않음" });
    expect(onlyData.fix.basis).toBe("none");
  });

  it("장부에 없는 id 는 지우고, none 인데 refs 나 근거 문장이 있으면 규칙대로 고친다", () => {
    const [unknown, noneWithRefs] = verifyWhy([why("data", ["E1", "E9"]), why("none", ["E1"], "환율 상승")], ledger);
    expect(unknown.ok).toBe(false);
    expect(unknown.fix).toEqual({ refs: ["E1"] });
    expect(noneWithRefs.problems).toHaveLength(2);
    expect(noneWithRefs.fix).toEqual({ refs: [], evidence: "데이터로 확인되지 않음" });
  });
});

const output: WriterOutput = {
  summary: "환율이 올랐습니다.",
  numbers: [
    num("USD/KRW", "1,392.40원", "30일 +27.3원 (+2.00%)", "E1"),
    num("틀린 값", "1,400원", "", "E1"),
    num("change 틀림", "1,392.40원", "30일 +50원", "E1"),
  ],
  why: [why("data", ["E1"]), why("data", ["E4-1"])],
  impact: ["수입 물가가 오를 수 있습니다.", "지금 달러를 매수하세요."],
  caveats: [],
  dataGaps: ["금리 데이터 없음"],
  nextTopics: [],
};

describe("verify · applyVerification · summarizeVerification", () => {
  it("실패 목록은 작성 Agent 가 읽을 문장이다", () => {
    const r = verify(output, ledger);
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(4);
    expect(r.failures[0]).toContain('"틀린 값"');
    expect(r.failures[1]).toContain("change");
    expect(r.failures[2]).toContain('why "주장 data"');
    expect(r.failures[3]).toContain("투자 권유 표현");
  });

  it("본문(summary · why · impact · caveats)의 금융 숫자도 장부에 있어야 한다. 이름 속 정수는 보지 않는다", () => {
    const withText: WriterOutput = {
      ...output,
      numbers: [output.numbers[0]],
      summary: "KODEX 200 이야기입니다. 달러는 1,392.40원으로 한 달 전보다 2% 올랐습니다. 그 사이 금리는 5.00% 였습니다.",
      why: [{ ...why("news", ["E4-1"]), evidence: "연합뉴스: 외국인 1조 2,000억 원 순매도" }, { ...why("data", ["E1"]), evidence: "환율 27.3원 상승" }],
      impact: ["수입 물가가 10% 오를 수 있습니다.", "달러 자산의 원화 가치가 오릅니다."],
      caveats: ["주말 값은 직전 영업일 기준입니다."],
    };
    const r = verify(withText, ledger);
    // 기사 제목의 "1조 2천억 원" 과 본문의 "1조 2,000억 원" 은 같은 금액이라 통과한다
    expect(r.text).toEqual([
      { field: "summary", index: 0, text: withText.summary, unmatched: ["5.00%"] },
      { field: "impact", index: 0, text: "수입 물가가 10% 오를 수 있습니다.", unmatched: ["10%"] },
    ]);
    expect(r.failures.some((f) => f.startsWith("summary 의 숫자 5.00%"))).toBe(true);

    const applied = applyVerification(withText, r);
    expect(applied.output.summary).toBe("KODEX 200 이야기입니다. 달러는 1,392.40원으로 한 달 전보다 2% 올랐습니다.");
    expect(applied.output.why.map((w) => w.claim)).toEqual(["주장 news", "주장 data"]);
    expect(applied.output.impact).toEqual(["달러 자산의 원화 가치가 오릅니다."]);
    expect(applied.output.caveats).toEqual(["주말 값은 직전 영업일 기준입니다."]);
  });

  it("기사 제목에 없는 금액을 뉴스 근거에 쓰면 그 원인을 뺀다", () => {
    const invented: WriterOutput = {
      ...output,
      numbers: [output.numbers[0]],
      why: [{ ...why("news", ["E4-1"]), evidence: "연합뉴스: 외국인 이번 주 3조 5천억 원 순매도 보도" }],
      impact: [],
    };
    const r = verify(invented, ledger);
    expect(r.text.map((t) => [t.field, t.unmatched])).toEqual([["why", ["3조 5천억원"]]]);
    expect(applyVerification(invented, r).output.why).toEqual([]);
  });

  it("남은 실패는 fail-closed 로 처리한다: 숫자 삭제 · change 비움 · basis 낮춤 · 권유 문장 삭제 · dataGaps 기록", () => {
    const applied = applyVerification(output, verify(output, ledger));
    expect(applied.output.numbers.map((x) => [x.label, x.change])).toEqual([
      ["USD/KRW", "30일 +27.3원 (+2.00%)"],
      ["change 틀림", ""],
    ]);
    expect(applied.checks).toEqual(["verified", "verified"]);
    expect(applied.output.why[1]).toMatchObject({ basis: "none", refs: [], evidence: "데이터로 확인되지 않음" });
    expect(applied.output.impact).toEqual(["수입 물가가 오를 수 있습니다."]);
    expect(applied.output.dataGaps).toEqual(["금리 데이터 없음", "검증을 통과하지 못해 뺀 숫자 1개 (출처 값과 맞지 않았습니다)"]);
    expect(applied.removed).toHaveLength(4);
    expect(applied.removed).toContain("impact 2번째 항목 삭제: 투자 권유 표현");
    expect(applied.removed).toContain("원인 2번째 근거 표시 수정: basis 가 data 인데 숫자 데이터가 있는 증거(refs)가 없음");
    expect(JSON.stringify(applied)).not.toContain("매수하세요");

    const v = summarizeVerification(applied, 1);
    expect(v).toMatchObject({ status: "partial", numbers: { total: 2, verified: 2, derived: 0, unverified: 0 }, advice: 0, revisions: 1 });
    expect(v.why).toEqual({ data: 1, news: 0, none: 1, unsupported: 0 });
  });

  it("dataGaps 와 숫자(label · value · change)의 권유 표현도 잡아서 뺀다", () => {
    const sneaky: WriterOutput = {
      ...output,
      numbers: [
        output.numbers[0],
        { ...output.numbers[0], label: "지금 매수하세요 환율" },
        { ...output.numbers[0], value: "1,392.40원, 지금 사세요" },
      ],
      why: [],
      impact: [],
      dataGaps: ["금리 데이터 없음", "지금이 살 때입니다."],
    };
    const r = verify(sneaky, ledger);
    expect(r.advice).toEqual(["지금이 살 때입니다.", "지금 매수하세요 환율", "1,392.40원, 지금 사세요"]);
    const applied = applyVerification(sneaky, r);
    expect(applied.output.dataGaps).toEqual(["금리 데이터 없음"]);
    expect(applied.output.numbers).toHaveLength(1);
    expect(applied.removed).toContain("dataGaps 2번째 항목 삭제: 투자 권유 표현");
    expect(applied.removed).toContain("숫자 2번째 항목 삭제: 투자 권유 표현");
    expect(applied.removed).toContain("숫자 3번째 항목 삭제: 투자 권유 표현");
    expect(JSON.stringify(applied)).not.toContain("사세요");
    expect(JSON.stringify(applied)).not.toContain("매수하세요");
    expect(summarizeVerification(applied, 1).advice).toBe(0);
  });

  it("근거 표시를 고친 원인에 권유 표현이 있으면 고친 뒤에도 뺀다", () => {
    const sneaky: WriterOutput = {
      ...output,
      numbers: [output.numbers[0]],
      why: [{ claim: "지금 매수하세요.", evidence: "환율 상승", basis: "data", refs: ["E9"] }],
      impact: [],
    };
    const applied = applyVerification(sneaky, verify(sneaky, ledger));
    expect(applied.output.why).toEqual([]);
    expect(JSON.stringify(applied)).not.toContain("매수하세요");
  });

  it("모두 통과하면 pass 이고 아무것도 빼지 않는다", () => {
    const clean: WriterOutput = { ...output, numbers: [output.numbers[0], num("한미 금리차", "0.88%p", "", "C1")], why: [why("data", ["E1"])], impact: ["수입 물가가 오를 수 있습니다."] };
    const applied = applyVerification(clean, verify(clean, ledger));
    expect(applied.removed).toEqual([]);
    expect(summarizeVerification(applied, 0)).toMatchObject({ status: "pass", numbers: { total: 2, verified: 1, derived: 1 }, revisions: 0 });
  });

  it("summary 의 권유 문장은 그 문장만 지우고, 전부 권유면 안내 문장으로 바꾼다", () => {
    const mixed: WriterOutput = { ...output, summary: "달러가 올랐습니다. 지금이 살 때입니다.", numbers: [output.numbers[0]], why: [], impact: [] };
    const a = applyVerification(mixed, verify(mixed, ledger));
    expect(a.output.summary).toBe("달러가 올랐습니다.");
    // 권유 문장은 removed 에도 남기지 않는다 (리포트 어디에도 권유 표현이 없어야 함)
    expect(a.removed).toEqual(["summary 의 권유 문장 삭제"]);
    expect(JSON.stringify(a)).not.toContain("살 때");
    expect(summarizeVerification(a, 1)).toMatchObject({ status: "partial", advice: 0 });

    const onlyAdvice: WriterOutput = { ...mixed, summary: "지금이 살 때입니다." };
    const b = applyVerification(onlyAdvice, verify(onlyAdvice, ledger));
    expect(b.output.summary).toBe(SUMMARY_FALLBACK);
  });

  it("value 에 데이터 숫자가 여러 개면 모두 장부와 맞아야 한다", () => {
    const [ok, invented] = verifyNumbers(
      [num("CPI", "120.43 (2020=100)", "", "E3"), num("USD/KRW", "1,392.40원 (전일 1,380.00원)", "", "E1")],
      ledger,
    );
    expect(ok.status).toBe("verified");
    expect(invented.status).toBe("unverified");
    expect(invented.status === "unverified" && invented.reason).toContain("1,380.00");
  });

  it("basis 가 data 인데 숫자가 없는 증거만 인용하면 none 으로 낮춘다", () => {
    const textOnly: Evidence = { ...fx, id: "E7", tool: "get_sample_text", values: { label: "설명만" } };
    const [bad, good] = verifyWhy([why("data", ["E7"]), why("data", ["E7", "E1"])], [...ledger, textOnly]);
    expect(bad.ok).toBe(false);
    expect(bad.fix.basis).toBe("none");
    expect(good.ok).toBe(true);
  });

  it("1달러당 기준 단위와 하락 낱말로 쓴 변화량은 통과하고, 방향을 거꾸로 쓰면 걸린다 (2026-10-27 실측 문장)", () => {
    const usd: Evidence = {
      ...fx,
      values: { pair: "USD/KRW", unit: "KRW per 1 USD", rate: 1324.72, asOf: "2026-10-27", "comparison.rate": 1359.41, "comparison.asOf": "2026-09-27", change: -34.69, changePct: -2.55 },
      source: src("Frankfurter v2", "2026-10-27"),
    };
    const report: WriterOutput = {
      ...output,
      summary: "2026-10-27 기준 1달러당 1,324.72원입니다. 2026-09-27보다 34.69원(-2.55%) 낮습니다.",
      numbers: [num("USD/KRW 기준환율", "1달러당 1,324.72원", "30일 -34.69원 (-2.55%)", "E1", "2026-10-27")],
      why: [],
      impact: ["같은 1달러를 사는 데 필요한 원화가 한 달 전보다 줄었습니다."],
      caveats: [],
    };
    expect(verify(report, [usd]).failures).toEqual([]);
    const wrongWay = { ...report, summary: "2026-09-27보다 34.69원 올랐습니다." };
    expect(verify(wrongWay, [usd]).failures).toEqual([expect.stringContaining("summary 의 숫자 34.69원")]);
  });
});
