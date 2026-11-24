import { describe, expect, it } from "vitest";
import { todayKst, todayLine } from "./today";

describe("오늘 날짜 (11/24)", () => {
  it("한국 시간으로 날짜를 정한다 (UTC 15시 = 한국 다음 날 0시)", () => {
    expect(todayKst(new Date("2026-11-23T14:59:00Z"))).toBe("2026-11-23");
    expect(todayKst(new Date("2026-11-23T15:00:00Z"))).toBe("2026-11-24");
  });

  it("조사 · 작성 입력 줄에 날짜와 기준을 적는다", () => {
    const line = todayLine(new Date("2026-11-24T01:00:00Z"));
    expect(line).toMatch(/^\[오늘\] 2026-11-24 \(한국 시간\)/);
    expect(line).toContain("오늘 날짜를 알 수 없다는 말은 쓰지 않습니다");
  });
});
