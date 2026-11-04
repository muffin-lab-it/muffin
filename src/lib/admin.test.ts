import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";
import { EVENT_LIMIT, healthOf, loadRuns, MAX_PAGES, PAGE, parseRange, RUN_COLUMNS, summarizeRuns, windowStats, type RunRow } from "./admin";

// loadRuns 는 db.ts 로 runs 표를 읽습니다. 여기서는 Supabase 를 부르지 않고 조회 체인(from → select → gte → lte → [or] → order → order → limit)을 흉내 냅니다.
const db = vi.hoisted(() => ({ enabled: vi.fn(() => false), from: vi.fn(), pages: [] as { data: unknown[] | null; error: { message: string } | null }[] }));
vi.mock("./db", () => ({ dbEnabled: db.enabled, getDb: () => ({ from: db.from }) }));
const query = { select: vi.fn(), gte: vi.fn(), lte: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn() };
query.select.mockReturnValue(query);
query.gte.mockReturnValue(query);
query.lte.mockReturnValue(query);
query.or.mockReturnValue(query);
query.order.mockReturnValue(query);
query.limit.mockImplementation(async () => db.pages.shift() ?? { data: [], error: null });
db.from.mockReturnValue(query);
import { ADMIN_CHALLENGE, adminEnabled, isAdminAuthorized } from "./admin-auth";
import { sampleRuns } from "./admin.sample";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
/** 한국 시간 2026-11-02 12:00 */
const NOW = new Date("2026-11-02T03:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const verification = (status: "pass" | "partial" | "skipped", total: number, unverified = 0, revisions = 0, advice = 0) => ({
  status,
  numbers: { total, verified: total - unverified, derived: 0, reported: 0, unverified },
  advice,
  revisions,
});
let seq = 0;
const run = (over: Partial<RunRow> = {}): RunRow => ({
  id: `r${++seq}`,
  at: ago(10),
  ok: true,
  stage: "ok",
  mock: false,
  ms: 20_000,
  input: { question: "환율 왜 올랐어?", depth: "standard", area: "fx" },
  ...over,
});
const many = (n: number, over: Partial<RunRow> = {}) => Array.from({ length: n }, () => run(over));

describe("관리자 비밀번호 (Basic 인증)", () => {
  it("비밀번호가 같으면 통과하고 아이디는 보지 않는다", () => {
    expect(isAdminAuthorized(basic("admin", "muffin-pw"), "muffin-pw")).toBe(true);
    expect(isAdminAuthorized(basic("", "muffin-pw"), "muffin-pw")).toBe(true);
    expect(isAdminAuthorized(basic("아무나", "pw:with:colon"), "pw:with:colon")).toBe(true);
  });

  it("틀린 비밀번호, Basic 이 아닌 헤더, 헤더 없음, 콜론 없음은 막는다", () => {
    expect(isAdminAuthorized(basic("admin", "wrong"), "muffin-pw")).toBe(false);
    expect(isAdminAuthorized("Bearer muffin-pw", "muffin-pw")).toBe(false);
    expect(isAdminAuthorized(null, "muffin-pw")).toBe(false);
    expect(isAdminAuthorized(`Basic ${Buffer.from("muffin-pw").toString("base64")}`, "muffin-pw")).toBe(false);
  });

  it("ADMIN_PASSWORD 가 비어 있으면 누구도 통과하지 못한다", () => {
    expect(adminEnabled("")).toBe(false);
    expect(isAdminAuthorized(basic("admin", ""), "")).toBe(false);
    expect(isAdminAuthorized(basic("admin", ""), undefined)).toBe(false);
  });
});

describe("proxy (/admin 앞단)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const request = (authorization?: string) =>
    new Request("http://localhost:3000/admin", { headers: authorization ? { authorization } : {} }) as unknown as NextRequest;

  it("ADMIN_PASSWORD 가 없으면 404 로 관리자 화면이 없는 것처럼 보인다", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(proxy(request(basic("admin", "")))?.status).toBe(404);
  });

  it("비밀번호가 없거나 틀리면 401 과 로그인 창 헤더를 돌려준다", () => {
    vi.stubEnv("ADMIN_PASSWORD", "muffin-pw");
    for (const res of [proxy(request()), proxy(request(basic("admin", "wrong")))]) {
      expect(res?.status).toBe(401);
      expect(res?.headers.get("WWW-Authenticate")).toBe(ADMIN_CHALLENGE);
    }
  });

  it("비밀번호가 맞으면 응답 없이 페이지로 넘긴다", () => {
    vi.stubEnv("ADMIN_PASSWORD", "muffin-pw");
    expect(proxy(request(basic("admin", "muffin-pw")))).toBeUndefined();
  });

  it("/admin 과 그 아래 경로에만 걸린다", () => {
    expect(config.matcher).toEqual(["/admin", "/admin/:path*"]);
  });
});

describe("기간", () => {
  it("24h · 7d 만 받고 나머지는 7일", () => {
    expect(parseRange("24h")).toBe("24h");
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange(undefined)).toBe("7d");
    expect(parseRange("30d")).toBe("7d");
    expect(parseRange(["24h", "7d"])).toBe("7d");
  });

  it("24시간을 고르면 그 안의 줄만 센다", () => {
    const rows = [run({ at: ago(60) }), run({ at: ago(23 * 60) }), run({ at: ago(25 * 60) })];
    expect(summarizeRuns(rows, NOW, "24h").total).toBe(2);
    expect(summarizeRuns(rows, NOW, "7d").total).toBe(3);
  });
});

describe("summarizeRuns", () => {
  it("기간 밖 · Mock · 진행 중(2분 안의 started) 줄은 빼고, 호출 제한은 성공률에서 따로 센다", () => {
    const s = summarizeRuns(
      [
        run(),
        run({ at: ago(7 * 24 * 60 + 5) }),
        run({ mock: true }),
        run({ ok: false, stage: "started", ms: 0, at: ago(1) }),
        run({ ok: false, stage: "limited", ms: 5, input: null }),
        run({ ok: false, stage: "agent", error: "조사 시간이 초과되었습니다." }),
      ],
      NOW,
    );
    expect(s).toMatchObject({ total: 2, ok: 1, failed: 1, limited: 1, mock: 1 });
  });

  it("응답 시간은 리포트를 만든 요청(성공, 범위 밖 제외)으로 평균 · 90% 와 깊이별로 낸다", () => {
    const ms = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000];
    const s = summarizeRuns(
      [
        ...ms.map((m) => run({ ms: m })),
        run({ ms: 12_000, input: { question: "여행", depth: "easy" } }),
        run({ ms: 2_000, intent: "out_of_scope" }),
        run({ ok: false, stage: "agent", ms: 55_000 }),
      ],
      NOW,
    );
    expect(s.time).toEqual({ count: 11, avgMs: 51_091, p90Ms: 90_000 });
    expect(s.byDepth).toEqual([
      { depth: "easy", count: 1, avgMs: 12_000, p90Ms: 12_000 },
      { depth: "standard", count: 10, avgMs: 55_000, p90Ms: 90_000 },
    ]);
    expect(s.points).toHaveLength(11);
  });

  it("토큰은 리포트를 만든 요청당 평균이다", () => {
    const s = summarizeRuns(
      [
        run({ usage: { requests: 5, inputTokens: 20_000, outputTokens: 3_000 } }),
        run({ usage: { requests: 6, inputTokens: 30_001, outputTokens: 4_000 } }),
        run({ intent: "out_of_scope", usage: { requests: 1, inputTokens: 1_900, outputTokens: 150 } }),
        run({ ok: false, stage: "agent", usage: { requests: 9, inputTokens: 99_999, outputTokens: 9_999 } }),
      ],
      NOW,
    );
    expect(s.tokens).toEqual({ input: 25_001, output: 3_500 });
  });

  it("검증은 범위 밖과 skipped 를 빼고 통과 · 다시 쓰기 · 확인 못 한 숫자 · 권유 표현을 센다", () => {
    const s = summarizeRuns(
      [
        run({ intent: "cause", verification: verification("pass", 4) }),
        run({ intent: "cause", verification: verification("partial", 3, 1, 1) }),
        run({ intent: "status", verification: verification("pass", 2, 0, 1, 1) }),
        run({ intent: "out_of_scope", verification: verification("pass", 0) }),
        run({ verification: verification("skipped", 2) }),
        run({ verification: null, rewrites: 1 }),
      ],
      NOW,
    );
    expect(s.verification).toEqual({ checked: 3, pass: 2, rewritten: 2, numbers: 9, unverified: 1, advice: 1 });
    expect(s.intents).toEqual([
      { intent: "cause", count: 2 },
      { intent: "out_of_scope", count: 1 },
      { intent: "status", count: 1 },
    ]);
  });

  it("tool 별 호출 · 성공 · 평균 시간을 호출이 많은 순으로 낸다", () => {
    const s = summarizeRuns(
      [
        run({ steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 500 }, { tool: "get_korean_economic_news", status: "error", ms: 300, error: "본문 없음" }] }),
        run({ steps: [{ tool: "get_korean_economic_news", status: "ok", ms: 700 }] }),
      ],
      NOW,
    );
    expect(s.tools).toEqual([
      { tool: "get_korean_economic_news", calls: 2, ok: 1, live: 1, fallbacks: 0, skipped: 0, avgMs: 500, lastFailAt: s.tools[0]!.lastFailAt, lastFail: "본문 없음" },
      { tool: "get_fx_krw_rate", calls: 1, ok: 1, live: 1, fallbacks: 0, skipped: 0, avgMs: 500 },
    ]);
  });

  it("저장 응답으로 나간 호출은 ok 에는 들지만 live 에는 안 들고, 회로 열림은 따로 세며, 상태등은 live 비율로 본다", () => {
    const s = summarizeRuns(
      [
        run({ at: ago(5), steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 3, fallbackAgeMs: 2 * 60 * 60_000, breaker: "open" }] }),
        run({ at: ago(50), steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 1_800, fallbackAgeMs: 60_000 }] }),
        run({ at: ago(90), steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 600 }] }),
      ],
      NOW,
    );
    // 5분 전 호출은 회로가 열려 건너뛴 것이라 "마지막 실패" 는 실제로 조회해 본 50분 전
    expect(s.tools[0]).toEqual({ tool: "get_fx_krw_rate", calls: 3, ok: 3, live: 1, fallbacks: 2, skipped: 1, avgMs: 801, lastFailAt: ago(50), lastFail: "조회 실패 · 1분 전 저장 응답 사용" });
    expect(healthOf(s).tools).toEqual({ get_fx_krw_rate: "bad" });
    expect(s.events.map((e) => e.detail)).toEqual(["회로 열림(호출 생략) · 2시간 전 응답 사용", "조회 실패 · 1분 전 응답 사용"]);
  });

  it("windowStats 는 최근 한 시간의 요청 · 성공 · 리포트 평균 응답을 낸다 (Mock · 호출 제한 · 범위 밖 제외)", () => {
    const rows = [
      run({ at: ago(10), ms: 20_000 }),
      run({ at: ago(20), ms: 30_000 }),
      run({ at: ago(30), ok: false, stage: "agent" }),
      run({ at: ago(40), stage: "limited", ok: false }),
      run({ at: ago(45), mock: true }),
      run({ at: ago(50), intent: "out_of_scope", ms: 2_000 }),
      run({ at: ago(70), ms: 40_000 }),
    ];
    expect(windowStats(rows, NOW)).toEqual({ total: 4, ok: 3, avgMs: 25_000 });
    expect(windowStats([], NOW)).toEqual({ total: 0, ok: 0, avgMs: null });
  });

  it("막대는 한국 시간 정각 경계로 자르고 마지막 칸이 지금을 포함한다 (24시간 = 1시간 칸 25개)", () => {
    const s = summarizeRuns(
      [run({ at: ago(10), ms: 30_000 }), run({ at: ago(70), ok: false, stage: "agent" }), run({ at: ago(70), ok: false, stage: "limited" })],
      NOW,
      "24h",
    );
    expect(s.bucketMs).toBe(60 * 60_000);
    expect(s.buckets).toHaveLength(25);
    expect(s.buckets[0]!.start).toBe("2026-11-01T03:00:00.000Z");
    expect(s.buckets.at(-1)!.start).toBe("2026-11-02T03:00:00.000Z");
    expect(s.buckets[23]).toMatchObject({ ok: 1, failed: 0, limited: 0, avgMs: 30_000 });
    expect(s.buckets[22]).toMatchObject({ ok: 0, failed: 1, limited: 1, avgMs: null });
  });

  it("7일은 6시간 칸 29개이고 칸 경계가 한국 시간 0 · 6 · 12 · 18시다", () => {
    const s = summarizeRuns([run()], NOW, "7d");
    expect(s.buckets).toHaveLength(29);
    for (const b of s.buckets) expect((new Date(b.start).getUTCHours() + 9) % 6).toBe(0);
    expect(s.buckets.reduce((sum, b) => sum + b.ok, 0)).toBe(1);
  });

  it("이벤트는 실패 · 멈춤 · 호출 제한 · tool 실패를 최신순으로 모으고 길이 · 글자를 자른다", () => {
    const s = summarizeRuns(
      [
        run({ id: "agent", at: ago(5), ok: false, stage: "agent", error: "x".repeat(300), input: { question: "q".repeat(120), depth: "standard" } }),
        run({ id: "stale", at: ago(30), ok: false, stage: "started", ms: 0 }),
        run({ id: "limited", at: ago(40), ok: false, stage: "limited", ms: 5, error: "브라우저 키 10분 한도" }),
        run({ id: "tool", at: ago(50), steps: [{ tool: "get_korean_economic_news", status: "error", ms: 300, error: "본문 없음" }] }),
        ...many(EVENT_LIMIT, { at: ago(600), ok: false, stage: "agent", error: "오래된 실패" }),
      ],
      NOW,
    );
    expect(s.events).toHaveLength(EVENT_LIMIT);
    expect(s.events.slice(0, 4).map((e) => [e.id, e.level, e.kind])).toEqual([
      ["agent", "bad", "agent"],
      ["stale", "warn", "started"],
      ["limited", "info", "limited"],
      ["tool:0", "warn", "tool"],
    ]);
    expect(s.events[0]!.question).toHaveLength(81);
    expect(s.events[0]!.detail).toHaveLength(161);
    expect(s.events[1]!.detail).toBe("시작만 기록되고 끝난 기록이 없습니다");
    expect(s.events[3]).toMatchObject({ tool: "get_korean_economic_news", detail: "본문 없음" });
  });

  it("기록이 없으면 숫자는 null, 목록은 비어 있고 막대는 0 으로 채워진다", () => {
    const s = summarizeRuns([], NOW);
    expect(s).toMatchObject({ total: 0, time: null, tokens: null, verification: null, byDepth: [], tools: [], events: [], intents: [], points: [] });
    expect(s.buckets.every((b) => b.ok + b.failed + b.limited === 0)).toBe(true);
  });
});

describe("healthOf (상태등)", () => {
  const ok = (n: number, over: Partial<RunRow> = {}) => many(n, { verification: verification("pass", 3), ...over });
  const fail = (n: number) => many(n, { ok: false, stage: "agent", error: "실패" });

  it("성공률은 95% 이상 정상, 85% 이상 주의, 그 아래 장애", () => {
    expect(healthOf(summarizeRuns(ok(20), NOW))).toMatchObject({ overall: "ok", success: "ok" });
    expect(healthOf(summarizeRuns([...ok(18), ...fail(2)], NOW))).toMatchObject({ overall: "warn", success: "warn" });
    expect(healthOf(summarizeRuns([...ok(16), ...fail(4)], NOW))).toMatchObject({ overall: "bad", success: "bad" });
  });

  it("p90 응답 시간은 45초 안(이하)이면 정상, 예산 55초 안(이하)이면 주의, 넘으면 장애", () => {
    expect(healthOf(summarizeRuns(ok(10, { ms: 45_000 }), NOW)).latency).toBe("ok");
    expect(healthOf(summarizeRuns(ok(10, { ms: 50_000 }), NOW)).latency).toBe("warn");
    expect(healthOf(summarizeRuns(ok(10, { ms: 55_000 }), NOW)).latency).toBe("warn");
    expect(healthOf(summarizeRuns(ok(10, { ms: 56_000 }), NOW))).toMatchObject({ overall: "bad", latency: "bad" });
  });

  it("권유 표현이 하나라도 남으면 장애, 검증 통과율이 낮으면 전체는 주의까지만", () => {
    expect(healthOf(summarizeRuns([...ok(9), run({ verification: verification("pass", 3, 0, 0, 1) })], NOW))).toMatchObject({ overall: "bad", advice: "bad" });
    const lowPass = [...ok(7), ...many(3, { verification: verification("partial", 3, 1) })];
    expect(healthOf(summarizeRuns(lowPass, NOW))).toMatchObject({ overall: "warn", verification: "bad" });
  });

  it("tool 상태는 tool 마다 따로 판정하고 전체 상태에는 넣지 않는다", () => {
    const step = (status: "ok" | "error") => ({ tool: "get_korean_economic_news", status, ms: 300 });
    const rows = [...ok(8, { steps: [step("ok")] }), ...ok(2, { steps: [step("error")] })];
    expect(healthOf(summarizeRuns(rows, NOW))).toMatchObject({ overall: "ok", tools: { get_korean_economic_news: "bad" } });
  });

  it("기록이 없으면 모두 기록 없음", () => {
    expect(healthOf(summarizeRuns([], NOW))).toMatchObject({ overall: "idle", success: "idle", latency: "idle", advice: "idle" });
  });
});

describe("예시 데이터", () => {
  it("같은 now 면 같은 값이고 모두 최근 7일 안이다", () => {
    const rows = sampleRuns(NOW);
    expect(rows).toEqual(sampleRuns(NOW));
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => NOW.getTime() - Date.parse(r.at) < 7 * 24 * 60 * 60_000)).toBe(true);
  });

  it("화면의 모든 칸이 채워지도록 성공 · 실패 · 호출 제한 · Mock · 멈춘 요청 · tool 실패가 섞여 있다", () => {
    const rows = sampleRuns(NOW);
    const s = summarizeRuns(rows, NOW);
    expect(s.ok / s.total).toBeGreaterThan(0.8);
    expect(s.limited).toBeGreaterThan(0);
    expect(s.mock).toBeGreaterThan(0);
    expect(new Set(rows.filter((r) => !r.ok).map((r) => r.stage))).toEqual(new Set(["agent", "input", "started", "limited"]));
    expect(s.byDepth.map((d) => d.depth)).toEqual(["easy", "standard", "deep"]);
    expect(s.verification!.pass).toBeLessThan(s.verification!.checked);
    expect(s.tools.some((t) => t.ok < t.calls)).toBe(true);
    // 범위 밖 질문은 2초 안에 끝나므로 조사 중 실패 · 멈춤으로 두지 않습니다
    expect(rows.filter((r) => r.stage === "agent" || r.stage === "started").every((r) => r.intent !== "out_of_scope")).toBe(true);
    // 최근 24시간에도 막대가 비지 않을 만큼 있습니다
    expect(summarizeRuns(rows, NOW, "24h").total).toBeGreaterThan(10);
  });

});

describe("loadRuns (runs 표 조회)", () => {
  afterEach(() => {
    db.enabled.mockReturnValue(false);
    db.pages = [];
    db.from.mockClear();
    for (const fn of Object.values(query)) fn.mockClear();
  });

  it("Supabase 환경 변수가 없으면 예시 데이터(no-db)이고 DB 를 부르지 않는다", async () => {
    const loaded = await loadRuns(NOW);
    expect(loaded).toEqual({ source: "sample", reason: "no-db", rows: sampleRuns(NOW) });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("화면이 예시를 요청하면(?source=sample) DB 가 있어도 예시 데이터(requested)다", async () => {
    db.enabled.mockReturnValue(true);
    const loaded = await loadRuns(NOW, { source: "sample" });
    expect(loaded).toMatchObject({ source: "sample", reason: "requested" });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("runs 표의 최근 7일(끝은 now 로 고정)을 시각 · id 순으로 읽고, client_id · ip_hash 는 읽지 않는다", async () => {
    db.enabled.mockReturnValue(true);
    const rows = [run({ id: "a", at: ago(5) }), run({ id: "b", at: ago(60), ok: false, stage: "agent", error: "timeout" })];
    db.pages = [{ data: rows, error: null }];
    const loaded = await loadRuns(NOW);
    expect(loaded).toEqual({ source: "runs", rows, truncated: false });
    expect(db.from).toHaveBeenCalledWith("runs");
    expect(query.select).toHaveBeenCalledWith(RUN_COLUMNS);
    expect(RUN_COLUMNS).not.toMatch(/client_id|ip_hash/);
    expect(query.gte).toHaveBeenCalledWith("at", new Date(NOW.getTime() - 7 * 24 * 60 * 60_000).toISOString());
    expect(query.lte).toHaveBeenCalledWith("at", NOW.toISOString());
    expect(query.or).not.toHaveBeenCalled();
    expect(query.order).toHaveBeenNthCalledWith(1, "at", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(query.limit).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(PAGE);
  });

  it("한 쪽(1000줄)이 꽉 차면 마지막 줄의 (시각, id) 뒤부터 이어 읽는다 (같은 시각의 줄이 경계에 걸려도 건너뛰지 않음)", async () => {
    db.enabled.mockReturnValue(true);
    // 같은 시각(at)의 줄이 경계에 걸린 경우: 커서가 id 까지 보므로 다음 쪽은 id 가 더 작은 줄부터 온다
    const sameAt = ago(30);
    const first = Array.from({ length: PAGE }, (_, i) => run({ id: `p0-${String(PAGE - i).padStart(4, "0")}`, at: sameAt }));
    const boundary = first[first.length - 1]!;
    db.pages = [{ data: first, error: null }, { data: [run({ id: "p0-0000", at: sameAt }), run({ id: "older", at: ago(PAGE + 5) })], error: null }];
    const loaded = await loadRuns(NOW);
    expect(loaded).toMatchObject({ source: "runs", truncated: false });
    expect(loaded.rows).toHaveLength(PAGE + 2);
    expect(query.or).toHaveBeenCalledTimes(1);
    expect(query.or).toHaveBeenCalledWith(`at.lt."${boundary.at}",and(at.eq."${boundary.at}",id.lt."${boundary.id}")`);
    // 끝 시각은 쪽마다 now 로 고정 (그 사이 들어온 새 줄은 오지 않음)
    expect(query.lte).toHaveBeenCalledTimes(2);
    expect(query.lte).toHaveBeenNthCalledWith(2, "at", NOW.toISOString());
    expect(query.limit).toHaveBeenCalledTimes(2);
  });

  it("상한(10쪽)까지 꽉 찼으면 한 줄을 더 읽어 정말 더 있을 때만 truncated 다", async () => {
    db.enabled.mockReturnValue(true);
    const full = (page: number) => Array.from({ length: PAGE }, (_, i) => run({ id: `p${page}-${i}`, at: ago(page * PAGE + i) }));
    db.pages = [...Array.from({ length: MAX_PAGES }, (_, p) => ({ data: full(p), error: null })), { data: [run({ id: "more" })], error: null }];
    const capped = await loadRuns(NOW);
    expect(capped).toMatchObject({ source: "runs", truncated: true });
    expect(capped.rows).toHaveLength(PAGE * MAX_PAGES);
    expect(query.limit).toHaveBeenCalledTimes(MAX_PAGES + 1);
    expect(query.limit).toHaveBeenLastCalledWith(1);

    query.limit.mockClear();
    db.pages = [...Array.from({ length: MAX_PAGES }, (_, p) => ({ data: full(p), error: null })), { data: [], error: null }];
    const exact = await loadRuns(NOW);
    expect(exact).toMatchObject({ source: "runs", truncated: false });
    expect(exact.rows).toHaveLength(PAGE * MAX_PAGES);
    expect(query.limit).toHaveBeenCalledTimes(MAX_PAGES + 1);
  });

  it("조회 오류는 메시지만 담아 throw 한다 (화면이 안내문으로 보여 줌)", async () => {
    db.enabled.mockReturnValue(true);
    db.pages = [{ data: null, error: { message: "permission denied for table runs" } }];
    await expect(loadRuns(NOW)).rejects.toThrow("runs 표 조회 실패: permission denied for table runs");
  });
});
