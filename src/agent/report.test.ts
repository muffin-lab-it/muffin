import { describe, expect, it } from "vitest";
import v1 from "./fixtures/report.v1.sample.json";
import v2 from "./fixtures/report.v2.sample.json";
import { normalizeReport } from "./normalize";
import { DISCLOSURE, assembleReport, fallbackGaps, outOfScopeOutput, sourcesFrom, summarizeWhy } from "./report";
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

  it("대조 세부(matches)는 checks 와 같은 순서로 numbers 에 붙고, 없으면 칸이 없다", () => {
    const r = assembleReport(output, [], { ...skipped, status: "pass" }, { checks: ["verified", "derived"], matches: [{ key: "rate", policy: "exact" }, undefined] });
    expect(r.numbers[0]?.match).toEqual({ key: "rate", policy: "exact" });
    expect(r.numbers[1]).not.toHaveProperty("match");
    expect(reportSchema.parse(r).numbers[0]?.match?.policy).toBe("exact");
  });

  it("모드 · 안내 · 차트는 준 것만 들어간다", () => {
    const plain = assembleReport(output, [], skipped);
    expect(plain.mode).toBe("research");
    expect("notice" in plain).toBe(false);
    expect("charts" in plain).toBe(false);
    const decision = assembleReport(output, [], skipped, { mode: "decision_facts", notice: "판단은 사용자에게" });
    expect(decision).toMatchObject({ mode: "decision_facts", notice: "판단은 사용자에게" });
  });

  it("fallbackGaps 는 저장된 응답을 쓴 tool 만, tool 마다 한 줄, 가장 오래된 나이로 적는다", () => {
    expect(fallbackGaps([{ tool: "get_fx_krw_rate", status: "ok", ms: 10 }, { tool: "get_rate_data", status: "error", ms: 5, error: "x" }])).toEqual([]);
    expect(
      fallbackGaps([
        { tool: "get_fx_krw_rate", status: "ok", ms: 10, fallbackAgeMs: 3 * 60 * 60_000 },
        { tool: "get_fx_krw_rate", status: "ok", ms: 10, fallbackAgeMs: 5 * 60_000 },
        { tool: "get_etf_kr_price", status: "ok", ms: 10, fallbackAgeMs: 90_000 },
      ]),
    ).toEqual([
      "환율 확인: 조회가 실패해 3시간 전에 받은 응답을 썼습니다 (데이터 기준일은 출처 그대로)",
      "국내 ETF 시세 확인: 조회가 실패해 2분 전에 받은 응답을 썼습니다 (데이터 기준일은 출처 그대로)",
    ]);
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

describe("11/10 새 칸: headline · impactTitles · topicReasons · changeDetail · pageUrl", () => {
  it("headline 과 짝이 맞는 제목 · 이유는 리포트에 들어가고, 없거나 개수가 다르면 칸이 없다", () => {
    const withAll: WriterOutput = {
      ...output,
      headline: "핵심 한 문장",
      impact: ["영향 1", "영향 2"],
      impactTitles: ["제목 1", "제목 2"],
      nextTopics: ["주제 1"],
      topicReasons: ["이유 1"],
    };
    const r = assembleReport(withAll, [evidence("E1", "https://a.test/1")], skipped);
    expect(r.headline).toBe("핵심 한 문장");
    expect(r.impactTitles).toEqual(["제목 1", "제목 2"]);
    expect(r.topicReasons).toEqual(["이유 1"]);
    expect(reportSchema.parse(r)).toEqual(r);

    const bare = assembleReport({ ...withAll, headline: null, impactTitles: ["제목 1"], topicReasons: [] }, [], skipped);
    expect(bare).not.toHaveProperty("headline");
    expect(bare).not.toHaveProperty("impactTitles");
    expect(bare).not.toHaveProperty("topicReasons");
    expect(assembleReport(output, [], skipped)).not.toHaveProperty("headline");
  });

  it("changes 는 checks 와 같은 순서로 numbers[].changeDetail 에 붙고, 없는 자리는 칸이 없다", () => {
    const detail = { key: "changePct", value: 2, unit: "%", from: "2026-09-19", to: "2026-10-19", days: 30, basis: "30일 전과 비교" };
    const r = assembleReport(output, [evidence("E1", "https://a.test/1")], skipped, { checks: ["verified", "unverified"], changes: [detail, undefined] });
    expect(r.numbers[0]!.changeDetail).toEqual(detail);
    expect(r.numbers[1]).not.toHaveProperty("changeDetail");
    expect(reportSchema.parse(r)).toEqual(r);
  });

  it("API 주소인 출처에는 공식 페이지(pageUrl)가 붙고, 장부의 출처에도 같이 붙는다", () => {
    const api = evidence("E1", "https://api.frankfurter.dev/v2/rates?base=USD&quote=KRW");
    const page = evidence("E2", "https://fred.stlouisfed.org/series/DFF");
    const r = assembleReport(output, [api, page], skipped);
    expect(r.sources.map((s) => s.pageUrl)).toEqual(["https://frankfurter.dev/", undefined]);
    expect(r.evidence[0]!.source.pageUrl).toBe("https://frankfurter.dev/");
    expect(r.evidence[1]!.source).not.toHaveProperty("pageUrl");
  });

  it("범위 밖 고정 본문도 새 칸을 갖는다 (모델이 만든 출력과 같은 모양)", () => {
    const out = outOfScopeOutput("비트코인 얼마야?");
    expect(out).toMatchObject({ headline: null, impactTitles: [], topicReasons: [] });
    expect(writerSchema.parse(out)).toBeTruthy();
  });

  it("normalizeReport 는 11/10 전에 저장된 v2 기록에도 출처의 pageUrl 을 채운다", () => {
    const stored = JSON.parse(JSON.stringify(v2.report)) as Record<string, unknown> & { sources: Record<string, unknown>[]; evidence: { source: Record<string, unknown> }[] };
    for (const s of stored.sources) delete s.pageUrl;
    for (const e of stored.evidence) delete e.source.pageUrl;
    delete stored.headline;
    delete stored.impactTitles;
    delete stored.topicReasons;
    const r = normalizeReport(stored);
    expect(r.sources.filter((s) => s.pageUrl).map((s) => s.pageUrl)).toEqual(["https://frankfurter.dev/", "https://frankfurter.dev/"]);
    expect(r.headline).toBeUndefined();
  });
});
