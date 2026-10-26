import { describe, expect, it } from "vitest";
import { loadQuestionSet } from "../../../scripts/questions/schema";
import { newsTool } from "./index";

describe("News 평가 질문", () => {
  it("공통 스키마를 따르는 현황·원인·비교 각 2문항과 담당자·기대 Tool을 기록한다", () => {
    const set = loadQuestionSet("scripts/questions/news.json");
    const common = loadQuestionSet("scripts/questions/common.json");
    expect(set.set).toBe("news");
    expect(set.owner).toBe("@Kangsohee");
    expect(set.questions).toHaveLength(6);
    expect(new Set(set.questions.map(({ question }) => question)).size).toBe(6);
    for (const intent of ["status", "cause", "compare"]) {
      expect(set.questions.filter((question) => question.intent === intent)).toHaveLength(2);
    }
    for (const question of set.questions) {
      expect(question.id).toMatch(/^news-(status|cause|compare)-[12]$/);
      expect(question.area).toBe("news");
      expect(question.expectTools).toEqual([newsTool.name]);
      expect(question.note?.trim().length).toBeGreaterThan(0);
      expect(common.questions.map(({ question }) => question)).not.toContain(question.question);
    }
  });
});
