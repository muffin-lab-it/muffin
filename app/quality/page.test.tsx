import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRuns } from "@/src/lib/admin";
import { loadEvals } from "@/src/lib/admin-evals";
import { resetQualityCache } from "@/src/lib/quality";
import QualityPage from "./page";

vi.mock("@/src/lib/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("@/src/lib/admin")>(), loadRuns: vi.fn() }));
vi.mock("@/src/lib/admin-evals", async (importOriginal) => ({ ...await importOriginal<typeof import("@/src/lib/admin-evals")>(), loadEvals: vi.fn() }));

const run = { id: "r1", at: new Date(Date.now() - 3_600_000).toISOString(), ok: true, stage: "ok", mock: false, ms: 20_000, input: { question: "환율 왜 올랐어?", depth: "standard", area: "fx" }, intent: "cause" };

beforeEach(() => {
  resetQualityCache();
  vi.mocked(loadRuns).mockClear();
  vi.mocked(loadEvals).mockResolvedValue({ source: "none", weekly: [], rows: [] });
});

describe("/quality 페이지 데이터 연결", () => {
  it("예시 데이터(DB 없음)는 운영 실적으로 내보내지 않는다 (Codex 리뷰)", async () => {
    vi.mocked(loadRuns).mockResolvedValue({ source: "sample", reason: "no-db", rows: [run, run] } as never);
    const html = renderToStaticMarkup(await QualityPage());
    expect(html).toContain("실행 기록을 지금 읽지 못했어요");
    expect(html).not.toContain("2건");
  });

  it("runs 표에서 읽은 것만 집계하고, 질문 원문은 나가지 않는다", async () => {
    vi.mocked(loadRuns).mockResolvedValue({ source: "runs", rows: [run, run, run], truncated: false } as never);
    const $ = load(renderToStaticMarkup(await QualityPage()));
    expect($("dl").first().find("dd").first().text()).toBe("3건");
    expect($.html()).not.toContain("환율 왜 올랐어?");
    expect($.html()).not.toContain("최신 기록만 집계");
    // 한 시간 안에는 DB 를 다시 읽지 않는다 (공개 페이지라 요청마다 조회하지 않게)
    await QualityPage();
    expect(loadRuns).toHaveBeenCalledTimes(1);
  });

  it("7일치가 상한을 넘어 잘렸으면 그렇다고 밝힌다", async () => {
    vi.mocked(loadRuns).mockResolvedValue({ source: "runs", rows: [run], truncated: true } as never);
    expect(renderToStaticMarkup(await QualityPage())).toContain("최신 기록만 집계했어요");
  });

  it("조회가 실패해도 고정 숫자와 안내는 그린다", async () => {
    vi.mocked(loadRuns).mockRejectedValue(new Error("db down"));
    vi.mocked(loadEvals).mockRejectedValue(new Error("db down"));
    const html = renderToStaticMarkup(await QualityPage());
    expect(html).toContain("아직 기록이 없어요");
    expect(html).toContain("561.5일 전");
    expect(html).not.toContain("db down");
  });
});
