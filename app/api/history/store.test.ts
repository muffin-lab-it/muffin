import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeReport } from "@/src/agent/normalize";
import { createFakeDb } from "./fake-db";

const fake = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/src/lib/db", () => ({ getDb: () => fake.current }));

import { deleteReport, findReport, insertReport, listReports, trimReports } from "./store";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const report = normalizeReport({ summary: "테스트", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], sources: [], nextTopics: [] });
const input = { question: "KODEX 200 요즘 어때?", depth: "easy" as const };

let f: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  f = createFakeDb();
  fake.current = f.db;
});

const row = (id: string, client_id: string, created_at: string) => ({ id, client_id, created_at, input, report, steps: [] });

describe("History 저장소", () => {
  it("넣으면 created, 같은 브라우저가 같은 id 를 다시 넣으면 existing(기존 기록 그대로), 다른 브라우저면 conflict", async () => {
    const first = await insertReport({ id: "r1", client_id: A, input, report, steps: [{ tool: "get_etf", status: "ok", ms: 10 }] });
    expect(first).toMatchObject({ status: "created", record: { id: "r1", input, steps: [{ tool: "get_etf" }] } });
    expect(first.status === "created" && first.record.createdAt).toBeTruthy();

    const again = await insertReport({ id: "r1", client_id: A, input: { question: "다른 질문", depth: "deep" }, report, steps: [] });
    expect(again).toEqual({ status: "existing", record: first.status === "created" ? first.record : undefined });

    expect(await insertReport({ id: "r1", client_id: B, input, report, steps: [] })).toEqual({ status: "conflict" });
    expect(f.rows).toHaveLength(1);
  });

  it("고유키 말고 다른 DB 오류는 throw 한다", async () => {
    f.state.failNext = "connection refused";
    await expect(insertReport({ id: "r1", client_id: A, input, report, steps: [] })).rejects.toThrow("reports 저장 실패: connection refused");
  });

  it("조회 · 삭제는 그 브라우저의 기록만 (다른 브라우저 기록은 없음과 같음)", async () => {
    f.rows.push(row("r1", A, "2026-11-05T01:00:00.000Z"));
    expect((await findReport(A, "r1"))?.id).toBe("r1");
    expect(await findReport(B, "r1")).toBeNull();
    expect(await deleteReport(B, "r1")).toBe(false);
    expect(f.rows).toHaveLength(1);
    expect(await deleteReport(A, "r1")).toBe(true);
    expect(await deleteReport(A, "r1")).toBe(false);
    expect(f.rows).toHaveLength(0);
  });

  it("목록은 그 브라우저의 것만 최신순, limit 와 before(다음 페이지)를 따른다", async () => {
    f.rows.push(
      row("old", A, "2026-11-01T00:00:00.000Z"),
      row("mid", A, "2026-11-02T00:00:00.000Z"),
      row("new", A, "2026-11-03T00:00:00.000Z"),
      row("other", B, "2026-11-04T00:00:00.000Z"),
    );
    const all = await listReports(A, { limit: 20 });
    expect(all.map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(all[0]).toEqual({ id: "new", createdAt: "2026-11-03T00:00:00.000Z", input, report, steps: [] });
    expect((await listReports(A, { limit: 2 })).map((r) => r.id)).toEqual(["new", "mid"]);
    expect((await listReports(A, { limit: 20, before: "2026-11-02T00:00:00.000Z" })).map((r) => r.id)).toEqual(["old"]);
  });

  it("정리는 그 브라우저의 최신 N 개만 남기고, 다른 브라우저 기록은 건드리지 않는다", async () => {
    for (let i = 0; i < 5; i++) f.rows.push(row(`a${i}`, A, `2026-11-0${i + 1}T00:00:00.000Z`));
    f.rows.push(row("b0", B, "2026-10-01T00:00:00.000Z"));
    expect(await trimReports(A, 3)).toBe(2);
    expect(f.rows.map((r) => r.id).sort()).toEqual(["a2", "a3", "a4", "b0"]);
    expect(await trimReports(A, 3)).toBe(0);
  });
});
