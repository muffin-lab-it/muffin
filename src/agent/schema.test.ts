import { describe, expect, it } from "vitest";
import { stageLabels, stages } from "./events";
import { changeDetailSchema, factsSchema, intents, modeFor, planSchema, reportSchema, writerSchema } from "./schema";

describe("단계 사이의 모양", () => {
  it("의도 → 모드는 코드가 정한다 (판단 요청 · 범위 밖만 다른 모드)", () => {
    expect(intents.map(modeFor)).toEqual(["research", "research", "research", "decision_facts", "out_of_scope"]);
  });

  it("분류 출력은 의도 · tool 목록 · 이유", () => {
    expect(planSchema.parse({ intent: "cause", tools: ["get_fx_krw_rate", "get_rate_data"], reason: "왜 를 묻는 환율 질문" })).toMatchObject({ intent: "cause" });
    expect(planSchema.safeParse({ intent: "guess", tools: [], reason: "" }).success).toBe(false);
  });

  it("정제 출력은 사실 목록 · 뺀 것 · 확인 못 한 것", () => {
    const facts = factsSchema.parse({
      facts: [{ ref: "E1", fact: "USD/KRW 1,392.40원 (2026-10-19), 30일 전보다 +2.00%" }, { ref: "C1", fact: "한미 금리 차이 0.88%p" }],
      dropped: [{ ref: "E4-2", reason: "원인과 무관한 기사" }],
      unverified: ["기사가 보도한 외국인 순매도 1조 2,000억 원은 장부에 없음"],
    });
    expect(facts.facts.map((f) => f.ref)).toEqual(["E1", "C1"]);
    expect(factsSchema.safeParse({ facts: [{ ref: "E1" }], dropped: [], unverified: [] }).success).toBe(false);
  });

  it("스트림 단계는 다섯 개이고 모두 한국어 라벨이 있다", () => {
    expect(stages).toEqual(["plan", "research", "edit", "write", "verify"]);
    for (const s of stages) expect(stageLabels[s]).toBeTruthy();
  });
});

describe("11/10 작성 출력 · 리포트의 새 칸", () => {
  const base = { summary: "요약", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] };

  it("작성 출력(모델)에는 headline · impactTitles · topicReasons 가 필수다 (Structured Output 은 선택 필드가 없음)", () => {
    expect(writerSchema.safeParse(base).success).toBe(false);
    expect(writerSchema.safeParse({ ...base, headline: null, impactTitles: [], topicReasons: [] }).success).toBe(true);
    expect(writerSchema.safeParse({ ...base, headline: "한 문장", impactTitles: ["제목"], topicReasons: [] }).success).toBe(true);
  });

  it("리포트에서는 새 칸이 없어도 되고(예전 기록), 있으면 모양을 지킨다", () => {
    const report = {
      ...base,
      version: 2,
      mode: "research",
      sources: [],
      evidence: [],
      verification: { status: "skipped", numbers: { total: 0, verified: 0, derived: 0, unverified: 0 }, why: { data: 0, news: 0, none: 0, unsupported: 0 }, advice: 0, revisions: 0, removed: [] },
      disclosure: "고지",
    };
    expect(reportSchema.safeParse(report).success).toBe(true);
    expect(reportSchema.safeParse({ ...report, headline: "한 문장", impactTitles: ["제목"], topicReasons: ["이유"] }).success).toBe(true);
    expect(reportSchema.safeParse({ ...report, headline: 3 }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report, sources: [{ id: "E1", name: "출처", url: "https://api.test/x", asOf: "2026-10-19", pageUrl: "https://page.test/" }] }).success).toBe(true);
  });

  it("changeDetail 은 장부 키 · 값 · 단위 · 비교 기준이 필수이고 날짜 · 일수는 선택이다", () => {
    expect(changeDetailSchema.safeParse({ key: "changePct", value: 2, unit: "%", basis: "30일 전과 비교" }).success).toBe(true);
    expect(changeDetailSchema.safeParse({ key: "changePct", value: 2, unit: "%", from: "2026-09-19", to: "2026-10-19", days: 30, basis: "30일 전과 비교" }).success).toBe(true);
    expect(changeDetailSchema.safeParse({ key: "changePct", value: "2", unit: "%", basis: "x" }).success).toBe(false);
  });
});
