import { describe, expect, it } from "vitest";
import { reportChange } from "./reportChange";

describe("변화량 읽기", () => {
  it("기간과 단위를 보존하고 0은 상승으로 분류하지 않는다", () => {
    expect(reportChange("30일 +0.00%p")).toEqual({ text: "30일 전과 같아요", direction: "flat" });
    expect(reportChange("30일 -0.25%p")).toEqual({ text: "30일 전보다 0.25%p 하락", direction: "down" });
    expect(reportChange("30일 +2.00%")).toEqual({ text: "30일 전보다 2% 상승", direction: "up" });
  });
  it("날짜나 알 수 없는 비교 기간을 추측하지 않는다", () => {
    expect(reportChange("이번 주")).toEqual({ text: "이번 주", direction: "flat" });
    expect(reportChange("2026-10-19").direction).toBe("flat");
  });
});

it("구조화된 장부 변화량을 문자열보다 우선하며 단위와 비교 기준을 유지한다", () => {
  expect(reportChange("잘못된 30일 +5%", { key: "changePp", value: -0.25, unit: "%p", basis: "전월과 비교", from: "2026-09", to: "2026-10" })).toEqual({ text: "전월과 비교해 0.25%p 하락", direction: "down" });
  expect(reportChange("+9%", { key: "change", value: 0, unit: "bp", basis: "직전 거래일과 비교" })).toEqual({ text: "직전 거래일과 비교해 변화가 없어요", direction: "flat" });
});

describe("1년 비교 (11/22)", () => {
  it("365일 전은 '1년 전과 비교' 로 쓴다", () => {
    expect(reportChange("1년 +0.50%p", { key: "changePp", value: 0.5, unit: "%p", basis: "", days: 365 }).text).toBe("1년 전과 비교해 0.5%p 상승");
    expect(reportChange("30일 +2%", { key: "changePct", value: 2, unit: "%", basis: "", days: 30 }).text).toBe("30일 전과 비교해 2% 상승");
  });
});
