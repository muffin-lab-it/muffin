import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEntry } from "./runs";

// Supabase 와 next/server 의 after 는 부르지 않고 흉내 냅니다
const db = vi.hoisted(() => ({ enabled: false, upsert: vi.fn(async (...args: unknown[]) => (args.length ? { error: null as { message: string } | null } : { error: null })), slowMs: 0 }));
vi.mock("./db", () => ({
  dbEnabled: () => db.enabled,
  getDb: () => ({
    from: () => ({
      upsert: (row: unknown, opts: unknown) => (db.slowMs ? new Promise((r) => setTimeout(() => r({ error: null }), db.slowMs)) : db.upsert(row, opts)),
    }),
  }),
}));
const next = vi.hoisted(() => ({ after: vi.fn((cb: () => unknown) => void cb()), throwing: false }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    if (next.throwing) throw new Error("`after` was called outside a request scope");
    return next.after(cb);
  },
}));
const log = vi.hoisted(() => ({ logRun: vi.fn() }));
vi.mock("./log", () => ({ logRun: log.logRun }));

import { pickVerification, recordRun, saveRun } from "./runs";

const entry: RunEntry = {
  id: "run-1",
  at: "2026-11-05T03:00:00.000Z",
  ok: true,
  stage: "ok",
  mock: false,
  input: { question: "환율 왜 올랐어?", depth: "standard", area: "fx" },
  ms: 24_000,
  model: "gpt-6-luna",
  usage: { requests: 4, inputTokens: 18_000, outputTokens: 1_300 },
  steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 800 }],
  rewrites: 0,
  quality: { numbers: 2, why: 2, whyUnsupported: 0, dataGaps: 0, sources: 3 },
  verification: { status: "pass", numbers: { total: 2, verified: 2, derived: 0, reported: 0, unverified: 0 }, why: { data: 2, news: 0, none: 0, unsupported: 0 }, advice: 0, revisions: 0 },
  intent: "cause",
};

beforeEach(() => {
  db.enabled = true;
  db.slowMs = 0;
  next.throwing = false;
});
afterEach(() => vi.clearAllMocks());

describe("runs 저장 (리더 임시 구현)", () => {
  it("RunLog 를 표의 칸 이름으로 바꿔 upsert 하고, 브라우저 id 를 client_id 에 넣는다", async () => {
    await expect(saveRun(entry, { clientId: "6f4e1a2b-1234-4abc-8def-0123456789ab" })).resolves.toBe(true);
    const [row, opts] = db.upsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(opts).toEqual({ onConflict: "id" });
    expect(row).toMatchObject({ id: "run-1", ok: true, stage: "ok", mock: false, client_id: "6f4e1a2b-1234-4abc-8def-0123456789ab", ip_hash: null, ms: 24_000, intent: "cause" });
    expect(row.verification).toEqual(entry.verification);
    expect(row.input).toEqual(entry.input);
    // 없는 칸은 null (undefined 를 보내면 PostgREST 가 거절할 수 있음)
    const [bare] = (await saveRun({ id: "run-2", at: entry.at, ok: false, stage: "input", mock: false, ms: 3, error: "invalid body" }), db.upsert.mock.calls[1] as [Record<string, unknown>]);
    expect(bare).toMatchObject({ client_id: null, input: null, model: null, usage: null, steps: null, rewrites: null, quality: null, verification: null, intent: null, error: "invalid body" });
  });

  it("환경 변수가 없으면 아무것도 안 하고, 표 오류 · 지연은 false 로 끝나며 throw 하지 않는다", async () => {
    db.enabled = false;
    await expect(saveRun(entry)).resolves.toBe(false);
    expect(db.upsert).not.toHaveBeenCalled();
    db.enabled = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.upsert.mockResolvedValueOnce({ error: { message: "relation runs does not exist" } });
    await expect(saveRun(entry)).resolves.toBe(false);
    db.slowMs = 50;
    await expect(saveRun(entry, { timeoutMs: 10 })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("recordRun 은 콘솔 로그를 바로 남기고, 표 저장은 응답 뒤(after)에, after 가 없으면 바로 한다", async () => {
    const req = new Request("http://localhost/api/report", { headers: { "X-Muffin-Client": "6f4e1a2b-1234-4abc-8def-0123456789ab" } });
    recordRun(entry, req);
    expect(log.logRun).toHaveBeenCalledWith(entry);
    expect(next.after).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect((db.upsert.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({ client_id: "6f4e1a2b-1234-4abc-8def-0123456789ab" });

    next.throwing = true;
    recordRun(entry);
    await Promise.resolve();
    await Promise.resolve();
    expect(db.upsert).toHaveBeenCalledTimes(2);
    expect((db.upsert.mock.calls[1] as [Record<string, unknown>])[0]).toMatchObject({ client_id: null });

    db.enabled = false;
    recordRun(entry, req);
    expect(log.logRun).toHaveBeenCalledTimes(3);
    expect(db.upsert).toHaveBeenCalledTimes(2);
  });

  it("pickVerification 은 표에 넣는 칸만 고른다", () => {
    expect(pickVerification({ ...entry.verification!, removed: ["x"], revisionSkipped: true })).toEqual(entry.verification);
  });
});
