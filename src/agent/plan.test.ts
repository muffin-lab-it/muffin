/**
 * 📋 분류 테스트 (@seoyoung23). 모델을 부르지 않습니다. run 을 모킹해 "입력 모양" · "기본 규칙" · "실패 시 행동" 을 확인합니다.
 * 분류 기준을 고치면 그 기준의 예시 질문을 defaultPlan 테스트나 질문 세트(scripts/questions/fx.json 의 intent)에 더하세요.
 * 실제 분류 정확도는 `pnpm eval --set fx` 의 "의도" 열로 봅니다 (리더 키).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  return { ...actual, run: vi.fn() };
});

import { RunContext, run } from "@openai/agents";
import { muffinTools } from "../tools";
import { ResearchContext } from "./context";
import { DECISION_PATTERN, areaTools, createPlannerAgent, defaultPlan, normalizePlan, planInput, planInstructions, planRules, runPlan } from "./plan";
import { areas } from "./schema";

const runMock = run as unknown as ReturnType<typeof vi.fn>;
afterEach(() => runMock.mockReset());

describe("planInput · planInstructions", () => {
  it("질문 · 관심 영역 · 깊이 · tool 목록(이름과 설명)을 한 입력으로 묶는다", () => {
    const text = planInput("환율 왜 올랐어?", "fx", "easy");
    expect(text).toContain("[질문]\n환율 왜 올랐어?");
    expect(text).toContain("[관심 영역]\n환율 (fx)");
    expect(text).toContain("[설명 깊이]\neasy");
    for (const t of muffinTools) expect(text).toContain(`- ${t.name}: `);
    expect(planInput("q", undefined, "standard")).toContain("(지정 없음)");
  });

  it("지시문에는 다섯 의도와 공통 규칙이 들어가고, tool 을 부르지 않는다고 적혀 있다", () => {
    const text = planInstructions();
    for (const intent of ["status", "cause", "compare", "decision", "out_of_scope"]) expect(text).toContain(intent);
    expect(text).toContain("tool 을 직접 부르지 않습니다");
    expect(text).toContain("권유 표현");
  });

  it("대표 질문을 의도별로 구분하고 선택 기준을 명시한다", () => {
    expect(planRules).toContain('"달러 지금 사도 돼?"');
    expect(planRules).toContain('"원달러 환율이 왜 올랐어?"');
    expect(planRules).toContain('"한국과 미국 금리 차이는?"');
    expect(planRules).toContain('"오늘 원달러 환율 얼마야?"');
    expect(planRules).toContain('"비트코인 왜 떨어졌어?"');
    expect(planRules).toContain('"TIGER 미국S&P500 수익률이 S&P500 지수랑 왜 차이 나?"');
    expect(planRules).toContain("범위 밖이면 질문에 '왜', '비교', '사도 돼'가 있어도 반드시 out_of_scope");
    expect(planRules).toContain("원인·비교보다 우선합니다");
    expect(planRules).toContain("모든 tool 을 무조건 선택하지 않습니다");
    expect(planRules).toContain("out_of_scope 는 항상 tools: []");
  });

  it("영역별 tool 이름은 레지스트리에 있다", () => {
    const names = new Set(muffinTools.map((t) => t.name));
    for (const a of areas) expect(names.has(areaTools[a])).toBe(true);
    expect(createPlannerAgent("deep").tools).toHaveLength(0);
  });
});

describe("defaultPlan (모델 없는 기본 규칙)", () => {
  it("왜 → cause, 사도 돼 → decision, 비교 → compare, 그 외 status", () => {
    expect(defaultPlan("환율 왜 올랐어?", "fx").intent).toBe("cause");
    expect(defaultPlan("KODEX 200 지금 사도 돼?", "etf").intent).toBe("decision");
    expect(defaultPlan("한국이랑 미국 금리 차이 얼마나 나?", "rate").intent).toBe("compare");
    expect(defaultPlan("오늘 달러 얼마야?", "fx").intent).toBe("status");
    expect(DECISION_PATTERN.test("달러 지금 사도 돼?")).toBe(true);
  });

  it("명확한 범위 밖 대상은 질문 형식보다 먼저 처리한다", () => {
    expect(defaultPlan("비트코인 왜 떨어졌어?")).toMatchObject({ intent: "out_of_scope", tools: [] });
    expect(defaultPlan("비트코인 지금 사도 돼?")).toMatchObject({ intent: "out_of_scope", tools: [] });
  });

  it("지원 범위 안에서는 판단 요청이 원인보다 우선하고, 왜는 비교 표현보다 우선한다", () => {
    expect(defaultPlan("환율이 왜 올랐는데 지금 달러 사도 돼?", "fx")).toMatchObject({
      intent: "decision",
      tools: ["get_fx_krw_rate", "get_korean_economic_news"],
    });
    expect(defaultPlan("환율 왜 올랐어?", "fx").tools).toEqual(["get_fx_krw_rate", "get_korean_economic_news"]);
    expect(defaultPlan("TIGER 미국S&P500 수익률이 S&P500 지수랑 왜 차이 나?", "etf").intent).toBe("cause");
  });

  it("관심 영역의 tool 을 먼저, 영역이 없으면 전체", () => {
    expect(defaultPlan("오늘 달러 얼마야?", "fx").tools).toEqual(["get_fx_krw_rate"]);
    expect(defaultPlan("요즘 경제 어때?").tools).toEqual(muffinTools.map((t) => t.name));
    expect(defaultPlan("비트코인 지금 얼마야?").intent).toBe("out_of_scope");
  });
});

describe("normalizePlan", () => {
  it("레지스트리에 없는 이름은 버리고, 남는 게 없으면 기본 계획의 tool 로 채운다", () => {
    const out = normalizePlan({ intent: "cause", tools: ["get_fx_krw_rate", "made_up_tool", "get_fx_krw_rate"], reason: "r" }, "환율 왜?", "fx");
    expect(out.tools).toEqual(["get_fx_krw_rate"]);
    expect(normalizePlan({ intent: "status", tools: ["nope"], reason: "r" }, "오늘 달러?", "fx").tools).toEqual(["get_fx_krw_rate"]);
    expect(normalizePlan({ intent: "out_of_scope", tools: ["get_fx_krw_rate"], reason: "r" }, "날씨?", undefined).tools).toEqual([]);
  });
});

describe("runPlan", () => {
  const ctx = () => new RunContext(new ResearchContext());
  const fallback = defaultPlan("환율 왜 올랐어?", "fx");

  it("모델 출력을 돌려준다", async () => {
    runMock.mockResolvedValueOnce({ finalOutput: { intent: "cause", tools: ["get_fx_krw_rate", "get_rate_data"], reason: "왜" } });
    expect(await runPlan(createPlannerAgent("standard"), "input", ctx(), fallback)).toMatchObject({ intent: "cause", tools: ["get_fx_krw_rate", "get_rate_data"] });
  });

  it("출력이 없거나 실패하면 기본 계획으로 대신하고 이유를 남긴다", async () => {
    runMock.mockResolvedValueOnce({ finalOutput: undefined }).mockRejectedValueOnce(new Error("rate limit"));
    const a = await runPlan(createPlannerAgent("standard"), "input", ctx(), fallback);
    const b = await runPlan(createPlannerAgent("standard"), "input", ctx(), fallback);
    expect(a).toMatchObject({ intent: "cause", tools: fallback.tools });
    expect(a.reason).toContain("출력을 내지 못함");
    expect(b.reason).toContain("rate limit");
  });
});
