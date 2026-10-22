import { describe, expect, it } from "vitest";
import type { Evidence, ResearchNotes, WriterOutput } from "./schema";
import { adviceGuardrail, revisionNote, writerInput } from "./writer";

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
];
const notes: ResearchNotes = { notes: [{ ref: "E1", summary: "달러가 30일 2% 올랐습니다." }], gaps: ["금리 tool 실패"] };

describe("writerInput", () => {
  it("질문 · 장부(값 · note) · 조사 메모 · 확인하지 못한 것을 한 입력으로 묶는다", () => {
    const text = writerInput("환율 왜 올랐어?", evidence, notes);
    expect(text).toContain("[질문]\n환율 왜 올랐어?");
    expect(text).toContain("- E1 · 환율 확인 · Frankfurter v2 · 기준일 2026-10-19");
    expect(text).toContain('values: {"rate":1392.4,"changePct":2}');
    expect(text).toContain("note: 주말은 직전 영업일 값");
    expect(text).toContain("- E2-1 · 경제 뉴스 확인 · 연합뉴스");
    expect(text).toContain("[조사 메모]\n- E1: 달러가 30일 2% 올랐습니다.");
    expect(text).toContain("[확인하지 못한 것]");
    expect(text).toContain("- 금리 tool 실패");
  });

  it("장부가 비면 numbers 를 비우라고 알린다", () => {
    const text = writerInput("q", [], { notes: [], gaps: [] });
    expect(text).toContain("tool 이 모두 실패");
    expect(text).toContain("[조사 메모]\n- (없음)");
  });
});

describe("revisionNote", () => {
  it("실패 목록을 그대로 담은 수정 요청", () => {
    const text = revisionNote(['numbers "USD/KRW": value 1,400원 가 E1 의 값과 다름', "투자 권유 표현: \"지금 사세요\""]);
    expect(text).toMatch(/^\[수정 요청\]/);
    expect(text).toContain("- numbers \"USD/KRW\"");
    expect(text).toContain("- 투자 권유 표현");
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
