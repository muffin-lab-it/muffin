import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ args })));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

type ClientOptions = { auth: Record<string, boolean>; global: { fetch: typeof fetch } };

/** db.ts 는 클라이언트를 모듈에 하나 두므로, 테스트마다 새로 불러옵니다. */
const loadDb = () => import("./db");

describe("Supabase 서버 클라이언트", () => {
  beforeEach(() => {
    vi.resetModules();
    createClient.mockClear();
    vi.stubEnv("SUPABASE_URL", "https://muffin-test.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test-value");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("환경 변수가 둘 다 있어야 켜진다", async () => {
    const { dbEnabled } = await loadDb();
    expect(dbEnabled()).toBe(true);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(dbEnabled()).toBe(false);
  });

  it("환경 변수가 없으면 이름만 알리고 throw 한다 (값은 메시지에 없음)", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const { getDb } = await loadDb();
    expect(getDb).toThrow("SUPABASE_URL · SUPABASE_SECRET_KEY");
    expect(getDb).not.toThrow("muffin-test");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("secret 키로 한 번만 만들고, 로그인 세션은 저장하지 않는다", async () => {
    const { getDb } = await loadDb();
    const db = getDb();
    expect(getDb()).toBe(db);
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClient.mock.calls[0] as [string, string, ClientOptions];
    expect(url).toBe("https://muffin-test.supabase.co");
    expect(key).toBe("sb_secret_test-value");
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  });

  it("DB 요청은 Next.js 캐시를 쓰지 않는다 (cache: no-store)", async () => {
    const { getDb } = await loadDb();
    getDb();
    const options = createClient.mock.calls[0]![2] as ClientOptions;
    const fetchSpy = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchSpy);
    await options.global.fetch("https://muffin-test.supabase.co/rest/v1/runs", { method: "GET" });
    expect(fetchSpy).toHaveBeenCalledWith("https://muffin-test.supabase.co/rest/v1/runs", { method: "GET", cache: "no-store" });
  });
});

describe("마이그레이션 (supabase/migrations)", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const sql = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(new URL(file, dir), "utf8"))
    .join("\n")
    .replace(/--.*$/gm, "")
    .toLowerCase();
  const statements = sql.split(";").map((s) => s.replace(/\s+/g, " ").trim());
  const tables = [...sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/g)].map((m) => m[1]!);
  const mentions = (statement: string, table: string) => new RegExp(`\\b${table}\\b`).test(statement);

  it("저장함 · 실행 로그 표를 만든다", () => {
    expect(tables).toEqual(expect.arrayContaining(["reports", "runs"]));
  });

  it("모든 표가 RLS 를 켜고, 정책은 만들지 않는다", () => {
    for (const table of tables) {
      expect(statements.some((s) => /^alter table /.test(s) && mentions(s, table) && s.endsWith("enable row level security"))).toBe(true);
    }
    expect(sql).not.toContain("create policy");
  });

  it("모든 표의 권한은 secret 키(service_role)에만 준다", () => {
    const grants = statements.filter((s) => s.startsWith("grant "));
    for (const grant of grants) expect(grant).toMatch(/ to service_role$/);
    for (const table of tables) {
      expect(grants.some((s) => mentions(s, table))).toBe(true);
      expect(statements.some((s) => s.startsWith("revoke ") && mentions(s, table) && s.endsWith("from anon, authenticated"))).toBe(true);
    }
  });
});
