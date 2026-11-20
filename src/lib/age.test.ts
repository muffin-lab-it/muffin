import { describe, expect, it } from "vitest";
import { formatWait } from "./age";

describe("formatWait (다시 시도까지 남은 시간)", () => {
  it.each([
    [0, "1초"],
    [5, "5초"],
    [59, "59초"],
    [60, "1분"],
    [61, "2분"],
    [600, "10분"],
    [3_599, "60분"],
    [3_600, "1시간"],
    [3_601, "2시간"],
    [86_400, "24시간"],
  ])("%s초 → %s (남은 시간보다 짧게 보이지 않게 올림)", (seconds, label) => {
    expect(formatWait(seconds)).toBe(label);
  });
});
