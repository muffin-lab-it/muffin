import { describe, expect, it } from "vitest";
import type { ToolStep } from "../../src/agent/context";
import { confirmPersisted, outcomeOf, parseKey, selectRows, summarize, warmRows, type CacheRow, type WarmResult } from "./warm";

const row = (tool: string, input: unknown, minutesAgo: number, now = Date.parse("2026-11-04T12:00:00Z")): CacheRow => ({
  key: `${tool}:${JSON.stringify(input)}`,
  tool,
  at: new Date(now - minutesAgo * 60_000).toISOString(),
});

describe("캐시 예열", () => {
  it("키에서 입력을 되살리고, 모양이 다르면 throw", () => {
    expect(parseKey(row("get_fx_krw_rate", { currency: "USD", days: 30 }, 1))).toEqual({ currency: "USD", days: 30 });
    expect(() => parseKey({ key: "x", tool: "get_fx_krw_rate", at: "" })).toThrow("키 모양");
  });

  it("오래된 것만 고르고, seed 가 없으면 오래된 순, seed 가 있고 상한을 넘으면 섞어서 실행마다 다른 줄이 걸린다", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    const rows = [row("a", 1, 5, now), row("b", 2, 90, now), row("c", 3, 40, now), row("d", 4, 200, now)];
    expect(selectRows(rows, { olderThanMs: 30 * 60_000, max: 2, now }).map((r) => r.tool)).toEqual(["d", "b"]);
    expect(selectRows(rows, { olderThanMs: 0, max: 10, now }).map((r) => r.tool)).toEqual(["d", "b", "c", "a"]);
    // 상한 안이면 섞지 않는다
    expect(selectRows(rows, { olderThanMs: 0, max: 10, now, seed: 7 }).map((r) => r.tool)).toEqual(["d", "b", "c", "a"]);
    const many = Array.from({ length: 40 }, (_, i) => row(`t${i}`, i, 60 + i, now));
    const a = selectRows(many, { olderThanMs: 0, max: 10, now, seed: 1 }).map((r) => r.tool);
    const b = selectRows(many, { olderThanMs: 0, max: 10, now, seed: 2 }).map((r) => r.tool);
    expect(a).toHaveLength(10);
    expect(selectRows(many, { olderThanMs: 0, max: 10, now, seed: 1 }).map((r) => r.tool)).toEqual(a);
    expect(a).not.toEqual(b);
    expect(new Set([...a, ...b]).size).toBeGreaterThan(10);
  });

  it("갱신으로 끝난 줄은 표의 at 이 실제로 앞으로 갔을 때만 갱신이고, 아니면 '표 저장 안 됨'", () => {
    const results: WarmResult[] = [
      { key: "k1", tool: "a", input: {}, outcome: "refreshed", ms: 1 },
      { key: "k2", tool: "a", input: {}, outcome: "refreshed", ms: 1 },
      { key: "k3", tool: "a", input: {}, outcome: "fallback", ms: 1 },
    ];
    const before = new Map([["k1", "2026-11-04T10:00:00Z"], ["k2", "2026-11-04T10:00:00Z"], ["k3", "2026-11-04T10:00:00Z"]]);
    const after = new Map([["k1", "2026-11-04T12:00:00Z"], ["k2", "2026-11-04T10:00:00Z"], ["k3", "2026-11-04T10:00:00Z"]]);
    expect(confirmPersisted(results, before, after).map((r) => r.outcome)).toEqual(["refreshed", "not_persisted", "fallback"]);
  });

  it("실행 기록을 결과로 읽는다: 갱신 · 저장 응답 유지 · 회로 열림 · 실패", () => {
    expect(outcomeOf({ tool: "t", status: "ok", ms: 1 })).toEqual({ outcome: "refreshed" });
    expect(outcomeOf({ tool: "t", status: "ok", ms: 1, fallbackAgeMs: 3 * 60 * 60_000 })).toEqual({ outcome: "fallback", detail: "3시간 전 응답 유지" });
    expect(outcomeOf({ tool: "t", status: "ok", ms: 1, fallbackAgeMs: 60_000, breaker: "open" })).toMatchObject({ outcome: "skipped" });
    expect(outcomeOf({ tool: "t", status: "error", ms: 1, error: "HTTP 503" })).toEqual({ outcome: "failed", detail: "HTTP 503" });
    expect(outcomeOf(undefined)).toMatchObject({ outcome: "failed" });
  });

  it("줄들을 동시에 돌리고 결과 순서는 입력 순서, 모르는 tool · throw 도 결과로 남긴다", async () => {
    const rows = [row("get_fx_krw_rate", { currency: "USD", days: 30 }, 60), row("ghost_tool", { q: 1 }, 60), row("get_etf_kr_price", { query: "KODEX 200", days: 30 }, 60), { key: "broken", tool: "get_fx_krw_rate", at: "2026-11-04T00:00:00Z" }];
    let running = 0;
    let peak = 0;
    const invoke = async (tool: string, input: unknown): Promise<ToolStep | "unknown_tool"> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      if (tool === "ghost_tool") return "unknown_tool";
      if (tool === "get_etf_kr_price") throw new Error("boom");
      return { tool, status: "ok", ms: 5, ...(JSON.stringify(input).includes("USD") ? {} : { fallbackAgeMs: 1 }) };
    };
    const results = await warmRows(rows, invoke, 2);
    expect(results.map((r) => r.outcome)).toEqual(["refreshed", "unknown_tool", "failed", "failed"]);
    expect(results[2]?.detail).toBe("boom");
    expect(results[3]?.detail).toContain("키 모양");
    expect(peak).toBeLessThanOrEqual(2);

    const text = summarize(results, { total: 10, picked: 4 });
    expect(results.map((r) => r.key)).toEqual(rows.map((r) => r.key));
    expect(text).toContain("표 10줄 중 4줄 시도 → 갱신 1 · 받았지만 표 저장 안 됨 0 · 실패(저장 응답 유지) 0 · 건너뜀(회로 열림) 0 · 실패(저장 응답 없음) 2 · 모르는 tool 1");
    expect(text).toContain("| ghost_tool |");
  });
});
