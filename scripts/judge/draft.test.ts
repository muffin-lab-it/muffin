import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Evidence } from "../../src/agent/schema";
import { buildPairs, duplicateIds, findCandidate, load, type Loaded } from "./draft";

const ev = (id: string, title: string): Evidence => ({ id, tool: "get_korean_economic_news", label: "뉴스", values: { title }, source: { name: "n", url: `https://example.com/${id}`, asOf: "2026-11-04" } });
const cand = (file: string, id: string, claim: string): Loaded => ({ file, id, area: "fx", claim, evidence: "작성 설명", basis: "news", refs: ["E1-1", "E1-2"], ledger: [ev("E1-1", "a"), ev("E1-2", "b")], expected: null, source: `docs/eval/${file}.pairs.json` });

describe("scripts/judge/draft 라벨 → 쌍", () => {
  it("평문 id 로 찾고, refs 를 주면 장부를 그만큼만 남기며, 변형은 id 와 source 에 표시된다", () => {
    const cands = [cand("2026-11-04-1753", "fx-cause-1-easy-1", "원래 주장")];
    const pairs = buildPairs(
      { "fx-cause-1-easy-1": { expected: "supported", note: "n" }, "fx-cause-1-easy-1#flip": { expected: "contradicted", claim: "뒤집은 주장", refs: ["E1-1"], note: "f" } },
      cands,
    );
    expect(pairs.map((p) => p.id)).toEqual(["fx-cause-1-easy-1", "fx-cause-1-easy-1-flip"]);
    expect(pairs[0]).toMatchObject({ claim: "원래 주장", evidence: "작성 설명", refs: ["E1-1", "E1-2"], expected: "supported", note: "n" });
    expect(pairs[1]).toMatchObject({ claim: "뒤집은 주장", refs: ["E1-1"], expected: "contradicted", evidence: "" });
    expect(pairs[1]!.ledger.map((e) => e.id)).toEqual(["E1-1"]);
    expect(pairs[1]!.source).toContain("변형(flip)");
    expect(() => buildPairs({ "fx-cause-1-easy-1": { expected: "supported", refs: ["E9"] } }, cands)).toThrow("E9");
    expect(() => buildPairs({ "없는-id": { expected: "supported" } }, cands)).toThrow("후보에 없는 id");
  });

  it("같은 id 가 여러 평가 파일에 있으면 평문 id 를 거부하고 <파일>/<id> 로만 받는다 (라벨이 다른 주장 · 장부에 붙지 않게)", () => {
    const cands = [cand("2026-11-03-0613", "fx-cause-1-easy-1", "11/3 주장"), cand("2026-11-04-1753", "fx-cause-1-easy-1", "11/4 주장")];
    expect([...duplicateIds(cands)]).toEqual([["fx-cause-1-easy-1", ["2026-11-03-0613", "2026-11-04-1753"]]]);
    expect(() => findCandidate("fx-cause-1-easy-1", cands)).toThrow("여러 파일");
    expect(() => findCandidate("2026-11-05-0000/fx-cause-1-easy-1", cands)).toThrow("후보에 없는 키");
    const pairs = buildPairs(
      { "2026-11-04-1753/fx-cause-1-easy-1": { expected: "supported" }, "2026-11-03-0613/fx-cause-1-easy-1#over": { expected: "unsupported", claim: "더한 주장" } },
      cands,
    );
    expect(pairs.map((p) => [p.id, p.claim])).toEqual([
      ["fx-cause-1-easy-1-2026-11-04-1753", "11/4 주장"],
      ["fx-cause-1-easy-1-2026-11-03-0613-over", "더한 주장"],
    ]);
    // 파일을 붙인 키도 한 파일 안에서 겹치면 거부
    expect(() => findCandidate("2026-11-04-1753/fx-cause-1-easy-1", [...cands, cand("2026-11-04-1753", "fx-cause-1-easy-1", "또 하나")])).toThrow("2개");
  });

  it("다른 폴더의 같은 이름 파일은 함께 읽지 않는다 (파일 이름이 이름 공간이라 어느 쪽인지 알 수 없음)", () => {
    const dir = mkdtempSync(join(tmpdir(), "judge-draft-"));
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    const one = JSON.stringify([cand("x", "fx-cause-1-easy-1", "A")]);
    writeFileSync(join(dir, "a", "2026-11-04-1753.pairs.json"), one);
    writeFileSync(join(dir, "b", "2026-11-04-1753.pairs.json"), one);
    writeFileSync(join(dir, "b", "2026-11-03-0613.pairs.json"), one);
    expect(load([join(dir, "a", "2026-11-04-1753.pairs.json"), join(dir, "b", "2026-11-03-0613.pairs.json")]).map((c) => c.file)).toEqual(["2026-11-04-1753", "2026-11-03-0613"]);
    expect(() => load([join(dir, "a", "2026-11-04-1753.pairs.json"), join(dir, "b", "2026-11-04-1753.pairs.json")])).toThrow("같은 이름의 후보 파일");
  });
});
