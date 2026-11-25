import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteReport, getReport, listReports, saveReport, type ReportRecord } from "./history";
import { normalizeReport } from "../agent/normalize";

const report = normalizeReport({
  summary: "테스트",
  numbers: [],
  why: [],
  impact: [],
  caveats: [],
  dataGaps: [],
  sources: [],
  nextTopics: [],
});

function fakeStorage(limitBytes = Infinity) {
  const m = new Map<string, string>();
  let writes = 0;
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes++;
      const total = [...m.entries()].filter(([key]) => key !== k).reduce((sum, [, value]) => sum + value.length, 0) + v.length;
      if (total > limitBytes) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => { writes++; m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    get writes() { return writes; },
    raw: m,
  };
}

describe("history (localStorage)", () => {
  beforeEach(() => vi.stubGlobal("window", { localStorage: fakeStorage() }));
  afterEach(() => vi.unstubAllGlobals());

  it("저장하면 최신순으로 목록에 나오고 id 로 조회·삭제된다", async () => {
    const a = await saveReport({ question: "a", depth: "easy" }, report, []);
    const b = await saveReport({ question: "b", depth: "deep", area: "etf" }, report, []);
    expect((await listReports()).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await getReport(a.id))?.input.question).toBe("a");
    await deleteReport(a.id);
    expect(await listReports()).toHaveLength(1);
    expect(await getReport(a.id)).toBeNull();
  });

  it("id 를 넘기면 그 id 로 저장하고, 같은 id 가 이미 있으면 덮어쓰지 않고 기존 기록을 돌려준다", async () => {
    const first = await saveReport({ question: "처음", depth: "easy" }, report, [], "req-1");
    expect(first.id).toBe("req-1");
    const again = await saveReport({ question: "다시", depth: "deep" }, report, [], "req-1");
    expect(again).toEqual(first);
    expect(await listReports()).toHaveLength(1);
    expect((await getReport("req-1"))?.input.question).toBe("처음");
    const fresh = await saveReport({ question: "새로", depth: "easy" }, report, []);
    expect(fresh.id).not.toBe("req-1");
    expect((await listReports()).map((r) => r.id)).toEqual([fresh.id, "req-1"]);
  });

  it("0단계 전에 저장된 v1 기록도 v2 모양으로 읽고, 깨진 기록은 건너뛴다", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const v1 = {
      id: "old",
      createdAt: "2026-10-01T00:00:00.000Z",
      input: { question: "old", depth: "easy" },
      report: { summary: "v1", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], sources: [], nextTopics: [] },
      steps: [],
    };
    storage.setItem("muffin.history.v1", JSON.stringify([v1, { id: "broken", report: {} }]));

    const list = await listReports();
    expect(list.map((r) => r.id)).toEqual(["old"]);
    expect(list[0].report.version).toBe(2);
    expect(list[0].report.verification.status).toBe("skipped");
    expect((await getReport("old"))?.report.disclosure).toBeTruthy();
  });

  it("서버 렌더링(window 없음)에서는 빈 목록이다", async () => {
    vi.unstubAllGlobals();
    expect(await listReports()).toEqual([]);
    expect(await getReport("a")).toBeNull();
  });

  it("localStorage 가 없어도 터지지 않는다", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    await expect(saveReport({ question: "x", depth: "easy" }, report, [])).resolves.toMatchObject({ input: { question: "x" } });
    expect(await listReports()).toEqual([]);
    expect(await getReport("x")).toBeNull();
  });
});

describe("기록별 키 저장 (11/21 20명 시나리오 1번: 여러 탭이 서로 덮어쓰던 것)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("기록마다 자기 키에 저장해 다른 탭이 목록을 덮어써도 사라지지 않는다", async () => {
    const store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
    const a = await saveReport({ question: "a", depth: "easy" }, report, [], "tab-a");
    expect(store.raw.has("muffin.history.v1:tab-a")).toBe(true);
    // 다른 탭이 예전 방식으로 목록 전체를 덮어쓴 상황
    store.raw.set("muffin.history.v1", JSON.stringify([{ id: "tab-b", createdAt: "2026-11-21T00:00:00.000Z", input: { question: "b", depth: "easy" }, report, steps: [] }]));
    const list = await listReports();
    expect(list.map(r => r.id).sort()).toEqual(["tab-a", "tab-b"]);
    expect(await getReport(a.id)).toMatchObject({ input: { question: "a" } });
  });

  it("예전 목록 키의 기록은 읽을 때 기록별 키로 옮기고 목록 키는 지운다", async () => {
    const store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
    store.raw.set("muffin.history.v1", JSON.stringify([
      { id: "old-1", createdAt: "2026-11-20T00:00:00.000Z", input: { question: "old", depth: "easy" }, report, steps: [] },
      { id: "old-2", createdAt: "2026-11-21T00:00:00.000Z", input: { question: "new", depth: "easy" }, report, steps: [] },
    ]));
    expect((await listReports()).map(r => r.id)).toEqual(["old-2", "old-1"]);
    expect(store.raw.has("muffin.history.v1")).toBe(false);
    expect(store.raw.has("muffin.history.v1:old-1")).toBe(true);
    await deleteReport("old-1");
    expect((await listReports()).map(r => r.id)).toEqual(["old-2"]);
  });

  it("용량 한도에 걸리면 오래된 기록부터 덜어 내고 새 기록을 저장한다", async () => {
    const store = fakeStorage(7000);
    vi.stubGlobal("window", { localStorage: store });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const record = await saveReport({ question: `q${i}`, depth: "easy" }, { ...report, summary: "x".repeat(400) }, [], `r-${i}`);
      ids.push(record.id);
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    const list = await listReports();
    expect(list[0]?.id).toBe("r-11");
    expect(list.length).toBeLessThan(12);
    expect(list.map(r => r.id)).not.toContain("r-0");
  });

  it("같은 id 는 기록별 키에서도 한 번만 저장한다", async () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    const first = await saveReport({ question: "a", depth: "easy" }, report, [], "same");
    const second = await saveReport({ question: "b", depth: "easy" }, report, [], "same");
    expect(second).toEqual(first);
    expect(await listReports()).toHaveLength(1);
  });
});

describe("용량이 빠듯할 때 (Codex 리뷰)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("옮기기는 목록 키를 먼저 비워 중복을 남기지 않고, 공간이 모자라면 오래된 기록만 못 옮긴다", async () => {
    const legacy = Array.from({ length: 6 }, (_, i) => ({ id: `L${i}`, createdAt: `2026-11-2${i}T00:00:00.000Z`, input: { question: `q${i}`, depth: "easy" as const }, report: { ...report, summary: "x".repeat(300) }, steps: [] }));
    const raw = JSON.stringify(legacy);
    const store = fakeStorage(raw.length + 800); // 목록 한 벌 + 조금
    vi.stubGlobal("window", { localStorage: store });
    store.raw.set("muffin.history.v1", raw);
    const list = await listReports();
    expect(store.raw.has("muffin.history.v1")).toBe(false);
    expect(list[0]?.id).toBe("L5");
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(6);
    // 두 번째 읽기에서 같은 결과, 다시 옮기려 들지 않는다
    expect((await listReports()).map(r => r.id)).toEqual(list.map(r => r.id));
    // 새 기록 저장도 막히지 않는다 (오래된 기록을 덜어 내서라도)
    const saved = await saveReport({ question: "new", depth: "easy" }, { ...report, summary: "y".repeat(300) }, [], "new-1");
    expect(await getReport(saved.id)).not.toBeNull();
  });

  it("새 기록이 끝내 들어가지 못하면 기존 기록을 되돌려 놓는다", async () => {
    const store = fakeStorage(2500);
    vi.stubGlobal("window", { localStorage: store });
    for (let i = 0; i < 3; i++) await saveReport({ question: `q${i}`, depth: "easy" }, { ...report, summary: "x".repeat(200) }, [], `k-${i}`);
    expect(await listReports()).toHaveLength(3);
    await saveReport({ question: "huge", depth: "easy" }, { ...report, summary: "z".repeat(5000) }, [], "huge");
    expect(await getReport("huge")).toBeNull();
    expect((await listReports()).map(r => r.id).sort()).toEqual(["k-0", "k-1", "k-2"]);
  });
});

describe("용량이 빠듯할 때 2 (Codex 재리뷰)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("옮기다 하나도 못 쓰면 예전 목록을 그대로 되돌려 기록이 사라지지 않는다", async () => {
    // v1 모양 기록은 읽을 때 검증 · 고지가 붙어 커지므로, 목록이 딱 맞게 찬 저장소에서는 기록별 키로 못 옮깁니다
    const v1 = { summary: "v1", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], sources: [], nextTopics: [] };
    const raw = JSON.stringify([{ id: "v1-1", createdAt: "2026-11-20T00:00:00.000Z", input: { question: "old", depth: "easy" }, report: v1, steps: [] }]);
    const store = fakeStorage(raw.length);
    vi.stubGlobal("window", { localStorage: store });
    store.raw.set("muffin.history.v1", raw);
    expect((await listReports()).map(r => r.id)).toEqual(["v1-1"]);
    expect(store.raw.get("muffin.history.v1")).toBe(raw);
    expect(store.raw.has("muffin.history.v1:v1-1")).toBe(false);
    expect(await getReport("v1-1")).not.toBeNull();
  });

  it("자리가 날 때까지 덜어 내면 큰 새 기록도 들어간다", async () => {
    const store = fakeStorage(20000);
    vi.stubGlobal("window", { localStorage: store });
    for (let i = 0; i < 8; i++) await saveReport({ question: `q${i}`, depth: "easy" }, { ...report, summary: "x".repeat(600) }, [], `s-${i}`);
    expect(await listReports()).toHaveLength(8);
    // 기록 8개(약 1만 자)가 있을 때는 안 들어가고, 거의 다 덜어 내야 들어가는 크기
    const big = await saveReport({ question: "big", depth: "easy" }, { ...report, summary: "y".repeat(18000) }, [], "big");
    expect(await getReport(big.id)).not.toBeNull();
    expect((await listReports())[0]?.id).toBe("big");
  });
});

describe("예전 목록에만 남은 기록 (Codex 재리뷰 2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("옮기지 못한 기록만 있을 때 새 기록이 안 들어가도 덜어 내기가 멈춘다", async () => {
    const v1 = { summary: "v1", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], sources: [], nextTopics: [] };
    const raw = JSON.stringify([{ id: "v1-1", createdAt: "2026-11-20T00:00:00.000Z", input: { question: "old", depth: "easy" }, report: v1, steps: [] }]);
    const store = fakeStorage(raw.length);
    vi.stubGlobal("window", { localStorage: store });
    store.raw.set("muffin.history.v1", raw);
    expect((await listReports()).map(r => r.id)).toEqual(["v1-1"]);
    const saved = await saveReport({ question: "big", depth: "easy" }, { ...report, summary: "z".repeat(raw.length) }, [], "big");
    expect(saved.id).toBe("big");
    expect(await getReport("big")).toBeNull();
    expect(Array.isArray(await listReports())).toBe(true);
  });

  it("옮기지 못한 기록도 삭제하면 목록에서 빠진다", async () => {
    const v1 = { summary: "v1", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], sources: [], nextTopics: [] };
    const raw = JSON.stringify([{ id: "v1-1", createdAt: "2026-11-20T00:00:00.000Z", input: { question: "old", depth: "easy" }, report: v1, steps: [] }]);
    const store = fakeStorage(raw.length);
    vi.stubGlobal("window", { localStorage: store });
    store.raw.set("muffin.history.v1", raw);
    await deleteReport("v1-1");
    expect(await listReports()).toEqual([]);
    expect(store.raw.has("muffin.history.v1")).toBe(false);
  });
});

describe("옮기기 되돌리기 · 되풀이 방지 (Codex 재리뷰 3)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const v1 = { summary: "v1", numbers: [], why: [], impact: [], caveats: [], dataGaps: [], sources: [], nextTopics: [] };
  const legacy = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `v1-${i}`, createdAt: `2026-11-1${i}T00:00:00.000Z`, input: { question: `q${i}`, depth: "easy" }, report: v1, steps: [] })));

  it("일부만 옮기고 나머지를 되돌릴 자리가 없으면 통째로 원래 목록으로 되돌려 기록 수가 줄지 않는다", async () => {
    const raw = legacy(6);
    const store = fakeStorage(Math.floor(raw.length * 1.3));
    vi.stubGlobal("window", { localStorage: store });
    store.raw.set("muffin.history.v1", raw);
    expect(await listReports()).toHaveLength(6);
    expect(await listReports()).toHaveLength(6);
    const perKey = [...store.raw.keys()].filter(k => k.startsWith("muffin.history.v1:")).length;
    const inList = store.raw.has("muffin.history.v1") ? (JSON.parse(store.raw.get("muffin.history.v1")!) as unknown[]).length : 0;
    expect(perKey + inList).toBe(6);
  });

  it("옮기기에 실패한 탭은 다시 읽을 때 저장소를 건드리지 않는다", async () => {
    const raw = legacy(1);
    const store = fakeStorage(raw.length);
    vi.stubGlobal("window", { localStorage: store });
    store.raw.set("muffin.history.v1", raw);
    await listReports();
    const after = store.writes;
    await listReports();
    await getReport("v1-0");
    expect(store.writes).toBe(after);
  });
});

describe("서버 저장 (History API, 11/24 화면 연결)", () => {
  const CLIENT = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  type ServerRow = ReportRecord & { client: string };
  type Fail = (method: string, path: string, body?: { id?: string }) => Response | undefined;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const record = (id: string, createdAt: string, question = id): ReportRecord => ({ id, createdAt, input: { question, depth: "easy" }, report, steps: [] });

  /** /api/history 흉내. 브라우저 id 로 나누고, 시각은 Postgres 처럼 +00:00 꼴로 돌려줍니다 */
  function fakeServer({ off = false } = {}) {
    const rows = new Map<string, ServerRow>();
    const calls: { method: string; path: string; id?: string }[] = [];
    let fail: Fail | undefined;
    let down = off;
    let gate: Promise<void> | undefined; // 붙잡아 둔 저장(POST)은 풀 때까지 늦게 닿습니다
    const out = (row: ServerRow): ReportRecord => ({ id: row.id, createdAt: row.createdAt.replace("Z", "+00:00"), input: row.input, report: row.report, steps: row.steps });
    const fetchMock = vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, id: body?.id });
      const injected = fail?.(method, path, body);
      if (injected) return injected;
      if (down) return json({ error: "저장소 설정을 확인해 주세요.", id: "x" }, 503);
      if (method === "POST" && gate) await gate;
      const client = new Headers(init.headers).get("X-Muffin-Client") ?? "";
      const one = /^\/api\/history\/([^?]+)$/.exec(path);
      if (method === "GET" && path.startsWith("/api/history?")) {
        const mine = [...rows.values()].filter((row) => row.client === client).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return json({ records: mine.map(out) });
      }
      if (method === "POST" && path === "/api/history") {
        const existing = rows.get(body.id);
        if (existing) return existing.client === client ? json({ record: out(existing) }) : json({ error: "이미 쓰인 리포트 id 예요.", id: body.id }, 409);
        const row = { ...body, createdAt: body.createdAt ?? new Date().toISOString(), client };
        rows.set(body.id, row);
        return json({ record: out(row) }, 201);
      }
      if (one) {
        const id = decodeURIComponent(one[1]);
        const row = rows.get(id);
        if (!row || row.client !== client) return json({ error: "리포트를 찾을 수 없어요.", id }, 404);
        if (method === "DELETE") { rows.delete(id); return new Response(null, { status: 204 }); }
        return json({ record: out(row) });
      }
      return json({ error: "알 수 없는 요청" }, 500);
    });
    return {
      rows, calls, fetchMock,
      failWith(next?: Fail) { fail = next; },
      setOff(next: boolean) { down = next; },
      holdPosts() {
        let release = () => {};
        gate = new Promise<void>((resolve) => { release = () => { gate = undefined; resolve(); }; });
        return release;
      },
    };
  }

  let store: ReturnType<typeof fakeStorage>;
  let server: ReturnType<typeof fakeServer>;
  let history: typeof import("./history");
  const useStorage = (next: ReturnType<typeof fakeStorage>) => {
    store = next;
    store.setItem("muffin.client", CLIENT);
    vi.stubGlobal("window", { localStorage: store, location: { protocol: "https:" } });
  };
  const useServer = (next: ReturnType<typeof fakeServer>) => { server = next; vi.stubGlobal("fetch", server.fetchMock); };
  const putLocal = (r: ReportRecord) => store.setItem(`muffin.history.v1:${r.id}`, JSON.stringify(r));
  const putServer = (r: ReportRecord, client = CLIENT) => server.rows.set(r.id, { ...r, client });
  const posts = (id: string) => server.calls.filter((call) => call.method === "POST" && call.id === id).length;

  beforeEach(async () => {
    vi.resetModules(); // 탭마다의 서버 상태(503 로 끔 · 맞추는 중)를 테스트마다 새로
    useStorage(fakeStorage());
    useServer(fakeServer());
    history = await import("./history");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("저장하면 브라우저에 먼저 쓰고 서버에도 올린다 (브라우저 id · 처음 저장 시각 그대로)", async () => {
    const saved = await history.saveReport({ question: "환율", depth: "easy" }, report, [], "req-1");
    expect(store.getItem("muffin.history.v1:req-1")).not.toBeNull();
    await vi.waitFor(() => expect(server.rows.get("req-1")).toMatchObject({ client: CLIENT, createdAt: saved.createdAt }));
  });

  it("브라우저에 못 쓰면 서버 저장을 기다리고, 조회는 서버에서 찾는다", async () => {
    useStorage(fakeStorage(120)); // 브라우저 id 만 들어가는 크기
    await history.saveReport({ question: "큰 리포트", depth: "deep" }, report, [], "req-2");
    expect(server.rows.has("req-2")).toBe(true);
    expect(store.getItem("muffin.history.v1:req-2")).toBeNull();
    expect((await history.getReport("req-2"))?.input.question).toBe("큰 리포트");
  });

  it("목록은 서버 기록과 브라우저 기록을 합쳐 최신순으로 보이고, 브라우저에만 있던 기록은 뒤에서 서버로 올린다", async () => {
    putLocal(record("local-old", "2026-11-01T00:00:00.000Z"));
    putServer(record("server-only", "2026-11-10T00:00:00.000Z"));
    putLocal(record("both", "2026-11-20T00:00:00.000Z"));
    putServer(record("both", "2026-11-20T00:00:00.000Z"));
    const list = await history.listReports();
    expect(list.map((r) => r.id)).toEqual(["both", "server-only", "local-old"]);
    expect(list[1].createdAt).toBe("2026-11-10T00:00:00.000Z"); // 서버의 +00:00 꼴을 브라우저와 같은 ISO 로
    await history.waitForHistorySync();
    expect(server.rows.get("local-old")?.createdAt).toBe("2026-11-01T00:00:00.000Z");
    expect(server.calls.filter((call) => call.method === "POST").map((call) => call.id)).toEqual(["local-old"]);
  });

  it("서버에서 가져온 기록은 브라우저에도 넣어 둬 다음에는 서버를 부르지 않는다", async () => {
    putServer(record("from-server", "2026-11-07T00:00:00.000Z"));
    expect((await history.getReport("from-server"))?.createdAt).toBe("2026-11-07T00:00:00.000Z");
    expect(store.getItem("muffin.history.v1:from-server")).not.toBeNull();
    const before = server.calls.length;
    await history.getReport("from-server");
    expect(server.calls).toHaveLength(before);
  });

  it("지우면 브라우저와 서버에서 지우고, 서버가 실패하면 숨겨 둔 채 보관함을 열 때 다시 지운다", async () => {
    await history.saveReport({ question: "지울 것", depth: "easy" }, report, [], "req-3");
    await vi.waitFor(() => expect(server.rows.has("req-3")).toBe(true));
    server.failWith((method) => (method === "DELETE" ? json({ error: "잠깐 오류" }, 500) : undefined));
    await history.deleteReport("req-3");
    expect(store.getItem("muffin.history.v1:req-3")).toBeNull();
    expect(server.rows.has("req-3")).toBe(true);
    expect((await history.listReports()).map((r) => r.id)).not.toContain("req-3");
    expect(await history.getReport("req-3")).toBeNull();
    await history.waitForHistorySync();

    server.failWith(undefined);
    await history.listReports();
    await history.waitForHistorySync();
    expect(server.rows.has("req-3")).toBe(false);
    await history.listReports(); // 서버 목록에서 빠져도 늦게 닿는 저장에 대비해 2분은 기억하고
    await history.waitForHistorySync();
    expect(store.getItem("muffin.history.deleted")).toContain("req-3");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 60 * 1000);
    await history.listReports(); // 그 뒤에 잊습니다
    await history.waitForHistorySync();
    clock.mockRestore();
    expect(store.getItem("muffin.history.deleted")).toBeNull();
  });

  it("올리는 중에 지우면(지우기가 먼저 닿아 404) 저장이 늦게 닿아도 바로 서버에서 지운다 (Codex 리뷰)", async () => {
    const release = server.holdPosts();
    await history.saveReport({ question: "올리는 중", depth: "easy" }, report, [], "req-4");
    await history.deleteReport("req-4");
    expect(server.rows.has("req-4")).toBe(false);
    expect((await history.listReports()).map((r) => r.id)).not.toContain("req-4");
    await history.waitForHistorySync();
    expect(store.getItem("muffin.history.deleted")).toContain("req-4"); // 서버 목록에 없어도 아직 잊지 않습니다
    release();
    await vi.waitFor(() => expect(server.calls.filter((call) => call.method === "DELETE" && call.path.endsWith("/req-4"))).toHaveLength(2));
    expect(server.rows.has("req-4")).toBe(false);
  });

  it("지운 직후 서버 목록에 없어도 2분은 기억해, 새로고침 뒤 늦게 닿은 저장도 숨기고 지운다 (Codex 리뷰)", async () => {
    putLocal(record("late-1", "2026-11-20T00:00:00.000Z"));
    await history.deleteReport("late-1");
    await history.listReports();
    await history.waitForHistorySync();
    putServer(record("late-1", "2026-11-20T00:00:00.000Z")); // 다른 탭에서 올리던 저장이 늦게 닿음
    vi.resetModules(); // 새로고침
    history = await import("./history");
    expect((await history.listReports()).map((r) => r.id)).not.toContain("late-1");
    await history.waitForHistorySync();
    expect(server.rows.has("late-1")).toBe(false);
  });

  it("서버를 끈 탭(503)에서 지운 기록도 기억해 두었다가, 서버가 돌아오면 숨기고 지운다 (Codex 리뷰)", async () => {
    const synced = record("synced-1", "2026-11-21T00:00:00.000Z");
    putLocal(synced);
    putServer(synced);
    server.setOff(true);
    await history.listReports(); // 503 → 이 탭은 서버를 끕니다
    await history.deleteReport("synced-1");
    expect(server.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(store.getItem("muffin.history.deleted")).toContain("synced-1");

    server.setOff(false);
    vi.resetModules(); // 서버가 돌아온 뒤 새로 연 탭
    history = await import("./history");
    expect((await history.listReports()).map((r) => r.id)).not.toContain("synced-1");
    await history.waitForHistorySync();
    expect(server.rows.has("synced-1")).toBe(false);
  });

  it("서버 저장소가 없으면(503) 이 탭에서는 더 부르지 않고 브라우저 기록만 쓴다", async () => {
    useServer(fakeServer({ off: true }));
    expect(await history.listReports()).toEqual([]);
    const saved = await history.saveReport({ question: "브라우저만", depth: "easy" }, report, []);
    expect((await history.listReports()).map((r) => r.id)).toEqual([saved.id]);
    expect(await history.getReport("nope")).toBeNull();
    await history.deleteReport(saved.id);
    expect(await history.listReports()).toEqual([]);
    expect(server.calls).toHaveLength(1);
  });

  it("서버가 받지 않는 기록(400)은 다시 올리지 않고, 잠깐의 실패(429)는 다음에 다시 올린다", async () => {
    putLocal(record("bad-old", "2026-11-01T00:00:00.000Z"));
    putLocal(record("busy-new", "2026-11-02T00:00:00.000Z"));
    let busy = true;
    server.failWith((method, _path, body) => {
      if (method !== "POST") return undefined;
      if (body?.id === "bad-old") return json({ error: "id, input, report, steps 를 확인하세요." }, 400);
      if (body?.id === "busy-new" && busy) return json({ error: "요청이 많아요.", retryAfterSec: 30 }, 429);
      return undefined;
    });
    await history.listReports();
    await history.waitForHistorySync();
    expect(posts("busy-new")).toBe(1);
    expect(posts("bad-old")).toBe(0); // 429 면 이번에는 멈춥니다

    busy = false;
    for (let round = 0; round < 2; round++) {
      await history.listReports();
      await history.waitForHistorySync();
    }
    expect(server.rows.has("busy-new")).toBe(true);
    expect(posts("busy-new")).toBe(2);
    expect(posts("bad-old")).toBe(1);
  });

  it("서버가 이미 100개를 들고 있으면 그보다 오래된 브라우저 기록은 올리지 않는다 (올려도 서버 정리에 지워져 되풀이되므로)", async () => {
    for (let i = 0; i < 100; i++) putServer(record(`server-${i}`, new Date(Date.UTC(2026, 10, 10, 0, i)).toISOString()));
    putLocal(record("older-local", "2026-11-01T00:00:00.000Z"));
    await history.listReports();
    await history.waitForHistorySync();
    expect(posts("older-local")).toBe(0);
  });

  it("다른 브라우저의 기록은 찾을 수 없음(null), 서버에 닿지 못하면 조회는 실패로 알리고 목록은 브라우저 기록으로 대신한다", async () => {
    putServer(record("someone-else", "2026-11-05T00:00:00.000Z"), OTHER);
    expect(await history.getReport("someone-else")).toBeNull();
    server.failWith(() => { throw new TypeError("fetch failed"); });
    await expect(history.getReport("unknown")).rejects.toThrow("fetch failed");
    putLocal(record("mine", "2026-11-06T00:00:00.000Z"));
    expect((await history.listReports()).map((r) => r.id)).toEqual(["mine"]);
  });
});
