import { describe, expect, it } from "vitest";
import v1 from "./fixtures/report.v1.sample.json";
import v2 from "./fixtures/report.v2.sample.json";
import { normalizeReport } from "./normalize";
import { DISCLOSURE, assembleReport, sourcesFrom, summarizeWhy } from "./report";
import { reportSchema, writerSchema, type Evidence, type Verification, type WriterOutput } from "./schema";

function evidence(id: string, url: string, asOf = "2026-10-01"): Evidence {
  return { id, tool: "test_tool", label: id, values: { v: 1 }, source: { name: `출처 ${id}`, url, asOf } };
}

const output: WriterOutput = {
  summary: "요약",
  numbers: [
    { label: "a", value: "1", change: "", asOf: "2026-10-01", ref: "E1" },
    { label: "b", value: "2", change: "", asOf: "2026-10-01", ref: null },
  ],
  why: [
    { claim: "데이터 원인", evidence: "E1 의 값", basis: "data", refs: ["E1"] },
    { claim: "보도 원인", evidence: "기사", basis: "news", refs: ["E2-1"] },
    { claim: "추정", evidence: "데이터로 확인되지 않음", basis: "none", refs: [] },
  ],
  impact: [],
  caveats: [],
  dataGaps: [],
  nextTopics: [],
};

const skipped: Verification = {
  status: "skipped",
  numbers: { total: 2, verified: 0, derived: 0, unverified: 2 },
  why: { data: 1, news: 1, none: 1, unsupported: 0 },
  advice: 0,
  revisions: 0,
  removed: [],
};

describe("샘플 fixture", () => {
  it("v2 샘플은 reportSchema 를 통과하고 작성 출력 부분은 writerSchema 도 통과한다", () => {
    const r = reportSchema.parse(v2.report);
    expect(r.version).toBe(2);
    expect(writerSchema.parse(v2.report)).toBeTruthy();
    // 숫자 · 원인이 인용한 id 는 모두 증거 장부에 있어야 한다
    const ids = new Set(r.evidence.map((e) => e.id));
    for (const n of r.numbers) if (n.ref) expect(ids.has(n.ref)).toBe(true);
    for (const w of r.why) for (const ref of w.refs) expect(ids.has(ref)).toBe(true);
  });
});

describe("assembleReport", () => {
  it("출처는 증거 장부에서 만들고, 같은 url 은 한 번만, url 없는 계산 증거는 뺀다", () => {
    const ev = [
      evidence("E1", "https://a.test/1"),
      evidence("E2-1", "https://news.test/1"),
      evidence("E2-2", "https://news.test/1"),
      { ...evidence("C1", ""), lineage: { op: "spread", inputs: ["E1"] } },
    ];
    const r = assembleReport(output, ev, skipped);
    expect(sourcesFrom(ev).map((s) => s.id)).toEqual(["E1", "E2-1"]);
    expect(r.sources.map((s) => s.id)).toEqual(["E1", "E2-1"]);
    expect(r.evidence).toHaveLength(4);
    expect(r.disclosure).toBe(DISCLOSURE);
    expect(reportSchema.parse(r)).toEqual(r);
  });

  it("검증을 건너뛰면 숫자는 모두 unverified 이고, checks 를 주면 그대로 붙는다", () => {
    expect(assembleReport(output, [], skipped).numbers.map((n) => n.check)).toEqual(["unverified", "unverified"]);
    const checked = assembleReport(output, [], { ...skipped, status: "pass" }, { checks: ["verified", "derived"] });
    expect(checked.numbers.map((n) => n.check)).toEqual(["verified", "derived"]);
  });

  it("모드 · 안내 · 차트는 준 것만 들어간다", () => {
    const plain = assembleReport(output, [], skipped);
    expect(plain.mode).toBe("research");
    expect("notice" in plain).toBe(false);
    expect("charts" in plain).toBe(false);
    const decision = assembleReport(output, [], skipped, { mode: "decision_facts", notice: "판단은 사용자에게" });
    expect(decision).toMatchObject({ mode: "decision_facts", notice: "판단은 사용자에게" });
  });

  it("summarizeWhy 는 basis 별로 센다", () => {
    expect(summarizeWhy(output.why)).toEqual({ data: 1, news: 1, none: 1, unsupported: 0 });
  });
});

describe("normalizeReport", () => {
  it("v2 리포트는 그대로 통과한다", () => {
    expect(normalizeReport(v2.report)).toEqual(reportSchema.parse(v2.report));
  });

  it("v1 기록을 v2 모양으로 바꾼다: 검증 없음, 숫자 미검증, 출처 S1…", () => {
    const r = normalizeReport(v1.report);
    expect(r.version).toBe(2);
    expect(r.mode).toBe("research");
    expect(r.numbers.every((n) => n.check === "unverified" && n.ref === null)).toBe(true);
    expect(r.sources.map((s) => s.id)).toEqual(["S1"]);
    expect(r.evidence).toEqual([]);
    expect(r.verification).toMatchObject({ status: "skipped", numbers: { total: 4, unverified: 4 }, advice: 0 });
    expect(r.disclosure).toBe(DISCLOSURE);
    expect(reportSchema.parse(r)).toEqual(r);
  });

  it("v1 의 '데이터로 확인되지 않음' 근거는 none, 나머지는 data 로 본다", () => {
    const r = normalizeReport({
      ...v1.report,
      why: [
        { claim: "a", evidence: "ETF 30일 -3.61%" },
        { claim: "b", evidence: "데이터로 확인되지 않음" },
      ],
    });
    expect(r.why.map((w) => w.basis)).toEqual(["data", "none"]);
    expect(r.why.every((w) => w.refs.length === 0)).toBe(true);
    expect(r.verification.why).toEqual({ data: 1, news: 0, none: 1, unsupported: 0 });
  });

  it("리포트가 아니면 throw 한다", () => {
    expect(() => normalizeReport({})).toThrow();
    expect(() => normalizeReport(null)).toThrow();
  });
});
