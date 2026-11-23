import { describe, expect, it } from "vitest";
import { activeQuickKey } from "./ReportQuickMenu";

describe("리포트 목차 퀵메뉴의 지금 읽는 영역 (11/23)", () => {
  const keys = ["summary", "numbers", "story", "sources"];
  it("화면 위쪽 35% 안으로 들어온 마지막 영역을 고른다", () => {
    expect(activeQuickKey(keys, [100, 600, 1400, 2400], 900, false)).toBe("summary");
    expect(activeQuickKey(keys, [-800, 200, 700, 1700], 900, false)).toBe("numbers");
    expect(activeQuickKey(keys, [-2000, -1200, 100, 900], 900, false)).toBe("story");
  });
  it("없는 영역은 건너뛰고, 맨 아래에 닿으면 마지막 영역", () => {
    expect(activeQuickKey(keys, [-900, null, 200, 1200], 900, false)).toBe("story");
    expect(activeQuickKey(keys, [-3000, -2000, -1000, 600], 900, true)).toBe("sources");
    expect(activeQuickKey(keys, [null, null, null, null], 900, false)).toBe("");
  });
});
