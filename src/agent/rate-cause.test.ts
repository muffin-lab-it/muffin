import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { ensureRateStatement, isKoreanRateCause, latestStatement, rateStatementNote } from "./rate-cause";
import type { Evidence } from "./schema";

const statement = (id: string, title: string, publishedAt: string, url: string): Evidence => ({
  id,
  tool: "get_korean_economic_news",
  label: "경제 뉴스 확인 · 한국은행",
  values: { title, publisher: "한국은행", publishedAt, body: "available" },
  source: { name: "한국은행", url, asOf: publishedAt.slice(0, 10) },
});
const URL1 = "https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=11065823&menuNo=200690";
const BODY = "통화정책방향 □ 금융통화위원회는 다음 통화정책방향 결정시까지 한국은행 기준금리를 현재의 3.00% 수준에서 유지하여 통화정책을 운용하기로 하였다.";

describe("한국 기준금리 원인 질문의 통화정책방향 (11/24)", () => {
  it("한국 기준금리의 원인 질문만 대상 (다른 나라 · 예적금 · 대출 · 환율 질문은 아님)", () => {
    expect(isKoreanRateCause("한국 기준금리는 왜 동결됐어?", "cause")).toBe(true);
    expect(isKoreanRateCause("금리 왜 올렸어?", "cause")).toBe(true);
    expect(isKoreanRateCause("물가 때문에 기준금리 올린 거야?", "cause")).toBe(true);
    expect(isKoreanRateCause("한국 기준금리 얼마야?", "status")).toBe(false);
    expect(isKoreanRateCause("미국 금리 왜 동결했어?", "cause")).toBe(false);
    expect(isKoreanRateCause("대출 금리 왜 이렇게 높아?", "cause")).toBe(false);
    expect(isKoreanRateCause("환율이랑 금리 왜 움직여?", "cause")).toBe(false);
  });

  it("장부에 통화정책방향이 없으면 한국은행 보도자료를 '통화정책방향' 으로 받고, 있으면 부르지 않는다. 실패해도 던지지 않는다", async () => {
    const ctx = new ResearchContext();
    const invoke = vi.fn(async (...args: [unknown, string]) => {
      if (args.length) ctx.addEvidence([statement("E3-1", "통화정책방향(2026.10.22)", "2026-10-22T07:00:00.000Z", URL1)]);
      return "ok";
    });
    expect(await ensureRateStatement(ctx, "한국 기준금리는 왜 동결됐어?", "cause", [{ name: "get_korean_economic_news", invoke }])).toBe("E3-1");
    expect(JSON.parse(invoke.mock.calls[0]![1])).toEqual({ sources: ["bok"], query: "통화정책방향", limit: 2, content: "body" });
    expect(await ensureRateStatement(ctx, "한국 기준금리는 왜 동결됐어?", "cause", [{ name: "get_korean_economic_news", invoke }])).toBe("E3-1");
    expect(invoke).toHaveBeenCalledTimes(1);
    const failed = new ResearchContext();
    await expect(ensureRateStatement(failed, "금리 왜 올렸어?", "cause", [{ name: "get_korean_economic_news", invoke: vi.fn(async () => { throw new Error("실패"); }) }])).resolves.toBeNull();
    expect(await ensureRateStatement(new ResearchContext(), "한국 기준금리 얼마야?", "status", [{ name: "get_korean_economic_news", invoke }])).toBeNull();
  });

  it("가장 최근 통화정책방향을 고르고, 작성에는 본문 앞부분과 쓰는 법을 알린다 (본문이 없으면 빈 문자열)", () => {
    const older = statement("E3-2", "통화정책방향(2026.8.27)", "2026-08-27T07:00:00.000Z", "https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=1&menuNo=200690");
    const latest = statement("E3-1", "통화정책방향(2026.10.22)", "2026-10-22T07:00:00.000Z", URL1);
    expect(latestStatement([older, latest])?.id).toBe("E3-1");
    const raw = new Map<string, unknown>([["E3-1", { articles: [{ url: URL1, body: { status: "available", text: BODY } }] }]]);
    const note = rateStatementNote([older, latest], "E3-1", raw);
    expect(note).toContain("[한국은행 통화정책방향]");
    expect(note).toContain("통화정책방향(2026.10.22) (ref E3-1, 2026-10-22)");
    expect(note).toContain("기준금리를 현재의 3.00% 수준에서 유지");
    expect(note).toContain('basis "news"');
    expect(rateStatementNote([latest], "E3-1", new Map())).toBe("");
    expect(rateStatementNote([latest], null, raw)).toBe("");
  });
});
