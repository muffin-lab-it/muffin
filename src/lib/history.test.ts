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

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
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
