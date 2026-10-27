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
import { newsTool } from "../tools/news";
import { muffinTools } from "../tools";
import { ResearchContext } from "./context";
import { commonRules } from "./instructions";
import { NOTES_FALLBACK, createResearcherAgent, researchInstructions, runResearch } from "./research";
import { areas, researchNotesSchema, type ResearchNotes } from "./schema";

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

  // 프롬프트 전달 계약만 검사합니다. 비교·재검색·근거 판별의 실제 모델 행동을 증명하지 않습니다.
  it("모든 영역과 영역 미지정에 원인 질문 뉴스 조사·재검색·근거 메모 규칙과 기존 공통 제약을 전달한다", () => {
    for (const area of [...areas, undefined]) {
      const text = createResearcherAgent("standard", area).instructions;
      expect(text).toContain(commonRules);
      expect(text).toContain("각 대상의 자료 확보 여부");
      expect(text).toContain("대상과 부족한 자료를 gaps 에");
      expect(text).toContain("실패한 요청, 보완 조회로 확보한 범위, 여전히 없는 자료");
      expect(text).toContain("해당 결과가 실제로 뒷받침하는 사실");
      expect(text).toContain("일반 지식이나 추정 원인을 그 번호에 연결하지 않습니다");
      expect(text).toContain("실패한 요청에는 메모용 번호를 만들지 말고");
      expect(text).toContain("원인·이유·배경 질문이면 제공된 뉴스 tool 도 호출해 근거를 확인합니다.");
      expect(text).toContain("뉴스 검색 결과가 없으면 검색어를 더 짧고 넓게 바꿔 한 번만 재시도하고, 그래도 결과가 없으면 자료 부족을 gaps 에 적습니다.");
    }
  });

  it("뉴스에만 검색·본문 범위 전략을 전달하고 무조건적인 추가 지표 조회를 요구하지 않는다", () => {
    const text = createResearcherAgent("standard", "news", [newsTool]).instructions;
    expect(text).toContain("query 는 짧은 주제 핵심어");
    expect(text).toContain("금리와 물가를 따로 검색");
    expect(text).toContain("한 번만 재시도");
    expect(text).toContain("제목에 query 전체가 포함");
    expect(text).toContain("Google은 query 를 RSS 검색에 전달");
    expect(text).toContain("제목만 있으면 제목 수준의 사실만");
    expect(text).toContain("본문이 있으면 그 안의 설명 주체와 주장");
    expect(text).toContain("Google은 목록·검색 전용");
    expect(text).toContain("수량 부족 partial을 성공한 기사 본문이 일부만 추출됐다는 뜻으로 바꾸지 않습니다");
    expect(text).toContain("단순 보도 설명에는 추가 지표 조회를 요구하지 않습니다");
    expect(text).toContain("검증 불가를 gaps 에");
    expect(text).not.toContain("뉴스에 나온 숫자는 다른 tool 로 확인");
    for (const area of areas.filter((area) => area !== "news")) {
      expect(researchInstructions(area)).not.toContain("query 는 짧은 주제 핵심어");
    }
  });
});

describe("createResearcherAgent", () => {
  it("기본은 레지스트리의 모든 tool, 분류가 고른 목록을 주면 그것만 쓴다", () => {
    expect(createResearcherAgent("standard").tools).toHaveLength(muffinTools.length);
    expect(createResearcherAgent("standard", "fx", [fxTool]).tools.map((t) => t.name)).toEqual(["get_fx_krw_rate"]);
    // 빈 목록은 "고른 게 없음" 이므로 전체로 돌아간다
    expect(createResearcherAgent("standard", "fx", []).tools).toHaveLength(muffinTools.length);
  });

  it("Agent 이름·출력 스키마와 분류가 넘긴 도구의 순서를 유지하고 계산 도구를 추가하지 않는다", () => {
    const selected = [newsTool, fxTool];
    const agent = createResearcherAgent("standard", "news", selected);
    expect(agent.name).toBe("Muffin Researcher");
    expect(agent.outputType).toBe(researchNotesSchema);
    expect(agent.tools).toEqual(selected);
    expect(selected).toEqual([newsTool, fxTool]);
    expect(agent.tools.some((tool) => tool.name === "calc_metrics")).toBe(false);
    expect(createResearcherAgent("standard", "news", [newsTool]).tools).toEqual([newsTool]);
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

  it("기사별 메모와 실패·보완·부족 기록을 변형하지 않고 같은 질문과 장부로 run 에 전달한다", async () => {
    // 실제 모델 대신 제목만 확보한 기사와 본문 확보 기사의 구조화 출력을 주입합니다.
    const context = new ResearchContext();
    context.addEvidence([
      {
        id: "E1-1", tool: newsTool.name, label: "합성 금리 제목",
        values: { title: "합성 금리 계약 점검", body: "not_requested" },
        source: { name: "합성 매체", url: "https://example.invalid/rate", asOf: "2026-10-26" },
      },
      {
        id: "E1-2", tool: newsTool.name, label: "합성 물가 본문",
        values: { title: "합성 물가 비용 설명", body: "available" },
        source: { name: "합성 매체", url: "https://example.invalid/price", asOf: "2026-10-26" },
      },
    ]);
    const notes: ResearchNotes = {
      notes: [
        { ref: "E1-1", summary: "제목에서 금리 계약 점검 주제만 확인했고 본문은 확보하지 못했습니다." },
        { ref: "E1-2", summary: "합성 본문의 업체는 포장 비용을 배경 후보로 설명했습니다. 독립 검증된 원인은 아닙니다." },
      ],
      gaps: ["복합 검색 실패 후 물가 재조회 성공", "금리 본문이 없어 양쪽 본문 쟁점 비교는 불가"],
    };
    const ledger = structuredClone(context.evidence);
    const sources = structuredClone(context.sources);
    const agent = createResearcherAgent("standard", "news", [newsTool]);
    const ctx = new RunContext(context);
    const question = "금리 뉴스랑 물가 뉴스는 어떤 차이가 있어?";
    runMock.mockResolvedValueOnce({ finalOutput: notes });

    const result = await runResearch(agent, question, ctx);

    expect(runMock).toHaveBeenCalledExactlyOnceWith(agent, question, { context: ctx });
    expect(result).toBe(notes);
    expect(researchNotesSchema.parse(result)).toEqual(notes);
    expect(result.notes.map((note) => note.ref)).toEqual(ledger.map((entry) => entry.id));
    expect(context.evidence).toEqual(ledger);
    expect(context.sources).toEqual(sources);
  });

  it("확인 불가한 대상만 있는 gaps 출력을 fallback 으로 바꾸지 않는다", async () => {
    const notes: ResearchNotes = { notes: [], gaps: ["물가 기사 본문을 확보하지 못했습니다."] };
    runMock.mockResolvedValueOnce({ finalOutput: notes });
    const result = await runResearch(createResearcherAgent("standard", "news", [newsTool]), "물가 배경", new RunContext(new ResearchContext()));
    expect(result).toBe(notes);
    expect(result).not.toBe(NOTES_FALLBACK);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("출력이 null 이어도 기존 장부와 실행 기록을 보존한 채 fallback 을 반환한다", async () => {
    const context = new ResearchContext();
    context.addEvidence([{
      id: "E1", tool: fxTool.name, label: "합성 환율",
      values: { rate: 1300 },
      source: { name: "합성 제공처", url: "https://example.invalid/fx", asOf: "2026-10-26" },
    }]);
    context.addStep({ tool: newsTool.name, status: "error", ms: 1, error: "합성 조회 실패" });
    const steps = structuredClone(context.steps);
    const ledger = structuredClone(context.evidence);
    const sources = structuredClone(context.sources);
    runMock.mockResolvedValueOnce({ finalOutput: null });
    const result = await runResearch(createResearcherAgent("standard", "news"), "뉴스", new RunContext(context));
    expect(result).toBe(NOTES_FALLBACK);
    expect(context.steps).toEqual(steps);
    expect(context.evidence).toEqual(ledger);
    expect(context.sources).toEqual(sources);
  });

  it("run 예외를 성공 메모나 fallback 으로 숨기거나 임의로 재시도하지 않는다", async () => {
    const error = new Error("합성 Agent 실행 실패");
    runMock.mockRejectedValueOnce(error);
    await expect(runResearch(createResearcherAgent("standard", "news"), "뉴스", new RunContext(new ResearchContext()))).rejects.toBe(error);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
