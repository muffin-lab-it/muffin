import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import { reportSchema } from "@/src/agent/schema";
import { createFakeDb } from "./fake-db";

// Supabase 는 메모리 흉내로, next/server 의 after 는 바로 실행하고 끝날 때까지 기다릴 수 있게 모아 둡니다
const fake = vi.hoisted(() => ({ current: undefined as unknown, enabled: true, after: [] as Promise<unknown>[] }));
vi.mock("@/src/lib/db", () => ({ getDb: () => fake.current, dbEnabled: () => fake.enabled }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => unknown) => void fake.after.push(Promise.resolve(cb())),
}));

import { DELETE, GET as GET_ONE } from "./[id]/route";
import { GET, POST } from "./route";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://muffin-kappa.vercel.app";
const report = reportSchema.parse(sample.report);
const input = { question: "KODEX 200 요즘 어때?", depth: "standard", area: "etf" };

function req(method: string, path: string, { client = A, origin = ORIGIN, body }: { client?: string | null; origin?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (client) headers["x-muffin-client"] = client;
  if (origin) headers.origin = origin;
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const save = (body: unknown, opts: { client?: string | null; origin?: string | null } = {}) => POST(req("POST", "/api/history", { ...opts, body }));

let f: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  f = createFakeDb();
  fake.current = f.db;
  fake.enabled = true;
  fake.after = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/history", () => {
  it("저장하면 201 과 기록, id 를 주면 그 id 로, 안 주면 새로 만든다", async () => {
    const res = await save({ id: "req-1", input, report, steps: [{ tool: "get_etf_data", status: "ok", ms: 120 }] });
    expect(res.status).toBe(201);
    const { record } = await res.json();
    expect(record).toMatchObject({ id: "req-1", input, steps: [{ tool: "get_etf_data" }] });
    expect(typeof record.createdAt).toBe("string");
    expect(f.rows[0]).toMatchObject({ id: "req-1", client_id: A });

    const fresh = await save({ input, report });
    expect(fresh.status).toBe(201);
    expect((await fresh.json()).record.id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("같은 브라우저가 같은 id 를 다시 보내면 200 과 기존 기록, 다른 브라우저면 409", async () => {
    await save({ id: "req-1", input, report });
    const again = await save({ id: "req-1", input: { ...input, question: "바뀐 질문" }, report });
    expect(again.status).toBe(200);
    expect((await again.json()).record.input.question).toBe(input.question);

    const other = await save({ id: "req-1", input, report }, { client: B });
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ id: "req-1" });
    expect(f.rows).toHaveLength(1);
  });

  it("브라우저당 100개를 넘으면 오래된 것부터 지운다", async () => {
    for (let i = 0; i < 100; i++) f.rows.push({ id: `old-${i}`, client_id: A, created_at: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`, input, report, steps: [] });
    f.rows.push({ id: "b-1", client_id: B, created_at: "2026-09-01T00:00:00.000Z", input, report, steps: [] });
    expect((await save({ id: "new-1", input, report })).status).toBe(201);
    await Promise.all(fake.after);
    const mine = f.rows.filter((r) => r.client_id === A);
    expect(mine).toHaveLength(100);
    expect(mine.some((r) => r.id === "new-1")).toBe(true);
    expect(f.rows.some((r) => r.id === "b-1")).toBe(true);
  });

  it.each([
    ["input 없음", { report }],
    ["질문이 빈칸", { input: { ...input, question: "  " }, report }],
    ["리포트 모양이 아님", { input, report: { summary: "x" } }],
    ["id 에 쓸 수 없는 글자", { id: "../etc", input, report }],
    ["steps 가 100개 넘음", { input, report, steps: Array.from({ length: 101 }, () => ({ tool: "t", status: "ok", ms: 1 })) }],
    ["JSON 아님", "not json"],
  ])("입력이 틀리면 400 (%s)", async (_name, body) => {
    const res = await save(body);
    expect(res.status).toBe(400);
    expect(f.rows).toHaveLength(0);
  });

  it("바디가 512KB 를 넘으면 413", async () => {
    const res = await save({ input, report: { ...report, summary: "가".repeat(200_000) } });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "요청이 너무 큽니다." });
  });

  it("허용되지 않은 출처는 403, 브라우저 id 가 없거나 틀리면 400, 저장소 설정이 없으면 503 (이 순서로)", async () => {
    expect((await save({ input, report }, { origin: "https://evil.example.com", client: null })).status).toBe(403);
    expect((await save({ input, report }, { client: null })).status).toBe(400);
    expect((await save({ input, report }, { client: "not-a-uuid" })).status).toBe(400);
    fake.enabled = false;
    expect((await save({ input, report })).status).toBe(503);
    expect(f.rows).toHaveLength(0);
  });

  it("DB 오류는 500 과 짧은 문장, 원문은 서버 로그에만", async () => {
    f.state.failNext = "password authentication failed";
    const res = await save({ input, report });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).not.toContain("password");
    expect(json.id).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("password authentication failed"));
  });
});

describe("GET /api/history", () => {
  beforeEach(async () => {
    for (const id of ["a1", "a2", "a3"]) await save({ id, input, report });
    await save({ id: "b1", input, report }, { client: B });
  });

  it("그 브라우저의 기록만 최신순, limit 를 따른다 (출처 검사는 하지 않음)", async () => {
    const res = await GET(req("GET", "/api/history", { origin: null }));
    expect(res.status).toBe(200);
    expect((await res.json()).records.map((r: { id: string }) => r.id)).toEqual(["a3", "a2", "a1"]);
    const two = await GET(req("GET", "/api/history?limit=2"));
    expect((await two.json()).records).toHaveLength(2);
  });

  it("before 로 다음 페이지를 받는다", async () => {
    const all = (await (await GET(req("GET", "/api/history"))).json()).records;
    const res = await GET(req("GET", `/api/history?before=${encodeURIComponent(all[1].createdAt)}`));
    expect((await res.json()).records.map((r: { id: string }) => r.id)).toEqual(["a1"]);
  });

  it("before 는 Postgres 가 돌려주는 시각 모양(마이크로초 · +00:00)도 받는다", async () => {
    const res = await GET(req("GET", `/api/history?before=${encodeURIComponent("2026-11-05T10:43:51.674503+00:00")}`));
    expect(res.status).toBe(200);
  });

  it.each(["limit=0", "limit=101", "limit=abc", "before=어제"])("쿼리가 틀리면 400 (%s)", async (q) => {
    expect((await GET(req("GET", `/api/history?${q}`))).status).toBe(400);
  });

  it("브라우저 id 가 없으면 400", async () => {
    expect((await GET(req("GET", "/api/history", { client: null }))).status).toBe(400);
  });
});

describe("GET · DELETE /api/history/:id", () => {
  beforeEach(async () => {
    await save({ id: "a1", input, report });
  });

  it("자기 기록은 200, 없거나 다른 브라우저의 기록은 404", async () => {
    const res = await GET_ONE(req("GET", "/api/history/a1"), ctx("a1"));
    expect(res.status).toBe(200);
    expect((await res.json()).record.id).toBe("a1");

    const missing = await GET_ONE(req("GET", "/api/history/nope"), ctx("nope"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ id: "nope" });
    expect((await GET_ONE(req("GET", "/api/history/a1", { client: B }), ctx("a1"))).status).toBe(404);
    expect((await GET_ONE(req("GET", "/api/history/x"), ctx("../a1"))).status).toBe(404);
  });

  it("삭제는 204, 다른 브라우저는 404 이고 지워지지 않는다", async () => {
    expect((await DELETE(req("DELETE", "/api/history/a1", { client: B }), ctx("a1"))).status).toBe(404);
    expect(f.rows).toHaveLength(1);
    const res = await DELETE(req("DELETE", "/api/history/a1"), ctx("a1"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(f.rows).toHaveLength(0);
    expect((await DELETE(req("DELETE", "/api/history/a1"), ctx("a1"))).status).toBe(404);
  });

  it("삭제는 출처 검사를 한다", async () => {
    expect((await DELETE(req("DELETE", "/api/history/a1", { origin: "https://evil.example.com" }), ctx("a1"))).status).toBe(403);
    expect(f.rows).toHaveLength(1);
  });
});
