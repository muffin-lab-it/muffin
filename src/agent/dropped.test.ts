import { describe, expect, it } from "vitest";
import { DROPPED_HEADING, droppedNote } from "./dropped";
import type { Evidence } from "./schema";

const fx: Evidence = { id: "E1", tool: "get_fx_krw_rate", label: "환율 확인 · Frankfurter v2", values: { rate: 1392.4, changePct: 2 }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-10-19" } };
const rate: Evidence = { id: "E2", tool: "get_rate_data", label: "금리 확인 · ECOS", values: { rate: 3, changePp: 0 }, source: { name: "ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-10-16" } };

describe("droppedNote", () => {
  it("정제가 뺀 장부 항목을 이름 · 기준일 · 이유로 적고 값은 적지 않는다", () => {
    const note = droppedNote({ facts: [{ ref: "E1", fact: "환율" }], dropped: [{ ref: "E2", reason: "90일 환율 변화의 원인 근거로 보기 어려움" }], unverified: [] }, [fx, rate]);
    expect(note.startsWith(DROPPED_HEADING)).toBe(true);
    expect(note).toContain("- E2 · 금리 확인 · ECOS · 기준일 2026-10-16 · 뺀 이유: 90일 환율 변화의 원인 근거로 보기 어려움");
    expect(note).toContain("dataGaps 에 넣지 않습니다");
    expect(note).not.toContain("3");
    expect(note).not.toContain("E1 ·");
  });

  it("장부에 없는 번호 · 중복은 빼고, 적을 것이 없거나 정제가 실패하면 빈 문자열", () => {
    expect(droppedNote({ facts: [], dropped: [{ ref: "E9", reason: "없는 번호" }], unverified: [] }, [fx])).toBe("");
    expect(droppedNote({ facts: [], dropped: [], unverified: [] }, [fx])).toBe("");
    expect(droppedNote(null, [fx])).toBe("");
    const twice = droppedNote({ facts: [], dropped: [{ ref: "E2", reason: "a" }, { ref: "E2", reason: "b" }], unverified: [] }, [fx, rate]);
    expect(twice.split("\n").filter((l) => l.startsWith("- E2")).length).toBe(1);
  });

  it("큰 움직임의 원인 후보로 다시 쓰는 id(except)는 목록에서 빠지고, 전부 빠지면 빈 문자열", () => {
    const facts = { facts: [], dropped: [{ ref: "E1", reason: "현황 아님" }, { ref: "E2", reason: "단독 근거 아님" }], unverified: [] };
    const note = droppedNote(facts, [fx, rate], new Set(["E2"]));
    expect(note).toContain("- E1 ·");
    expect(note).not.toContain("- E2 ·");
    expect(droppedNote(facts, [fx, rate], new Set(["E1", "E2"]))).toBe("");
  });
});
