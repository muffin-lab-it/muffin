/**
 * ✍️ 작성 테스트 (@exx-sxx). 모델을 부르지 않고 "모델이 받는 입력" 과 "지시문" 의 모양을 확인합니다.
 * 입력 순서나 문구를 바꾸면 기대값도 같이 고치세요. 실제 리포트는 `pnpm eval --set common` 으로 봅니다 (리더 키).
 */
import { describe, expect, it } from "vitest";
import type { Evidence, FactsOutput, ResearchNotes, WriterOutput } from "./schema";
import { adviceGuardrail, revisionNote, writerInput, writerInstructions } from "./write";
import { depthInstructions } from "./depth";

const evidence: Evidence[] = [
  {
    id: "E1",
    tool: "get_fx_krw_rate",
    label: "환율 확인 · Frankfurter v2",
    values: { rate: 1392.4, changePct: 2.0 },
    source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-10-19" },
    note: "주말은 직전 영업일 값",
  },
  {
    id: "E2-1",
    tool: "get_korean_economic_news",
    label: "경제 뉴스 확인 · 연합뉴스",
    values: { title: "환율 1,390원대" },
    source: { name: "연합뉴스", url: "https://www.yna.co.kr/1", asOf: "2026-10-19" },
  },
  {
    id: "C1",
    tool: "calc_metrics",
    label: "계산 · 한미 금리 차이",
    values: { changePp: 0.88, from: 3, to: 3.88, unit: "%" },
    source: { name: "Muffin 계산", url: "", asOf: "2026-10-16" },
    lineage: { op: "pp_diff", inputs: ["E3", "E4"] },
  },
];
const notes: ResearchNotes = { notes: [{ ref: "E1", summary: "달러가 30일 2% 올랐습니다." }], gaps: ["금리 tool 실패"] };

describe("writerInstructions", () => {
  it("영역별 힌트가 명시된 목적과 목적이 없는 경우의 기본 관점, 미보유 맥락을 전달한다", () => {
    const fx = writerInstructions("easy", "fx");
    const etf = writerInstructions("standard", "etf", "decision_facts");
    expect(fx).toContain("질문에 명시된 목적이 있으면 그 목적과 직접 관련된 영향을 중심으로 설명");
    expect(fx).toContain("목적이 드러나지 않으면 환율 변화가 생활·수입품·해외자산에 뜻하는 바를 설명");
    expect(etf).toContain("아직 사지 않았다고 하면 보유자 관점으로 쓰지 않습니다");
    expect(etf).toContain(depthInstructions("standard", "decision_facts"));
  });

  it.each(["easy", "standard", "deep"] as const)("%s 에서 읽기 규칙과 기존 금융 깊이 · 판단 요청 규칙을 함께 전달한다", (depth) => {
    const text = writerInstructions(depth, "macro", "decision_facts");
    expect(text).toContain("[읽는 사람을 위한 구성]");
    expect(text).toContain("용어 사용과 설명 방식은 깊이별 규칙을 따릅니다");
    expect(text).toContain("질문에 대한 답을 nextTopics 로 미루지 않습니다");
    expect(text).toContain("자료 없음은 값이 0이거나 변화가 없다는 뜻이 아닙니다");
    expect(text).toContain("다음 조회의 성공을 약속하지 않습니다");
    expect(text).toContain(depthInstructions(depth, "decision_facts"));
    expect(text).toContain("관심 영역: 물가·경제지표");
  });

  it.each(["research", "decision_facts"] as const)("%s 모드에서 Deep에만 용어 설명 금지의 적용 범위를 전달한다", (mode) => {
    const deep = writerInstructions("deep", "etf", mode);
    expect(deep).toContain("용어는 설명 없이 쓴다는 규칙을 리포트의 모든 항목에 적용합니다");
    expect(deep).toContain("용어의 정의·동의어 풀이·괄호 해설을 덧붙이지 않습니다");
    for (const depth of ["easy", "standard"] as const) {
      const text = writerInstructions(depth, "etf", mode);
      expect(text).not.toContain("[깊이별 용어 규칙 적용]");
      expect(text).not.toContain("용어의 정의·동의어 풀이·괄호 해설을 덧붙이지 않습니다");
      expect(text).toContain(depthInstructions(depth, mode));
    }
  });

  it("깊이별 규칙과 공통 규칙(증거 번호 인용 · 근거 종류 · 권유 금지)이 들어간다", () => {
    const easy = writerInstructions("easy");
    const deep = writerInstructions("deep", "etf");
    expect(easy).toContain("Easy");
    expect(easy).not.toContain("Deep Dive");
    expect(deep).toContain("Deep Dive");
    expect(deep).toContain("관심 영역: ETF");
    for (const s of [easy, deep]) {
      expect(s).toContain("tool 을 부르지 않습니다");
      expect(s).toContain("권유 표현");
      expect(s).toContain("데이터로 확인되지 않음");
      expect(s).toContain("numbers 의 ref");
      expect(s).toContain("why 의 refs");
      expect(s).toContain("basis");
      expect(s).toContain("출처 목록은 시스템이");
      expect(s).not.toContain("tool 을 최소 1개 호출");
    }
  });

  it("판단 요청 모드면 모드 규칙이 붙는다", () => {
    expect(writerInstructions("standard", "fx", "decision_facts")).toContain("[모드: 판단 요청]");
    expect(writerInstructions("standard", "fx")).not.toContain("[모드: 판단 요청]");
  });
});

describe("writerInput", () => {
  it("정제가 없으면(1단계 입력) 질문 · 장부 전체(값 · note) · 조사 메모 · 확인하지 못한 것을 묶는다", () => {
    const text = writerInput("환율 왜 올랐어?", evidence, notes);
    expect(text).toContain("[질문]\n환율 왜 올랐어?");
    expect(text).toContain("- E1 · 환율 확인 · Frankfurter v2 · 기준일 2026-10-19");
    expect(text).toContain('values: {"rate":1392.4,"changePct":2}');
    expect(text).toContain("note: 주말은 직전 영업일 값");
    expect(text).toContain("- E2-1 · 경제 뉴스 확인 · 연합뉴스");
    expect(text).toContain("계산: pp_diff ← E3, E4");
    expect(text).toContain("[조사 메모]\n- E1: 달러가 30일 2% 올랐습니다.");
    expect(text).toContain("[확인하지 못한 것]");
    expect(text).toContain("- 금리 tool 실패");
    expect(text).not.toContain("[사실 목록]");
  });

  it("정제가 있으면 사실 목록과 인용된 장부 항목만 보이고, 뺀 항목과 조사 메모는 보이지 않는다", () => {
    const facts: FactsOutput = {
      facts: [
        { ref: "E1", fact: "USD/KRW 1,392.40원 (2026-10-19), 30일 전보다 +2.00%" },
        { ref: "C1", fact: "한미 기준금리 차이 0.88%p (2026-10-16)" },
      ],
      dropped: [{ ref: "E2-1", reason: "환율 수준만 전하는 기사" }],
      unverified: ["기사 속 외국인 순매도 규모는 장부에 없음"],
    };
    const text = writerInput("환율 왜 올랐어?", evidence, notes, facts);
    expect(text).toContain("[사실 목록]");
    expect(text).toContain("- E1: USD/KRW 1,392.40원");
    expect(text).toContain("- C1: 한미 기준금리 차이 0.88%p");
    expect(text).toContain("- E1 · 환율 확인 · Frankfurter v2");
    expect(text).toContain("- C1 · 계산 · 한미 금리 차이");
    expect(text).not.toContain("E2-1");
    expect(text).not.toContain("[조사 메모]");
    // 조사의 gaps 와 정제의 unverified 가 함께 "확인하지 못한 것" 으로 간다
    expect(text).toContain("- 금리 tool 실패");
    expect(text).toContain("- 기사 속 외국인 순매도 규모는 장부에 없음");
  });

  it("정제가 사실을 하나도 고르지 못했으면 장부 전체 입력으로 돌아간다", () => {
    const text = writerInput("q", evidence, notes, { facts: [], dropped: [], unverified: [] });
    expect(text).not.toContain("[사실 목록]");
    expect(text).toContain("[조사 메모]");
  });

  it("장부가 비면 numbers 를 비우라고 알린다", () => {
    const text = writerInput("q", [], { notes: [], gaps: [] });
    expect(text).toContain("tool 이 모두 실패");
    expect(text).toContain("[조사 메모]\n- (없음)");
  });

  it("자료가 없을 때도 질문과 실패 이유를 보존하고 성공이나 접수를 만들어 전달하지 않는다", () => {
    const text = writerInput("ETF 규모가 궁금해", [], { notes: [], gaps: ["ETF 조회 실패"] }, {
      facts: [], dropped: [], unverified: ["순자산총액 확인 불가"],
    });
    expect(text).toContain("[질문]\nETF 규모가 궁금해");
    expect(text).toContain("- ETF 조회 실패");
    expect(text).toContain("- 순자산총액 확인 불가");
    expect(text).not.toContain("접수했습니다");
    expect(text).not.toContain("준비 중입니다");
  });
});

describe("revisionNote", () => {
  it("실패 목록을 그대로 담은 수정 요청", () => {
    const text = revisionNote(['numbers "USD/KRW": value 1,400원 가 E1 의 값과 다름', "투자 권유 표현: \"지금 사세요\""]);
    expect(text).toMatch(/^\[수정 요청\]/);
    expect(text).toContain("- numbers \"USD/KRW\"");
    expect(text).toContain("- 투자 권유 표현");
    expect(text).toContain("관련 요약과 설명도 일치시키고");
  });
});

describe("adviceGuardrail", () => {
  const base: WriterOutput = { summary: "환율이 올랐습니다.", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] };
  const args = (agentOutput: WriterOutput) => ({ agent: {}, agentOutput, context: {} }) as never;

  it("권유 표현이 있으면 tripwire 를 울리고 문장을 알려 준다", async () => {
    const out = await adviceGuardrail.execute(args({ ...base, impact: ["지금 달러를 매수하세요."] }));
    expect(out.tripwireTriggered).toBe(true);
    expect(out.outputInfo).toEqual({ flagged: ["지금 달러를 매수하세요."] });
  });

  it("없으면 통과", async () => {
    const out = await adviceGuardrail.execute(args(base));
    expect(out.tripwireTriggered).toBe(false);
  });
});
