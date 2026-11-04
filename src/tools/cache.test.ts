import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAge } from "../lib/age";
import { CACHE_MAX_AGE_MS, MEMORY_MAX, PRUNE_EVERY_MS, cacheKey, clearToolCache, recall, remember } from "./cache";
import type { ToolResult } from "./types";

type Row = { key: string; tool: string; at: string; result: unknown };

// Supabase 는 부르지 않고, tool_cache 표를 Map 으로 흉내 냅니다 (update … eq … lt … select / upsert(ignoreDuplicates) / delete … lt / select … eq … maybeSingle)
const db = vi.hoisted(() => {
  const state = { enabled: false, rows: new Map<string, Row>(), throwNext: null as Error | null, slowMs: 0 };
  const calls: string[] = [];
  const settle = async <T,>(v: T): Promise<T> => {
    if (state.throwNext) {
      const e = state.throwNext;
      state.throwNext = null;
      throw e;
    }
    if (state.slowMs) await new Promise((r) => setTimeout(r, state.slowMs));
    return v;
  };
  const from = () => ({
    update: (row: Row) => ({
      eq: (_c: string, key: string) => ({
        lt: (_c2: string, at: string) => ({
          select: () => {
            calls.push("update");
            const cur = state.rows.get(key);
            if (cur && cur.at < at) {
              state.rows.set(key, row);
              return settle({ data: [{ key }], error: null });
            }
            return settle({ data: [], error: null });
          },
        }),
      }),
    }),
    upsert: (row: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => ({
      select: () => {
        calls.push(`upsert${opts?.ignoreDuplicates ? ":ignore" : ""}`);
        if (state.rows.has(row.key)) return settle({ data: [], error: null });
        state.rows.set(row.key, row);
        return settle({ data: [{ key: row.key }], error: null });
      },
    }),
    delete: () => ({
      lt: (_c: string, at: string) => {
        calls.push("delete");
        for (const [k, r] of state.rows) if (r.at < at) state.rows.delete(k);
        return settle({ error: null });
      },
    }),
    select: () => ({
      eq: (_c: string, key: string) => ({
        maybeSingle: () => {
          calls.push("select");
          const r = state.rows.get(key);
          return settle({ data: r ? { at: r.at, result: r.result } : null, error: null });
        },
      }),
    }),
  });
  return { state, calls, from };
});
vi.mock("../lib/db", () => ({ dbEnabled: () => db.state.enabled, getDb: () => ({ from: db.from }) }));

const result: ToolResult = { data: { rate: 1392.4 }, source: { name: "Frankfurter", url: "https://api.frankfurter.dev", asOf: "2026-11-04" }, note: "mid-market" };
const input = { currency: "USD" };
const key = cacheKey("get_fx_krw_rate", input);

beforeEach(() => vi.stubEnv("TOOL_CACHE", "1"));
afterEach(() => {
  clearToolCache();
  db.state.enabled = false;
  db.state.rows.clear();
  db.state.throwNext = null;
  db.state.slowMs = 0;
  db.calls.length = 0;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("tool 응답 캐시", () => {
  it("TOOL_CACHE=0 이면 기억도 찾기도 하지 않는다 (테스트 기본값)", async () => {
    vi.stubEnv("TOOL_CACHE", "0");
    await remember("get_fx_krw_rate", input, result);
    vi.stubEnv("TOOL_CACHE", "1");
    expect(await recall("get_fx_krw_rate", input)).toBeNull();
  });

  it("키는 tool 이름 + 입력이고, 입력의 키 순서가 달라도 같다", () => {
    expect(cacheKey("get_fx_krw_rate", { currency: "USD", days: 30 })).toBe(cacheKey("get_fx_krw_rate", { days: 30, currency: "USD" }));
    expect(cacheKey("get_fx_krw_rate", { currency: "USD", days: 30 })).not.toBe(cacheKey("get_fx_krw_rate", { currency: "JPY", days: 30 }));
    expect(cacheKey("a", { x: [1, { b: 2, a: 1 }] })).toBe('a:{"x":[1,{"a":1,"b":2}]}');
  });

  it("기억한 응답을 같은 입력으로 다시 찾고, 24시간이 지나면 없는 것으로 본다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T03:00:00Z"));
    await remember("get_fx_krw_rate", input, result);
    vi.setSystemTime(new Date("2026-11-04T05:00:00Z"));
    expect(await recall("get_fx_krw_rate", input)).toEqual({ result, ageMs: 2 * 60 * 60_000 });
    expect(await recall("get_fx_krw_rate", { currency: "JPY" })).toBeNull();
    vi.setSystemTime(new Date("2026-11-05T03:00:01Z"));
    expect(await recall("get_fx_krw_rate", input)).toBeNull();
    expect(CACHE_MAX_AGE_MS).toBe(24 * 60 * 60_000);
  });

  it("Supabase 가 있으면 표에도 넣고, 메모리에 없을 때 표에서 찾아 온다", async () => {
    db.state.enabled = true;
    await remember("get_fx_krw_rate", input, result);
    expect(db.state.rows.get(key)).toMatchObject({ tool: "get_fx_krw_rate", result });
    // 없던 줄: update 가 0건이라 insert(ignoreDuplicates). 첫 저장 뒤 지난 줄 정리도 한 번
    expect(db.calls).toEqual(["update", "upsert:ignore", "delete"]);

    clearToolCache();
    db.calls.length = 0;
    const hit = await recall("get_fx_krw_rate", input);
    expect(hit?.result).toEqual(result);
    expect(hit?.ageMs).toBeLessThan(5_000);
    // 메모리에 있어도 다른 인스턴스가 더 새 응답을 넣었는지 표를 한 번 더 본다 (폴백 때만 도는 길이라 비용은 작음)
    expect((await recall("get_fx_krw_rate", input))?.result).toEqual(result);
    expect(db.calls).toEqual(["select", "select"]);
  });

  it("표에 더 새 응답이 있으면 덮어쓰지 않고, 오래된 것이면 바꾼다", async () => {
    db.state.enabled = true;
    const newer = new Date(Date.now() + 60_000).toISOString();
    db.state.rows.set(key, { key, tool: "get_fx_krw_rate", at: newer, result: { ...result, data: { rate: 9 } } });
    await remember("get_fx_krw_rate", input, result);
    expect(db.state.rows.get(key)?.at).toBe(newer);

    const older = new Date(Date.now() - 60_000).toISOString();
    db.state.rows.set(key, { key, tool: "get_fx_krw_rate", at: older, result: { ...result, data: { rate: 9 } } });
    await remember("get_fx_krw_rate", input, result);
    expect(db.state.rows.get(key)?.result).toEqual(result);
    expect((db.state.rows.get(key)?.at ?? "") > older).toBe(true);
  });

  it("처음 넣는 사이에 다른 인스턴스가 먼저 넣었으면(insert 무시) 조건부 update 를 한 번 더 해 더 새 응답이 남는다", async () => {
    db.state.enabled = true;
    const older = { key, tool: "get_fx_krw_rate", at: new Date(Date.now() - 60_000).toISOString(), result: { ...result, data: { rate: 9 } } };
    // 첫 update 는 줄이 없어 0건 → 그 직후 다른 인스턴스가 오래된 줄을 넣음 → 우리 insert 는 무시됨 → 두 번째 update 가 이김
    let firstUpdate = true;
    const origFrom = db.from;
    const from = () => {
      const b = origFrom();
      const update = b.update;
      b.update = (row: Row) => {
        if (firstUpdate) {
          firstUpdate = false;
          const r = update(row);
          queueMicrotask(() => db.state.rows.set(key, older));
          return r;
        }
        return update(row);
      };
      return b;
    };
    db.from = from;
    try {
      await remember("get_fx_krw_rate", input, result);
    } finally {
      db.from = origFrom;
    }
    expect(db.state.rows.get(key)?.result).toEqual(result);
    expect(db.calls).toEqual(["update", "upsert:ignore", "update", "delete"]);
  });

  it("24시간 지난 줄은 한 시간에 한 번 지운다", async () => {
    db.state.enabled = true;
    const stale = new Date(Date.now() - CACHE_MAX_AGE_MS - 60_000).toISOString();
    db.state.rows.set("old", { key: "old", tool: "x", at: stale, result });
    await remember("get_fx_krw_rate", input, result);
    expect(db.state.rows.has("old")).toBe(false);
    db.state.rows.set("old2", { key: "old2", tool: "x", at: stale, result });
    db.calls.length = 0;
    await remember("get_fx_krw_rate", { currency: "JPY" }, result);
    expect(db.state.rows.has("old2")).toBe(true);
    expect(db.calls).not.toContain("delete");
    expect(PRUNE_EVERY_MS).toBe(60 * 60_000);
  });

  it("표가 느리거나 실패해도 기다리지 않는다: 저장은 메모리에만, 찾기는 없는 것으로", async () => {
    db.state.enabled = true;
    db.state.slowMs = 60;
    const t0 = Date.now();
    await remember("get_fx_krw_rate", input, result, { timeoutMs: 20 });
    expect(Date.now() - t0).toBeLessThan(55);
    expect((await recall("get_fx_krw_rate", input))?.result).toEqual(result);

    clearToolCache();
    db.state.rows.set(key, { key, tool: "get_fx_krw_rate", at: new Date().toISOString(), result });
    expect(await recall("get_fx_krw_rate", input, { timeoutMs: 20 })).toBeNull();

    db.state.slowMs = 0;
    db.state.throwNext = new Error("fetch failed");
    await expect(remember("get_fx_krw_rate", { currency: "EUR" }, result)).resolves.toBeUndefined();
    clearToolCache();
    db.state.throwNext = new Error("fetch failed");
    expect(await recall("get_fx_krw_rate", input)).toBeNull();
  });

  it("메모리에 있어도 표에 더 새 응답이 있으면 그것을 쓰고, 표가 더 오래됐거나 실패하면 메모리 것을 쓴다", async () => {
    db.state.enabled = true;
    await remember("get_fx_krw_rate", input, result);
    const newer = { ...result, data: { rate: 1400 } };
    db.state.rows.set(key, { key, tool: "get_fx_krw_rate", at: new Date(Date.now() + 60_000).toISOString(), result: newer });
    expect((await recall("get_fx_krw_rate", input))?.result).toEqual(newer);
    // 가져온 것은 메모리에 두므로, 표가 다시 오래된 것으로 바뀌어도 메모리 것(더 새 것)을 쓴다
    db.state.rows.set(key, { key, tool: "get_fx_krw_rate", at: new Date(Date.now() - 60_000).toISOString(), result });
    expect((await recall("get_fx_krw_rate", input))?.result).toEqual(newer);
    db.state.throwNext = new Error("fetch failed");
    expect((await recall("get_fx_krw_rate", input))?.result).toEqual(newer);
  });

  it("표에서 찾은 것도 24시간이 지났으면 쓰지 않는다", async () => {
    db.state.enabled = true;
    db.state.rows.set(key, { key, tool: "get_fx_krw_rate", at: new Date(Date.now() - 2 * CACHE_MAX_AGE_MS).toISOString(), result });
    expect(await recall("get_fx_krw_rate", input)).toBeNull();
  });

  it("메모리는 상한을 넘기면 만료된 것부터, 그래도 넘으면 오래된 것부터 버린다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
    // 만료될 것 하나를 먼저
    await remember("get_korean_economic_news", { q: "expired" }, result);
    vi.setSystemTime(new Date("2026-11-05T01:00:00Z"));
    for (let i = 0; i < MEMORY_MAX; i++) {
      vi.setSystemTime(new Date(Date.parse("2026-11-05T01:00:00Z") + i * 1000));
      await remember("get_korean_economic_news", { q: `q${i}` }, result);
    }
    // 상한 + 1 → 만료된 것이 빠져 상한에 맞음
    expect(await recall("get_korean_economic_news", { q: "expired" })).toBeNull();
    expect(await recall("get_korean_economic_news", { q: "q0" })).not.toBeNull();
    // 하나 더 → 가장 오래된 q0 가 빠짐
    vi.setSystemTime(new Date("2026-11-05T02:00:00Z"));
    await remember("get_korean_economic_news", { q: "newest" }, result);
    expect(await recall("get_korean_economic_news", { q: "q0" })).toBeNull();
    expect(await recall("get_korean_economic_news", { q: "q1" })).not.toBeNull();
    expect(await recall("get_korean_economic_news", { q: "newest" })).not.toBeNull();
  });

  it("나이는 분 · 시간 · 일로 읽는다", () => {
    expect(formatAge(20_000)).toBe("1분");
    expect(formatAge(7 * 60_000)).toBe("7분");
    expect(formatAge(3 * 60 * 60_000)).toBe("3시간");
    expect(formatAge(26 * 60 * 60_000)).toBe("1일");
  });
});
