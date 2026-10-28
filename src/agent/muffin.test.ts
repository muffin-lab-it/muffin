import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  // withTrace 는 Traces 묶음용이라 테스트에서는 그냥 fn 을 실행합니다
  return { ...actual, run: vi.fn(), withTrace: (_name: unknown, fn: () => unknown) => fn() };
});

import { run, type RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import type { MuffinEvent } from "./events";
import { research } from "./muffin";
import type { FactsOutput, PlanOutput, ResearchNotes, WriterOutput } from "./schema";

const source = { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-10-19" };
const plan: PlanOutput = { intent: "cause", tools: ["get_fx_krw_rate", "get_rate_data"], reason: "왜 를 묻는 환율 질문" };
const notes: ResearchNotes = { notes: [{ ref: "E1", summary: "USD/KRW 1,392.40원 (2026-10-19). 30일 +27.3원." }], gaps: [] };
const facts: FactsOutput = {
  facts: [{ ref: "E1", fact: "USD/KRW 1,392.40원 (2026-10-19), 30일 전보다 +2.00%" }],
  dropped: [],
  unverified: [],
};
const good: WriterOutput = {
  summary: "달러가 한 달 사이 2% 올랐습니다.",
  numbers: [{ label: "USD/KRW", value: "1,392.40원", change: "30일 +27.3원 (+2.00%)", asOf: "2026-10-19", ref: "E1" }],
  why: [],
  impact: ["수입 물가가 오를 수 있습니다."],
  caveats: [],
  dataGaps: [],
  nextTopics: ["금리 차이"],
};
const bad: WriterOutput = { ...good, numbers: [{ ...good.numbers[0], value: "1,400원" }] };

type AgentLike = { name: string; tools: { name: string }[]; instructions: string; modelSettings: { timeoutMs?: number; reasoning?: { effort?: string }; retry?: { maxRetries?: number } } };
type RunArgs = [AgentLike, string, { context: RunContext<ResearchContext> }];
const runMock = run as unknown as ReturnType<typeof vi.fn>;

type Scenario = {
  /** 분류 출력. null 이면 출력 없음(기본 계획으로 대체), Error 면 throw */
  plan?: PlanOutput | null | Error;
  /** 조사 메모. null 이면 출력 없음 */
  notes?: ResearchNotes | null;
  /** 정제 출력. null 이면 실패(작성이 장부 전체를 봄) */
  facts?: FactsOutput | null;
  /** 작성 출력을 순서대로 */
  writer: WriterOutput[];
};

/** 네 Agent 를 이름으로 구분해 흉내 냅니다. 조사는 장부에 E1 을 남기고, 정제는 장부에 C1 을 남깁니다. */
function mockRuns(s: Scenario) {
  const outputs = [...s.writer];
  runMock.mockImplementation(async (...args: unknown[]) => {
    const [agent, , opts] = args as RunArgs;
    const ctx = opts.context.context;
    switch (agent.name) {
      case "Muffin Planner":
        if (s.plan instanceof Error) throw s.plan;
        return { finalOutput: s.plan === undefined ? plan : (s.plan ?? undefined) };
      case "Muffin Researcher":
        ctx.addEvidence([
          { id: ctx.nextCallId(), tool: "get_fx_krw_rate", label: "환율 확인 · Frankfurter v2", values: { rate: 1392.4, change: 27.3, changePct: 2 }, source },
        ]);
        ctx.addStep({ tool: "get_fx_krw_rate", status: "ok", ms: 5 });
        return { finalOutput: s.notes === undefined ? notes : (s.notes ?? undefined) };
      case "Muffin Editor":
        if (s.facts === null) return { finalOutput: undefined };
        ctx.addEvidence([
          {
            id: ctx.nextCalcId(),
            tool: "calc_metrics",
            label: "계산 · 30일 변동폭",
            values: { change: 27.3, from: 1365.1, to: 1392.4 },
            source: { name: "30일 변동폭", url: "", asOf: "2026-10-19" },
            lineage: { op: "diff", inputs: ["E1"] },
          },
        ]);
        ctx.addStep({ tool: "calc_metrics", status: "ok", ms: 1 });
        return { finalOutput: s.facts ?? facts };
      default:
        return { finalOutput: outputs.shift() };
    }
  });
}

const call = (i: number) => runMock.mock.calls[i] as unknown as RunArgs;
const agentOf = (i: number) => call(i)[0];
const inputOf = (i: number) => call(i)[1];
const traceOf = (events: MuffinEvent[]) => events.map((e) => (e.type === "stage" ? `${e.stage}:${e.status}` : e.type));

afterEach(() => runMock.mockReset());

describe("research() 다섯 단계", () => {
  it("분류 → 조사 → 정제 → 작성 → 검증 순서로 이벤트를 보내고, 검증을 통과하면 수정 없이 끝난다", async () => {
    mockRuns({ writer: [good] });
    const events: MuffinEvent[] = [];
    const result = await research({ question: "환율 왜 올랐어?", depth: "standard", area: "fx" }, { onEvent: (e) => events.push(e) });

    expect(traceOf(events)).toEqual([
      "plan:start", "plan", "plan:done",
      "research:start", "step", "research:done",
      "edit:start", "step", "edit:done",
      "write:start", "write:done",
      "verify:start", "verify", "verify:done",
    ]);
    expect(runMock).toHaveBeenCalledTimes(4);
    expect(runMock.mock.calls.map((c) => (c as unknown as RunArgs)[0].name)).toEqual(["Muffin Planner", "Muffin Researcher", "Muffin Editor", "Muffin Writer"]);
    // 조사는 분류가 고른 tool 만 받는다
    expect(agentOf(1).tools.map((t) => t.name)).toEqual(["get_fx_krw_rate", "get_rate_data"]);
    // 정제는 장부 전체를, 작성은 사실 목록과 인용된 항목만 본다
    expect(inputOf(2)).toContain("[증거 장부]");
    expect(inputOf(2)).toContain("[의도]\n원인 (cause)");
    expect(inputOf(3)).toContain("[사실 목록]");
    expect(inputOf(3)).toContain("- E1: USD/KRW 1,392.40원");
    expect(inputOf(3)).not.toContain("[조사 메모]");
    expect(events.find((e) => e.type === "plan")).toEqual({ type: "plan", intent: "cause", mode: "research", tools: ["get_fx_krw_rate", "get_rate_data"] });
    expect(result.plan).toMatchObject({ intent: "cause", mode: "research" });
    expect(result.facts).toEqual(facts);
    expect(result.rewrites).toBe(0);
    expect(result.report.mode).toBe("research");
    expect(result.report.notice).toBeUndefined();
    expect(result.report.numbers).toEqual([{ ...good.numbers[0], check: "verified" }]);
    expect(result.report.verification).toMatchObject({ status: "pass", numbers: { total: 1, verified: 1 }, revisions: 0, removed: [] });
    // 계산 결과는 장부에 남지만 url 이 없어 출처에는 들어가지 않는다
    expect(result.report.evidence.map((e) => e.id)).toEqual(["E1", "C1"]);
    expect(result.report.sources).toEqual([{ id: "E1", ...source }]);
    expect(result.steps.map((s) => s.tool)).toEqual(["get_fx_krw_rate", "calc_metrics"]);
    expect(result.model).toMatch(/^gpt-6/);
    // 단계 파일의 Agent 에 리더 쪽 호출 설정(시간 제한 · 시간 초과 재시도 · 조사 추론 강도)이 씌워진다
    expect(agentOf(0).modelSettings).toMatchObject({ timeoutMs: 15_000, retry: { maxRetries: 1 } });
    expect(agentOf(1).modelSettings).toMatchObject({ timeoutMs: 15_000, reasoning: { effort: "low" } });
    expect(agentOf(2).modelSettings).toMatchObject({ timeoutMs: 15_000 });
    expect(agentOf(3).modelSettings).toMatchObject({ timeoutMs: 30_000 });
  });

  it("숫자가 장부와 다르면 작성에게 1회 수정 요청하고, 고쳐 오면 pass", async () => {
    mockRuns({ writer: [bad, good] });
    const result = await research({ question: "환율 왜 올랐어?", depth: "easy" });

    expect(runMock).toHaveBeenCalledTimes(5);
    expect(agentOf(4).name).toBe("Muffin Writer");
    expect(inputOf(4)).toContain("[수정 요청]");
    expect(inputOf(4)).toContain("1,400");
    expect(result.rewrites).toBe(1);
    expect(result.report.verification).toMatchObject({ status: "pass", revisions: 1, removed: [] });
    expect(result.report.numbers[0].check).toBe("verified");
  });

  it("마감이 가까우면 다시 쓰지 않고 검증에 걸린 숫자를 바로 뺀다 (시간 초과로 리포트가 안 나가는 것보다 낫다)", async () => {
    mockRuns({ writer: [bad, good] });
    // 남은 시간이 다시 쓰기에 필요한 15초보다 적다
    const result = await research({ question: "환율 왜 올랐어?", depth: "standard" }, { deadline: Date.now() + 5_000 });

    expect(runMock).toHaveBeenCalledTimes(4);
    expect(result.rewrites).toBe(0);
    expect(result.report.numbers).toEqual([]);
    expect(result.report.verification).toMatchObject({ status: "partial", revisions: 0, revisionSkipped: true });
    expect(result.report.verification.removed[0]).toContain("1,400");
  });

  it("시간이 넉넉하면 다시 쓰기를 건너뛰지 않는다 (기본 예산 55초)", async () => {
    mockRuns({ writer: [bad, good] });
    const result = await research({ question: "환율 왜 올랐어?", depth: "standard" });

    expect(result.rewrites).toBe(1);
    expect(result.report.verification).not.toHaveProperty("revisionSkipped");
  });

  it("수정 뒤에도 틀리면 그 숫자를 빼고 dataGaps 와 removed 에 기록한다 (fail-closed). 조사 · 정제는 다시 돌지 않는다", async () => {
    mockRuns({ writer: [bad, bad] });
    const result = await research({ question: "환율 왜 올랐어?", depth: "standard" });

    expect(runMock).toHaveBeenCalledTimes(5);
    expect(result.report.numbers).toEqual([]);
    expect(result.report.verification.status).toBe("partial");
    expect(result.report.verification.removed[0]).toContain("1,400");
    expect(result.report.dataGaps).toContain("검증을 통과하지 못해 뺀 숫자 1개 (출처 값과 맞지 않았습니다)");
    // 수정 요청은 tool 을 다시 부르지 않으므로 증거 번호와 실행 기록이 그대로다
    expect(result.report.evidence.map((e) => e.id)).toEqual(["E1", "C1"]);
    expect(result.steps).toHaveLength(2);
  });

  it("정제가 실패하면 작성은 장부 전체와 조사 메모를 본다 (1단계 입력)", async () => {
    mockRuns({ facts: null, writer: [good] });
    const result = await research({ question: "환율 왜 올랐어?", depth: "standard" });

    expect(inputOf(3)).not.toContain("[사실 목록]");
    expect(inputOf(3)).toContain("[조사 메모]");
    expect(inputOf(3)).toContain("- E1 · 환율 확인 · Frankfurter v2");
    expect(result.facts).toBeNull();
    expect(result.report.verification.status).toBe("pass");
  });

  it("조사 Agent 가 메모를 남기지 못해도 장부만으로 이어간다", async () => {
    mockRuns({ notes: null, facts: null, writer: [good] });
    await research({ question: "환율 왜 올랐어?", depth: "standard" });
    expect(inputOf(2)).toContain("조사 Agent 가 조사 메모를 남기지 못했습니다");
    expect(inputOf(3)).toContain("조사 Agent 가 조사 메모를 남기지 못했습니다");
  });

  it("분류가 실패하면 기본 계획(관심 영역 tool + 뉴스)으로 조사한다", async () => {
    mockRuns({ plan: new Error("rate limit"), writer: [good] });
    const events: MuffinEvent[] = [];
    const result = await research({ question: "환율 왜 올랐어?", depth: "standard", area: "fx" }, { onEvent: (e) => events.push(e) });

    expect(events.find((e) => e.type === "plan")).toMatchObject({ intent: "cause", mode: "research", tools: ["get_fx_krw_rate", "get_korean_economic_news"] });
    expect(agentOf(1).tools.map((t) => t.name)).toEqual(["get_fx_krw_rate", "get_korean_economic_news"]);
    expect(result.plan.reason).toContain("기본 규칙");
    expect(result.plan.reason).toContain("rate limit");
  });

  it("범위 밖이면 조사 · 정제 · 작성을 건너뛰고 고정 안내 리포트를 낸다", async () => {
    mockRuns({ plan: { intent: "out_of_scope", tools: [], reason: "코인 시세는 범위 밖" }, writer: [] });
    const events: MuffinEvent[] = [];
    const result = await research({ question: "비트코인 지금 얼마야?", depth: "standard" }, { onEvent: (e) => events.push(e) });

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(traceOf(events)).toEqual(["plan:start", "plan", "plan:done", "verify:start", "verify", "verify:done"]);
    expect(result.plan).toMatchObject({ intent: "out_of_scope", mode: "out_of_scope", tools: [] });
    expect(result.report.mode).toBe("out_of_scope");
    expect(result.report.notice).toContain("범위");
    expect(result.report.numbers).toEqual([]);
    expect(result.report.dataGaps[0]).toContain("비트코인 지금 얼마야?");
    expect(result.report.verification).toMatchObject({ status: "pass", numbers: { total: 0 }, advice: 0 });
    expect(result.report.evidence).toEqual([]);
    expect(result.steps).toEqual([]);
  });

  it("판단 요청이면 작성에 모드 규칙이 붙고 리포트에 안내가 달린다", async () => {
    mockRuns({ plan: { intent: "decision", tools: ["get_etf_kr_price"], reason: "사도 돼" }, writer: [good] });
    const events: MuffinEvent[] = [];
    const result = await research({ question: "KODEX 200 지금 사도 돼?", depth: "standard", area: "etf" }, { onEvent: (e) => events.push(e) });

    expect(events.find((e) => e.type === "plan")).toMatchObject({ intent: "decision", mode: "decision_facts" });
    expect(agentOf(3).instructions).toContain("[모드: 판단 요청]");
    expect(result.report.mode).toBe("decision_facts");
    expect(result.report.notice).toContain("판단");
  });

  it("분류가 레지스트리에 없는 tool 을 고르면 버리고, 남는 게 없으면 기본 계획의 tool 로 조사한다", async () => {
    mockRuns({ plan: { intent: "status", tools: ["made_up_tool"], reason: "r" }, writer: [good] });
    await research({ question: "오늘 달러 얼마야?", depth: "standard", area: "fx" });
    expect(agentOf(1).tools.map((t) => t.name)).toEqual(["get_fx_krw_rate"]);
  });
});
