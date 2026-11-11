import { describe, expect, it } from "vitest";
import { basisFor, changeDetailFor, changeDetailsFor, isoDateOf } from "./change";
import type { Evidence } from "./schema";
import { applyVerification, verify } from "./verify";

const src = (name: string, asOf: string) => ({ name, url: `https://example.com/${name}`, asOf });

const fx: Evidence = {
  id: "E1",
  tool: "get_fx_krw_rate",
  label: "환율 확인 · Frankfurter v2",
  values: { pair: "USD/KRW", rate: 1392.4, asOf: "2026-10-19", comparisonRate: 1365.1, comparisonAsOf: "2026-09-19", change: 27.3, changePct: 2.0 },
  source: src("Frankfurter v2", "2026-10-19"),
};
const rate: Evidence = {
  id: "E2",
  tool: "get_rate_data",
  label: "금리 확인 · ECOS",
  values: { indicator: "한국은행 기준금리", rate: 3, unit: "%", asOf: "2026-10-16", comparisonDate: "2026-09-16", comparisonRate: 2.75, changePp: 0.25, changeBp: 25 },
  source: src("ECOS", "2026-10-16"),
};
const etf: Evidence = {
  id: "E3",
  tool: "get_etf_kr_price",
  label: "ETF 확인 · KRX",
  values: {
    name: "KODEX 200",
    "latest.date": "2026-10-17",
    "latest.close": 88905,
    "latest.changePct": -0.42,
    "period.from": "2026-09-17",
    "period.to": "2026-10-17",
    "period.returnPct": -3.61,
    "period.indexReturnPct": -4.37,
  },
  source: src("KRX", "2026-10-17"),
};
const cpi: Evidence = {
  id: "E4",
  tool: "get_macro_indicators",
  label: "물가 확인 · ECOS",
  values: { indicator: "소비자물가지수", "latest.month": "2026-09", "latest.value": 120.43, "latest.previousMonth.month": "2026-08", "latest.previousMonth.change": 0.316535, "latest.previousYear.change": 2.878866, changeUnit: "percent" },
  source: src("ECOS CPI", "2026-09"),
};

describe("changeDetailFor (코드가 장부에서 풀어 쓰는 변화량)", () => {
  it("환율: 맞은 키의 값 · 단위와 장부의 비교 시점 · 기준일, 일수로 비교 기준을 쓴다", () => {
    expect(changeDetailFor({ change: "30일 +2.00%" }, fx, { key: "changePct", policy: "exact" })).toEqual({
      key: "changePct",
      value: 2,
      unit: "%",
      from: "2026-09-19",
      to: "2026-10-19",
      days: 30,
      basis: "30일 전과 비교",
    });
    // 단위를 모르는 변화량(change 27.3)은 카드에 적힌 단위(원)를 쓴다
    expect(changeDetailFor({ change: "30일 +27.3원" }, fx, { key: "change", policy: "exact" })).toMatchObject({ key: "change", value: 27.3, unit: "원", days: 30 });
  });

  it("금리: %p 변화와 comparisonDate", () => {
    expect(changeDetailFor({ change: "30일 +0.25%p" }, rate, { key: "changePp", policy: "exact" })).toEqual({
      key: "changePp",
      value: 0.25,
      unit: "%p",
      from: "2026-09-16",
      to: "2026-10-16",
      days: 30,
      basis: "30일 전과 비교",
    });
    // bp 로 적은 카드는 bp 키와 맞고 단위도 bp
    expect(changeDetailFor({ change: "+25bp" }, rate, { key: "changeBp", policy: "exact" })).toMatchObject({ key: "changeBp", value: 25, unit: "bp" });
  });

  it("ETF: 같은 묶음(period.)의 날짜만 쓰고, 일별 변화(latest.changePct)는 기간 없이 직전 거래일로 적는다", () => {
    expect(changeDetailFor({ change: "30일 -3.61%" }, etf, { key: "period.returnPct", policy: "exact" })).toEqual({
      key: "period.returnPct",
      value: -3.61,
      unit: "%",
      from: "2026-09-17",
      to: "2026-10-17",
      days: 30,
      basis: "30일 전과 비교",
    });
    expect(changeDetailFor({ change: "전일 -0.42%" }, etf, { key: "latest.changePct", policy: "exact" })).toEqual({
      key: "latest.changePct",
      value: -0.42,
      unit: "%",
      to: "2026-10-17",
      basis: "직전 거래일과 비교",
    });
  });

  it("물가: 월 단위 날짜는 일수 없이 키 이름으로 전월 · 전년 비교를 적는다", () => {
    expect(changeDetailFor({ change: "전월 +0.32%" }, cpi, { key: "latest.previousMonth.change", policy: "rounded" })).toEqual({
      key: "latest.previousMonth.change",
      value: 0.316535,
      unit: "%",
      from: "2026-08",
      to: "2026-09",
      basis: "전월과 비교",
    });
    expect(changeDetailFor({ change: "전년 동월 +2.88%" }, cpi, { key: "latest.previousYear.change", policy: "rounded" })).toMatchObject({ basis: "전년 같은 달과 비교", to: "2026-09" });
  });

  it("최상위 키(changePct)의 비교 시점은 'comparison.asOf' 처럼 묶어 둔 날짜에서도 찾는다 (실제 환율 tool 의 키 모양)", () => {
    const nested: Evidence = {
      ...fx,
      values: { pair: "USD/KRW", rate: 1350.24, asOf: "2026-11-10", "comparison.rate": 1341.92, "comparison.asOf": "2026-10-11", changePct: 0.62 },
    };
    expect(changeDetailFor({ change: "30일 +0.62%" }, nested, { key: "changePct", policy: "exact" })).toEqual({
      key: "changePct",
      value: 0.62,
      unit: "%",
      from: "2026-10-11",
      to: "2026-11-10",
      days: 30,
      basis: "30일 전과 비교",
    });
  });

  it("거시지표 tool 의 YYYYMM 월도 비교 시점 · 기준일로 읽는다 (로컬 Codex 11/11)", () => {
    const compact: Evidence = {
      ...cpi,
      values: { indicator: "소비자물가지수", "latest.month": "202609", "latest.value": 120.43, "latest.previousMonth.month": "202608", "latest.previousMonth.change": 0.316535, changeUnit: "percent" },
      // 출처 기준일은 월의 첫날 표기(실제 tool)지만, 기준일은 상위 묶음의 latest.month 에서 월로 맞춘다
      source: src("ECOS CPI", "2026-09-01"),
    };
    expect(changeDetailFor({ change: "전월 +0.32%" }, compact, { key: "latest.previousMonth.change", policy: "rounded" })).toEqual({
      key: "latest.previousMonth.change",
      value: 0.316535,
      unit: "%",
      from: "2026-08",
      to: "2026-09",
      basis: "전월과 비교",
    });
    expect(isoDateOf("latest.month", "202609")).toBe("2026-09");
    expect(isoDateOf("period.from", "20260917")).toBe("2026-09-17");
    // 날짜 키가 아니면 여섯 자리 숫자를 날짜로 보지 않는다
    expect(isoDateOf("latest.volume", "202609")).toBeUndefined();
    expect(isoDateOf("latest.month", "202613")).toBeUndefined();
  });

  it("change 에 숫자가 없거나 맞은 키가 장부에 없으면 만들지 않는다", () => {
    expect(changeDetailFor({ change: "" }, fx, { key: "changePct", policy: "exact" })).toBeNull();
    expect(changeDetailFor({ change: "이번 주" }, fx, { key: "changePct", policy: "exact" })).toBeNull();
    expect(changeDetailFor({ change: "30일 +2.00%" }, fx, { key: "없는키", policy: "exact" })).toBeNull();
  });

  it("basisFor 는 키 이름을 먼저 보고, 없으면 일수를 쓴다", () => {
    expect(basisFor("yoyPct", 365)).toBe("전년 같은 달과 비교");
    expect(basisFor("momPct", 30)).toBe("전월과 비교");
    expect(basisFor("changePct", 90)).toBe("90일 전과 비교");
    expect(basisFor("changePct", undefined)).toBe("장부의 비교 시점과 비교");
  });
});

describe("changeDetailsFor (검증 결과와 같은 순서)", () => {
  it("검증이 change 를 맞춘 카드에만 붙고, 못 맞춘 카드(change 비움)와 ref 없는 카드는 빈 자리", () => {
    const output = {
      summary: "요약",
      numbers: [
        { label: "USD/KRW", value: "1,392.40원", change: "30일 +2.00%", asOf: "2026-10-19", ref: "E1" },
        { label: "한국 기준금리", value: "3.00%", change: "30일 +0.50%p", asOf: "2026-10-16", ref: "E2" },
        { label: "KODEX 200", value: "88,905원", change: "", asOf: "2026-10-17", ref: "E3" },
      ],
      why: [],
      impact: [],
      caveats: [],
      dataGaps: [],
      nextTopics: [],
    };
    const ledger = [fx, rate, etf];
    const applied = applyVerification(output, verify(output, ledger));
    expect(applied.output.numbers.map((x) => x.change)).toEqual(["30일 +2.00%", "", ""]);
    const details = changeDetailsFor(applied, ledger);
    expect(details[0]).toMatchObject({ key: "changePct", value: 2, unit: "%", days: 30 });
    expect(details[1]).toBeUndefined();
    expect(details[2]).toBeUndefined();
  });
});
