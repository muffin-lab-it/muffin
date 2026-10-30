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
import { cleanFacts, createEditorAgent, editInput, editInstructions, runEdit } from "./edit";
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

  it("모델 출력은 장부와 맞춰 정리해서 돌려준다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence(evidence);
    runMock.mockResolvedValueOnce({
      finalOutput: {
        facts: [{ ref: "E1", fact: "USD/KRW 1,392.40원 (2026-10-19)" }, { ref: "E9", fact: "지어낸 번호" }],
        dropped: [{ ref: "E1", reason: "핵심 항목만 남김" }],
        unverified: [],
      } satisfies FactsOutput,
    });

    const out = await runEdit(createEditorAgent("standard"), "input", new RunContext(ctx));
    expect(out).toEqual({
      facts: [{ ref: "E1", fact: "USD/KRW 1,392.40원 (2026-10-19)" }],
      dropped: [{ ref: "E9", reason: "장부에 없는 번호라 사실에서 뺌" }],
      unverified: [],
    });
  });

  it("출력이 없거나 실패하면 null (작성이 장부 전체를 본다)", async () => {
    runMock.mockResolvedValueOnce({ finalOutput: undefined }).mockRejectedValueOnce(new Error("timeout"));
    const ctx = () => new RunContext(new ResearchContext());
    expect(await runEdit(createEditorAgent("easy"), "input", ctx())).toBeNull();
    expect(await runEdit(createEditorAgent("easy"), "input", ctx())).toBeNull();
  });
});

describe("cleanFacts", () => {
  const ids = new Set(["E1", "E2-1", "E2-2", "C1"]);

  it("facts 에 쓴 항목은 dropped 에서 지운다 (같은 항목을 쓰고 동시에 빼는 모순)", () => {
    const out = cleanFacts(
      {
        facts: [{ ref: "E1", fact: "종가 88,905원 (2026-10-27)" }],
        dropped: [
          { ref: "E1", reason: "질문과 직접 관련된 핵심 항목만 남겼습니다" },
          { ref: "E2-1", reason: "다른 상품 기사" },
        ],
        unverified: [],
      },
      ids,
    );
    expect(out.dropped).toEqual([{ ref: "E2-1", reason: "다른 상품 기사" }]);
  });

  it("장부에 없는 ref 의 사실은 빼고 dropped 에 이유를 남긴다 (뉴스 호출 번호 E2 · 지어낸 C9)", () => {
    const out = cleanFacts(
      {
        facts: [
          { ref: "E2", fact: "기사에 따르면 코스피 급등" },
          { ref: "C9", fact: "차이 0.61%p" },
          { ref: "C9", fact: "차이 다시" },
          { ref: "C1", fact: "두 수익률 차이 0.61%p" },
        ],
        dropped: [{ ref: "E7", reason: "없는 번호" }],
        unverified: [],
      },
      ids,
    );
    expect(out.facts).toEqual([{ ref: "C1", fact: "두 수익률 차이 0.61%p" }]);
    expect(out.dropped).toEqual([
      { ref: "E2", reason: "장부에 없는 번호라 사실에서 뺌" },
      { ref: "C9", reason: "장부에 없는 번호라 사실에서 뺌" },
    ]);
  });

  it("빈 문장 · 중복을 지우고 앞뒤 공백을 다듬는다", () => {
    const out = cleanFacts(
      {
        facts: [
          { ref: "E1", fact: " 종가 88,905원 " },
          { ref: "E1", fact: "종가 88,905원" },
          { ref: "E2-2", fact: "  " },
        ],
        dropped: [
          { ref: "E2-1", reason: "무관" },
          { ref: "E2-1", reason: "무관 (중복)" },
        ],
        unverified: ["기사 속 1조 원", "기사 속 1조 원", " "],
      },
      ids,
    );
    expect(out).toEqual({
      facts: [{ ref: "E1", fact: "종가 88,905원" }],
      dropped: [{ ref: "E2-1", reason: "무관" }],
      unverified: ["기사 속 1조 원"],
    });
  });

  it("고를 것이 없으면 facts 는 빈 배열 (작성은 장부 전체를 본다)", () => {
    const out = cleanFacts({ facts: [{ ref: "E9", fact: "x" }], dropped: [], unverified: ["금리 확인 못 함"] }, ids);
    expect(out.facts).toEqual([]);
    expect(out.unverified).toEqual(["금리 확인 못 함"]);
  });
});
