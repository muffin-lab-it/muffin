import { afterEach, describe, expect, it, vi } from "vitest";
import { EVAL_LIMIT, failedLabels, loadEvals, metricLines, withinRatio, type EvalRow } from "./admin-evals";

// Supabase 를 부르지 않고 조회 체인(from → select → [eq → is → is] → order → limit)을 흉내 냅니다. limit 이 결과를 차례로 돌려줍니다.
const db = vi.hoisted(() => ({ enabled: vi.fn(() => false), from: vi.fn(), throwOnGet: null as string | null, results: [] as { data: unknown[] | null; error: { message: string } | null }[] }));
vi.mock("./db", () => ({
  dbEnabled: db.enabled,
  getDb: () => {
    if (db.throwOnGet) throw new Error(db.throwOnGet);
    return { from: db.from };
  },
}));
const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn() };
for (const fn of [query.select, query.eq, query.is, query.order]) fn.mockReturnValue(query);
query.limit.mockImplementation(async () => db.results.shift() ?? { data: [], error: null });
db.from.mockReturnValue(query);

const row = (over: Partial<EvalRow> = {}): EvalRow => ({
  id: "41764416453",
  at: "2026-11-04T03:01:00.000Z",
  source: "ci",
  tag: null,
  set_name: null,
  questions: 19,
  errors: 0,
  avg_ms: 18_100,
  models: ["gpt-6-luna", "gpt-6-sol"],
  tokens: { prompt: 319_791, completion: 21_854 },
  rates: { intent: { pass: 18, total: 19, rate: 18 / 19 }, tools: { pass: 17, total: 18, rate: 17 / 18 }, judge: { pass: 0, total: 0, rate: null }, latency: { pass: 19, total: 19, rate: 1 } },
  thresholds: { intent: 0.8, tools: 0.8, judge: 0.8, latency: 0.7 },
  failed: [],
  run_url: "https://github.com/muffin-lab-it/muffin/actions/runs/41764416453",
  summary: "# 리포트 평가",
  ...over,
});

afterEach(() => {
  db.enabled.mockReturnValue(false);
  db.throwOnGet = null;
  db.results = [];
  db.from.mockClear();
  for (const fn of Object.values(query)) fn.mockClear();
});

describe("loadEvals", () => {
  it("Supabase 환경 변수가 없으면 none 이고 DB 를 부르지 않는다", async () => {
    expect(await loadEvals()).toEqual({ source: "none", weekly: [], rows: [] });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("주간 평가(ci · tag 없음 · 세트 없음)와 최근 기록을 따로 최신순 12줄씩 읽는다", async () => {
    db.enabled.mockReturnValue(true);
    const weekly = [row()];
    const history = [row({ id: "local-1", source: "local", tag: "sol" }), row({ id: "local-2", source: "local", set_name: "common" }), row()];
    db.results = [{ data: weekly, error: null }, { data: history, error: null }];
    const loaded = await loadEvals();
    expect(loaded).toEqual({ source: "evals", weekly, rows: history });
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(db.from).toHaveBeenCalledWith("evals");
    expect(query.eq).toHaveBeenCalledWith("source", "ci");
    expect(query.is).toHaveBeenCalledWith("tag", null);
    expect(query.is).toHaveBeenCalledWith("set_name", null);
    expect(query.order).toHaveBeenCalledWith("at", { ascending: false });
    expect(query.limit).toHaveBeenCalledTimes(2);
    expect(query.limit).toHaveBeenCalledWith(EVAL_LIMIT);
  });

  it("표가 없거나 조회가 실패하면 error 를 담아 돌려준다 (화면이 안내문으로 보여 줌)", async () => {
    db.enabled.mockReturnValue(true);
    db.results = [{ data: null, error: { message: "Could not find the table 'public.evals' in the schema cache" } }, { data: [], error: null }];
    expect(await loadEvals()).toEqual({ source: "evals", weekly: [], rows: [], error: expect.stringContaining("public.evals") });
  });

  it("클라이언트 만들기 · 조회가 throw 해도 error 로 돌려주고 throw 하지 않는다 (화면 나머지는 그대로)", async () => {
    db.enabled.mockReturnValue(true);
    db.throwOnGet = "Supabase 환경 변수가 없습니다: SUPABASE_URL · SUPABASE_SECRET_KEY";
    expect(await loadEvals()).toEqual({ source: "evals", weekly: [], rows: [], error: expect.stringContaining("SUPABASE_URL") });
    db.throwOnGet = null;
    query.limit.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await loadEvals()).toEqual({ source: "evals", weekly: [], rows: [], error: "fetch failed" });
  });
});

describe("evals 요약", () => {
  it("지표 줄은 표 순서대로, 잰 지표만, 기준과 비교한 ok 가 붙는다", () => {
    const lines = metricLines(row({ rates: { latency: { pass: 19, total: 19, rate: 1 }, intent: { pass: 14, total: 19, rate: 14 / 19 }, judge: { pass: 0, total: 0, rate: null } } }));
    expect(lines.map((l) => [l.label, l.ok])).toEqual([
      ["의도 일치", false],
      ["55초 안", true],
    ]);
    expect(lines[0]).toMatchObject({ metric: "intent", pass: 14, total: 19, threshold: 0.8 });
  });

  it("기준 안 지표 비율과 미달 지표 이름을 낸다", () => {
    expect(withinRatio(row())).toBe(1);
    expect(withinRatio(row({ rates: { intent: { pass: 10, total: 19, rate: 10 / 19 }, latency: { pass: 19, total: 19, rate: 1 } } }))).toBe(0.5);
    expect(withinRatio(row({ rates: {} }))).toBeNull();
    expect(failedLabels(row({ failed: [{ metric: "intent", rate: 0.5, threshold: 0.8 }, { metric: "unknown", rate: 0, threshold: 1 }] }))).toEqual(["의도 일치", "unknown"]);
  });
});
