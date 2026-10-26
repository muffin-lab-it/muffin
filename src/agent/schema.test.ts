import { describe, expect, it } from "vitest";
import { stageLabels, stages } from "./events";
import { factsSchema, intents, modeFor, planSchema } from "./schema";

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
