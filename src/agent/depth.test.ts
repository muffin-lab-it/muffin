/**
 * ✍️ 깊이별 금융 규칙 테스트 (@kani-market). 지시문은 문자열이라 "들어가야 할 말이 들어갔는지" 를 확인합니다.
 * 규칙을 더하면 그 규칙의 핵심 단어를 여기에 한 줄 더하세요. 실제 리포트 차이는 `pnpm eval --set common --depth all` 로 봅니다.
 */
import { describe, expect, it } from "vitest";
import { byDepth, depthInstructions, financeRules, modeRules } from "./depth";
import { depths } from "./schema";

describe("byDepth", () => {
  it("세 깊이 모두 규칙이 있고 서로 다르다", () => {
    for (const d of depths) expect(byDepth[d]).toContain("[설명 깊이");
    expect(new Set(depths.map((d) => byDepth[d])).size).toBe(3);
  });

  it("Easy 는 전문용어 금지와 비유 허용, Deep Dive 는 기간 비교와 상충 요인", () => {
    expect(byDepth.easy).toContain("전문용어는 쓰지 않습니다");
    expect(byDepth.easy).toContain("비유");
    expect(byDepth.deep).toContain("기간 비교");
    expect(byDepth.deep).toContain("상충");
  });
});

describe("depthInstructions", () => {
  it("깊이 규칙 하나만 들어가고, 비어 있는 금융 규칙은 빠진다", () => {
    const easy = depthInstructions("easy");
    expect(easy).toContain("Easy");
    expect(easy).not.toContain("Deep Dive");
    if (!financeRules) expect(easy).not.toContain("\n\n\n");
  });

  it("판단 요청 모드면 판단을 대신하지 않는다는 규칙이 붙는다", () => {
    expect(depthInstructions("standard", "decision_facts")).toContain("[모드: 판단 요청]");
    expect(depthInstructions("standard", "research")).not.toContain("[모드: 판단 요청]");
    expect(modeRules.decision_facts).toContain("판단을 대신하지 않습니다");
  });
});
