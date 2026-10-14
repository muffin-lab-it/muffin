import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteReport, getReport, listReports, saveReport } from "./history";
import type { Report } from "../agent/schema";

const report: Report = {
  summary: "테스트",
  numbers: [],
  why: [],
  impact: [],
  caveats: [],
  dataGaps: [],
  sources: [],
  nextTopics: [],
};

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

  it("저장하면 최신순으로 목록에 나오고 id 로 조회·삭제된다", () => {
    const a = saveReport({ question: "a", depth: "easy" }, report, []);
    const b = saveReport({ question: "b", depth: "deep", area: "etf" }, report, []);
    expect(listReports().map((r) => r.id)).toEqual([b.id, a.id]);
    expect(getReport(a.id)?.input.question).toBe("a");
    deleteReport(a.id);
    expect(listReports()).toHaveLength(1);
  });

  it("localStorage 가 없어도 터지지 않는다", () => {
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
    expect(() => saveReport({ question: "x", depth: "easy" }, report, [])).not.toThrow();
    expect(listReports()).toEqual([]);
  });
});
