import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MuffinEvent } from "./events";
import { isMockMode, mockResearch } from "./mock";
import { reportSchema } from "./schema";

function trace(events: MuffinEvent[]): string[] {
  return events.map((e) => (e.type === "stage" ? `${e.stage}:${e.status}` : e.type));
}

describe("mockResearch", () => {
  beforeEach(() => {
    process.env.MUFFIN_MOCK_DELAY_MS = "0";
  });
  afterEach(() => {
    delete process.env.MUFFIN_MOCK_DELAY_MS;
    delete process.env.MUFFIN_MOCK;
  });

  it("단계 순서대로 이벤트를 보내고 v2 리포트를 돌려준다", async () => {
    const events: MuffinEvent[] = [];
    const r = await mockResearch({ question: "환율 왜 올랐어?", depth: "easy" }, { onEvent: (e) => events.push(e) });

    const dataSteps = r.steps.filter((s) => s.tool !== "calc_metrics");
    const calcSteps = r.steps.filter((s) => s.tool === "calc_metrics");
    expect(calcSteps.length).toBeGreaterThan(0);
    expect(trace(events)).toEqual([
      "plan:start",
      "plan",
      "plan:done",
      "research:start",
      ...dataSteps.map(() => "step"),
      "research:done",
      "edit:start",
      ...calcSteps.map(() => "step"),
      "edit:done",
      "write:start",
      "write:done",
      "verify:start",
      "verify",
      "verify:done",
    ]);
    expect(reportSchema.parse(r.report)).toEqual(r.report);
    expect(r.report.summary).toMatch(/^\[MOCK · easy\]/);
    expect(r.report.mode).toBe("research");
    expect(r.report.notice).toBeUndefined();
    expect(r.model).toBe("mock");
    // step 이벤트는 돌려준 steps 와 같은 순서 (데이터 tool 은 research, 계산은 edit 단계)
    const stepEvents = events.filter((e) => e.type === "step").map((e) => e.step);
    expect(stepEvents).toEqual(r.steps);
    // plan 은 부를 데이터 tool 목록을 담는다 (계산 tool 은 정제의 것이라 들어가지 않음)
    const plan = events.find((e) => e.type === "plan");
    expect(plan).toMatchObject({ intent: "cause", mode: "research" });
    expect(plan && "tools" in plan ? plan.tools : []).toContain("get_fx_krw_rate");
    expect(plan && "tools" in plan ? plan.tools : []).not.toContain("calc_metrics");
    expect(r.plan).toMatchObject({ intent: "cause", mode: "research" });
  });

  it("'사도 돼?' 류 질문이면 판단 요청 모드와 안내를 붙인다", async () => {
    const events: MuffinEvent[] = [];
    const r = await mockResearch({ question: "달러 지금 사도 돼?", depth: "standard", area: "fx" }, { onEvent: (e) => events.push(e) });
    expect(r.report.mode).toBe("decision_facts");
    expect(r.report.notice).toContain("판단");
    expect(events.find((e) => e.type === "plan")).toMatchObject({ intent: "decision", mode: "decision_facts" });
    expect(reportSchema.parse(r.report)).toEqual(r.report);
  });

  it("onEvent 없이도 동작한다", async () => {
    const r = await mockResearch({ question: "금리 어때?", depth: "deep" });
    expect(r.report.version).toBe(2);
  });

  it("isMockMode 는 MUFFIN_MOCK=1 일 때만 켜진다", () => {
    expect(isMockMode()).toBe(false);
    process.env.MUFFIN_MOCK = "1";
    expect(isMockMode()).toBe(true);
  });
});
