import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  return { ...actual, run: vi.fn() };
});

import { run, type RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import type { MuffinEvent } from "./events";
import { research } from "./muffin";
import type { ResearchNotes, WriterOutput } from "./schema";

const source = { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-10-19" };
const notes: ResearchNotes = { notes: [{ ref: "E1", summary: "USD/KRW 1,392.40원 (2026-10-19). 30일 +27.3원." }], gaps: [] };
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

type RunArgs = [{ name: string }, string, { context: RunContext<ResearchContext> }];
const runMock = run as unknown as ReturnType<typeof vi.fn>;

/** 조사 Agent 는 장부에 E1 을 남기고 메모를 돌려주고, 작성 Agent 는 주어진 출력을 순서대로 돌려줍니다. */
function mockRuns(writerOutputs: WriterOutput[], researcherNotes: ResearchNotes | null = notes) {
  const outputs = [...writerOutputs];
  runMock.mockImplementation(async (...args: unknown[]) => {
    const [agent, , opts] = args as RunArgs;
    if (agent.name === "Muffin Researcher") {
      const ctx = opts.context.context;
      ctx.addEvidence([
        { id: ctx.nextCallId(), tool: "get_fx_krw_rate", label: "환율 확인 · Frankfurter v2", values: { rate: 1392.4, change: 27.3, changePct: 2 }, source },
      ]);
      ctx.addStep({ tool: "get_fx_krw_rate", status: "ok", ms: 5 });
      // null 이면 구조화 출력 실패 (finalOutput 없음) 를 흉내 냅니다
      return { finalOutput: researcherNotes ?? undefined };
    }
    return { finalOutput: outputs.shift() };
  });
}

const inputOf = (call: number) => (runMock.mock.calls[call] as unknown as RunArgs)[1];

afterEach(() => runMock.mockReset());

describe("research() 1단계 흐름", () => {
  it("조사 → 작성 → 검증 순서로 이벤트를 보내고, 검증을 통과하면 수정 없이 끝난다", async () => {
    mockRuns([good]);
    const events: string[] = [];
    const onEvent = (e: MuffinEvent) => events.push(e.type === "stage" ? `${e.stage}:${e.status}` : e.type);

    const result = await research({ question: "환율 왜 올랐어?", depth: "standard", area: "fx" }, { onEvent });

    expect(events).toEqual(["research:start", "step", "research:done", "write:start", "write:done", "verify:start", "verify", "verify:done"]);
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(inputOf(1)).toContain("[증거 장부]");
    expect(inputOf(1)).toContain("- E1 · 환율 확인 · Frankfurter v2");
    expect(result.rewrites).toBe(0);
    expect(result.report.numbers).toEqual([{ ...good.numbers[0], check: "verified" }]);
    expect(result.report.verification).toMatchObject({ status: "pass", numbers: { total: 1, verified: 1 }, revisions: 0, removed: [] });
    expect(result.report.sources).toEqual([{ id: "E1", ...source }]);
    expect(result.steps).toHaveLength(1);
    expect(result.model).toMatch(/^gpt-6/);
  });

  it("숫자가 장부와 다르면 작성에게 1회 수정 요청하고, 고쳐 오면 pass", async () => {
    mockRuns([bad, good]);
    const result = await research({ question: "환율 왜 올랐어?", depth: "easy" });

    expect(runMock).toHaveBeenCalledTimes(3);
    expect(inputOf(2)).toContain("[수정 요청]");
    expect(inputOf(2)).toContain("1,400");
    expect(result.rewrites).toBe(1);
    expect(result.report.verification).toMatchObject({ status: "pass", revisions: 1, removed: [] });
    expect(result.report.numbers[0].check).toBe("verified");
  });

  it("수정 뒤에도 틀리면 그 숫자를 빼고 dataGaps 와 removed 에 기록한다 (fail-closed)", async () => {
    mockRuns([bad, bad]);
    const result = await research({ question: "환율 왜 올랐어?", depth: "standard" });

    expect(runMock).toHaveBeenCalledTimes(3);
    expect(result.report.numbers).toEqual([]);
    expect(result.report.verification.status).toBe("partial");
    expect(result.report.verification.removed[0]).toContain("1,400");
    expect(result.report.dataGaps).toContain("검증을 통과하지 못해 뺀 숫자 1개 (출처 값과 맞지 않았습니다)");
    // 수정 요청은 tool 을 다시 부르지 않으므로 증거 번호와 실행 기록이 그대로다
    expect(result.report.evidence.map((e) => e.id)).toEqual(["E1"]);
    expect(result.steps).toHaveLength(1);
  });

  it("조사 Agent 가 메모를 남기지 못해도 장부만으로 작성한다", async () => {
    mockRuns([good], null);
    await research({ question: "환율 왜 올랐어?", depth: "standard" });
    expect(inputOf(1)).toContain("조사 Agent 가 조사 메모를 남기지 못했습니다");
  });
});
