/**
 * ✂️ 정제 테스트 (@o3ozzvb). 모델을 부르지 않습니다. run 을 모킹해 "입력 모양" · "계산 tool 연결" · "실패 시 행동" 을 확인합니다.
 * 고르는 기준을 고치면 editRules 의 핵심 단어를 여기 기대값에 더하세요. 실제 결과는 `pnpm eval --set etf` 로 봅니다 (리더 키).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  return { ...actual, run: vi.fn() };
});

import { RunContext, run } from "@openai/agents";
import { ResearchContext } from "./context";
import { createEditorAgent, editInput, editInstructions, runEdit } from "./edit";
import type { Evidence, FactsOutput, PlanOutput, ResearchNotes } from "./schema";

const runMock = run as unknown as ReturnType<typeof vi.fn>;
afterEach(() => runMock.mockReset());

const evidence: Evidence[] = [
  {
    id: "E1",
    tool: "get_fx_krw_rate",
    label: "환율 확인 · Frankfurter",
    values: { rate: 1392.4, "comparison.rate": 1365.1 },
    source: { name: "Frankfurter", url: "https://api.frankfurter.dev", asOf: "2026-10-19" },
    note: "주말은 직전 영업일 값",
  },
  {
    id: "E2-1",
    tool: "get_korean_economic_news",
    label: "경제 뉴스 확인 · 연합뉴스",
    values: { title: "외국인 순매도 1조 2,000억" },
    source: { name: "연합뉴스", url: "https://www.yna.co.kr/1", asOf: "2026-10-18" },
  },
];
const plan: PlanOutput = { intent: "cause", tools: ["get_fx_krw_rate", "get_korean_economic_news"], reason: "왜 를 묻는 환율 질문" };
const notes: ResearchNotes = { notes: [{ ref: "E1", summary: "달러가 30일 사이 올랐습니다." }], gaps: ["금리 tool 실패"] };

describe("editInput · editInstructions", () => {
  it("질문 · 의도 · 장부 전체(값 · note) · 조사 메모 · 확인하지 못한 것을 묶는다", () => {
    const text = editInput("환율 왜 올랐어?", plan, evidence, notes);
    expect(text).toContain("[질문]\n환율 왜 올랐어?");
    expect(text).toContain("[의도]\n원인 (cause) · 왜 를 묻는 환율 질문");
    expect(text).toContain("- E1 · 환율 확인 · Frankfurter · 기준일 2026-10-19");
    expect(text).toContain('values: {"rate":1392.4,"comparison.rate":1365.1}');
    expect(text).toContain("note: 주말은 직전 영업일 값");
    expect(text).toContain("- E2-1 · 경제 뉴스 확인 · 연합뉴스");
    expect(text).toContain("[조사 메모]\n- E1: 달러가 30일 사이 올랐습니다.");
    expect(text).toContain("- 금리 tool 실패");
  });

  it("지시문에는 고르기 · 계산 tool · 뺀 것 기록 규칙과 공통 규칙이 들어간다", () => {
    const text = editInstructions();
    expect(text).toContain("calc_metrics");
    expect(text).toContain("dropped");
    expect(text).toContain("unverified");
    expect(text).toContain("권유 표현");
    expect(text).toContain("데이터를 새로 가져오지 않습니다");
  });

  it("정제 Agent 의 tool 은 계산 하나뿐이다", () => {
    expect(createEditorAgent("standard").tools.map((t) => t.name)).toEqual(["calc_metrics"]);
  });
});

describe("runEdit", () => {
  it("사실 목록을 돌려주고, 계산 tool 이 남긴 C 번호는 같은 장부에 쌓인다", async () => {
    const facts: FactsOutput = {
      facts: [{ ref: "E1", fact: "USD/KRW 1,392.40원 (2026-10-19)" }, { ref: "C1", fact: "30일 변동률 +2.00%" }],
      dropped: [{ ref: "E2-1", reason: "순매도 규모는 장부에 숫자가 없어 확인 불가" }],
      unverified: ["기사 속 1조 2,000억 원"],
    };
    const ctx = new ResearchContext();
    ctx.addEvidence(evidence);
    runMock.mockImplementationOnce(async (...args: unknown[]) => {
      // 모델이 calc_metrics 를 불렀다고 치고 장부에 C1 을 남깁니다 (실제로는 defineTool 이 합니다)
      const runCtx = (args[2] as { context: RunContext<ResearchContext> }).context.context;
      runCtx.addEvidence([
        {
          id: runCtx.nextCalcId(),
          tool: "calc_metrics",
          label: "계산 · 30일 변동률",
          values: { changePct: 1.999853, from: 1365.1, to: 1392.4 },
          source: { name: "30일 변동률", url: "", asOf: "2026-10-19" },
          lineage: { op: "pct_change", inputs: ["E1"] },
        },
      ]);
      return { finalOutput: facts };
    });

    const out = await runEdit(createEditorAgent("standard"), "input", new RunContext(ctx));
    expect(out).toEqual(facts);
    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1", "E2-1", "C1"]);
  });

  it("출력이 없거나 실패하면 null (작성이 장부 전체를 본다)", async () => {
    runMock.mockResolvedValueOnce({ finalOutput: undefined }).mockRejectedValueOnce(new Error("timeout"));
    const ctx = () => new RunContext(new ResearchContext());
    expect(await runEdit(createEditorAgent("easy"), "input", ctx())).toBeNull();
    expect(await runEdit(createEditorAgent("easy"), "input", ctx())).toBeNull();
  });
});
