import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";
import { FAILURE_LIMIT, loadRuns, summarizeRuns, WINDOW_DAYS, type RunRow } from "./admin";
import { ADMIN_CHALLENGE, adminEnabled, isAdminAuthorized } from "./admin-auth";
import { sampleRuns } from "./admin.sample";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
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

describe("summarizeRuns", () => {
  it("기간 밖 · Mock · 진행 중(2분 안의 started) 줄은 빼고, 호출 제한은 성공률에서 따로 센다", () => {
    const s = summarizeRuns(
      [
        run(),
        run({ at: ago(WINDOW_DAYS * 24 * 60 + 5) }),
        run({ mock: true }),
        run({ ok: false, stage: "started", ms: 0, at: ago(1) }),
        run({ ok: false, stage: "limited", ms: 5, input: null }),
        run({ ok: false, stage: "agent", error: "조사 시간이 초과되었습니다." }),
      ],
      NOW,
    );
    expect(s).toMatchObject({ total: 2, ok: 1, failed: 1, limited: 1, mock: 1 });
  });

  it("2분이 지나도 started 로 남은 줄은 끝난 기록 없는 실패로 센다", () => {
    const s = summarizeRuns([run({ ok: false, stage: "started", ms: 0, at: ago(3) })], NOW);
    expect(s.failed).toBe(1);
    expect(s.failures[0]).toMatchObject({ stage: "started", error: "시작만 기록되고 끝난 기록이 없습니다" });
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
      { tool: "get_korean_economic_news", calls: 2, ok: 1, avgMs: 500 },
      { tool: "get_fx_krw_rate", calls: 1, ok: 1, avgMs: 500 },
    ]);
  });

  it("최근 실패는 최신순으로 정해진 개수만, 긴 질문 · 오류는 자른다", () => {
    const fails = Array.from({ length: FAILURE_LIMIT + 2 }, (_, i) =>
      run({ id: `f${i}`, ok: false, stage: "agent", at: ago(100 - i), error: "x".repeat(300), input: { question: "q".repeat(120), depth: "standard" } }),
    );
    const s = summarizeRuns(fails, NOW);
    expect(s.failures).toHaveLength(FAILURE_LIMIT);
    expect(s.failures[0]!.id).toBe(`f${FAILURE_LIMIT + 1}`);
    expect(s.failures[0]!.question).toHaveLength(81);
    expect(s.failures[0]!.error).toHaveLength(161);
  });

  it("기록이 없으면 숫자는 null, 목록은 비어 있다", () => {
    expect(summarizeRuns([], NOW)).toMatchObject({ total: 0, time: null, tokens: null, verification: null, byDepth: [], tools: [], failures: [], intents: [] });
  });
});

describe("예시 데이터", () => {
  it("같은 now 면 같은 값이고 모두 최근 7일 안이다", () => {
    const rows = sampleRuns(NOW);
    expect(rows).toEqual(sampleRuns(NOW));
    expect(rows).toHaveLength(46);
    expect(summarizeRuns(rows, NOW).total + summarizeRuns(rows, NOW).limited + summarizeRuns(rows, NOW).mock).toBe(46);
  });

  it("화면의 모든 칸이 채워지도록 성공 · 실패 · 호출 제한 · Mock · 멈춘 요청 · tool 실패가 섞여 있다", () => {
    const s = summarizeRuns(sampleRuns(NOW), NOW);
    expect(s.ok).toBeGreaterThan(30);
    expect(s.limited).toBe(1);
    expect(s.mock).toBe(2);
    expect(new Set(s.failures.map((f) => f.stage))).toEqual(new Set(["agent", "input", "started"]));
    // 범위 밖 질문은 2초 안에 끝나므로 조사 중 실패로 두지 않습니다
    expect(sampleRuns(NOW).filter((r) => r.stage === "agent").every((r) => r.intent !== "out_of_scope")).toBe(true);
    expect(s.byDepth.map((d) => d.depth)).toEqual(["easy", "standard", "deep"]);
    expect(s.verification!.pass).toBeLessThan(s.verification!.checked);
    expect(s.tools.some((t) => t.ok < t.calls)).toBe(true);
  });

  it("runs 표 연결 전이라 loadRuns 는 예시 데이터를 돌려준다", async () => {
    const loaded = await loadRuns(NOW);
    expect(loaded.source).toBe("sample");
    expect(loaded.rows).toEqual(sampleRuns(NOW));
  });
});
