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
