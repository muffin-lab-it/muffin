/**
 * 🔍 조사 테스트 (@Kangsohee). 실제 OpenAI · tool 을 부르지 않습니다. run 을 모킹해 "입력 → 출력 모양" 과 "실패 시 행동" 을 확인합니다.
 * 규칙을 고치면 여기에 기대값을 한 줄 더하세요. 실제 실행 결과는 `pnpm eval --set news` 로 봅니다 (리더 키).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  return { ...actual, run: vi.fn() };
});

import { RunContext, run } from "@openai/agents";
import { fxTool } from "../tools/fx";
import { muffinTools } from "../tools";
import { ResearchContext } from "./context";
import { NOTES_FALLBACK, createResearcherAgent, researchInstructions, runResearch } from "./research";

const runMock = run as unknown as ReturnType<typeof vi.fn>;
afterEach(() => runMock.mockReset());

describe("researchInstructions", () => {
  it("조사 규칙에는 tool 호출과 조사 메모가 들어가고, 리포트 작성 규칙은 들어가지 않는다", () => {
    const text = researchInstructions("etf");
    expect(text).toContain("tool 을 최소 1개 호출");
    expect(text).toContain("[조사 메모]");
    expect(text).toContain("관심 영역: ETF");
    expect(text).toContain("권유 표현"); // 공통 규칙
    expect(text).not.toContain("numbers 의 ref");
    expect(text).not.toContain("설명 깊이");
  });

  it("영역이 없으면 영역 힌트 없이 공통 규칙 + 조사 규칙만", () => {
    expect(researchInstructions()).not.toContain("[관심 영역");
  });
});

describe("createResearcherAgent", () => {
  it("기본은 레지스트리의 모든 tool, 분류가 고른 목록을 주면 그것만 쓴다", () => {
    expect(createResearcherAgent("standard").tools).toHaveLength(muffinTools.length);
    expect(createResearcherAgent("standard", "fx", [fxTool]).tools.map((t) => t.name)).toEqual(["get_fx_krw_rate"]);
    // 빈 목록은 "고른 게 없음" 이므로 전체로 돌아간다
    expect(createResearcherAgent("standard", "fx", []).tools).toHaveLength(muffinTools.length);
  });
});

describe("runResearch", () => {
  it("메모를 돌려주고, 구조화 출력이 비면 기본 메모(gaps 한 줄)로 대신한다", async () => {
    const notes = { notes: [{ ref: "E1", summary: "USD/KRW 1,392.40원 (2026-10-19)" }], gaps: [] };
    runMock.mockResolvedValueOnce({ finalOutput: notes }).mockResolvedValueOnce({ finalOutput: undefined });
    const agent = createResearcherAgent("standard", "fx");
    const ctx = new RunContext(new ResearchContext());

    expect(await runResearch(agent, "환율 왜 올랐어?", ctx)).toEqual(notes);
    expect(await runResearch(agent, "환율 왜 올랐어?", ctx)).toEqual(NOTES_FALLBACK);
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});
