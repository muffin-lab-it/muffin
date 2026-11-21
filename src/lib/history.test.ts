import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteReport, getReport, listReports, saveReport } from "./history";
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
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const total = [...m.entries()].filter(([key]) => key !== k).reduce((sum, [, value]) => sum + value.length, 0) + v.length;
      if (total > limitBytes) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
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
