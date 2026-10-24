import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { muffinTools } from "../../src/tools";
import { loadAllQuestionSets, loadQuestionSet, setNames } from "./schema";

describe("scripts/questions 고정 질문 세트", () => {
  it("모든 세트 파일이 형식에 맞는다 (set = 파일 이름, id 는 set- 로 시작하고 고유)", () => {
    const sets = loadAllQuestionSets();
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) {
      expect(setNames).toContain(set.set);
      expect(set.questions.length).toBeGreaterThan(0);
    }
  });

  it("expectTools 에는 레지스트리에 있는 tool 이름만 쓴다", () => {
    const names = new Set(muffinTools.map((t) => t.name));
    const unknown = loadAllQuestionSets().flatMap((set) =>
      set.questions.flatMap((q) => q.expectTools.filter((t) => !names.has(t)).map((t) => `${set.set}/${q.id}: ${t}`)),
    );
    expect(unknown).toEqual([]);
  });

  it("범위 밖(out_of_scope) 질문은 기대 tool 이 없다", () => {
    const wrong = loadAllQuestionSets().flatMap((set) =>
      set.questions.filter((q) => q.intent === "out_of_scope" && q.expectTools.length > 0).map((q) => `${set.set}/${q.id}`),
    );
    expect(wrong).toEqual([]);
  });

  it("형식이 틀리면 어느 파일의 어디가 틀렸는지 알려 준다", () => {
    const dir = mkdtempSync(join(tmpdir(), "muffin-questions-"));
    const file = join(dir, "fx.json");

    writeFileSync(file, "{ not json");
    expect(() => loadQuestionSet(file)).toThrow(/fx\.json: JSON 이 아닙니다/);

    writeFileSync(file, JSON.stringify({ set: "fx", owner: "seoyoung23", questions: [] }));
    expect(() => loadQuestionSet(file)).toThrow(/fx\.json: owner: GitHub 핸들/);

    const q = { question: "오늘 달러 환율 얼마야?", area: "fx", intent: "status" };
    writeFileSync(file, JSON.stringify({ set: "rate", owner: "@seoyoung23", questions: [{ id: "rate-status-1", ...q }] }));
    expect(() => loadQuestionSet(file)).toThrow(/set\("rate"\) 은 파일 이름\("fx"\)/);

    writeFileSync(file, JSON.stringify({ set: "fx", owner: "@seoyoung23", questions: [{ id: "rate-status-1", ...q }] }));
    expect(() => loadQuestionSet(file)).toThrow(/"rate-status-1" 는 "fx-" 로 시작/);

    writeFileSync(
      file,
      JSON.stringify({ set: "fx", owner: "@seoyoung23", questions: [{ id: "fx-status-1", ...q }, { id: "fx-status-1", ...q }] }),
    );
    expect(() => loadQuestionSet(file)).toThrow(/"fx-status-1" 가 중복/);

    writeFileSync(file, JSON.stringify({ set: "fx", owner: "@seoyoung23", questions: [{ id: "fx-status-1", ...q }] }));
    expect(loadQuestionSet(file).questions[0]).toMatchObject({ id: "fx-status-1", depth: "standard", expectTools: [] });
  });
});
