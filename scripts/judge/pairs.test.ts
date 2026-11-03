import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judgeInput, judgeVerdicts, judgeable } from "../../src/agent/judge";
import { muffinTools } from "../../src/tools";
import { loadPairs } from "./schema";

describe("scripts/judge 근거 판정 보정 세트", () => {
  const pairs = loadPairs();

  it("모든 쌍이 형식에 맞고 (id 고유, refs 는 ledger 에 있음), 세 판정이 모두 들어 있다", () => {
    expect(pairs.length).toBeGreaterThan(0);
    for (const verdict of judgeVerdicts) expect(pairs.some((p) => p.expected === verdict)).toBe(true);
  });

  it("ledger 의 tool 은 레지스트리에 있는 이름이거나 계산 · 게이트다", () => {
    const names = new Set([...muffinTools.map((t) => t.name), "calc_metrics", "calc_movement"]);
    const unknown = pairs.flatMap((p) => p.ledger.filter((e) => !names.has(e.tool)).map((e) => `${p.id}: ${e.tool}`));
    expect(unknown).toEqual([]);
  });

  it("모든 쌍이 판정 대상이 되고(basis · refs), 입력에 claim 과 인용한 장부 항목이 들어간다", () => {
    for (const p of pairs) {
      const items = judgeable([{ claim: p.claim, evidence: p.evidence, basis: p.basis, refs: p.refs }], p.ledger);
      expect(items, p.id).toHaveLength(1);
      const input = judgeInput(items, p.ledger);
      expect(input).toContain(p.claim);
      for (const ref of p.refs) expect(input).toContain(`- ${ref} · `);
    }
  });

  it("형식이 틀리면 파일 이름과 위치를 알려 준다", () => {
    const dir = mkdtempSync(join(tmpdir(), "judge-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify([{ ...pairs[0], refs: ["E9"] }]));
    expect(() => loadPairs(bad)).toThrow(/refs E9 가 ledger 에 없습니다/);
    writeFileSync(bad, JSON.stringify([{ ...pairs[0], expected: "maybe" }]));
    expect(() => loadPairs(bad)).toThrow(/expected/);
    writeFileSync(bad, JSON.stringify([pairs[0], pairs[0]]));
    expect(() => loadPairs(bad)).toThrow(/중복/);
  });
});
