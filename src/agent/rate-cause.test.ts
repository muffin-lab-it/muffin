import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { askedDecision, askedMonth, dropNewerDecisionTalk, ensureRateStatement, isKoreanRateCause, isLatestStatement, pickStatement, rateStatementNote, statementDecision } from "./rate-cause";
import type { Evidence } from "./schema";

const statement = (id: string, title: string, publishedAt: string, url: string): Evidence => ({
  id,
  tool: "get_korean_economic_news",
  label: "경제 뉴스 확인 · 한국은행",
  values: { title, publisher: "한국은행", publishedAt, body: "available" },
  source: { name: "한국은행", url, asOf: publishedAt.slice(0, 10) },
});
const URL1 = "https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=11065823&menuNo=200690";
const URL2 = "https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=1&menuNo=200690";
const BODY = "통화정책방향 □ 금융통화위원회는 다음 통화정책방향 결정시까지 한국은행 기준금리를 현재의 3.00% 수준에서 유지하여 통화정책을 운용하기로 하였다.";
const HIKE = "통화정책방향 □ 금융통화위원회는 다음 통화정책방향 결정시까지 한국은행 기준금리를 현재의 2.75% 수준에서 3.00% 로 상향 조정하여 통화정책을 운용하기로 하였다. 기준금리를 현 수준에서 유지하면";
/** 뉴스 tool 의 전체 응답 (본문 있음 / 제목만) */
const withBody = (url: string, text: string) => ({ articles: [{ url, body: { status: "available", text } }] });
const listOnly = (url: string) => ({ articles: [{ url, body: { status: "not_requested" } }] });

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
      if (args.length) {
        ctx.addEvidence([statement("E3-1", "통화정책방향(2026.10.22)", "2026-10-22T07:00:00.000Z", URL1)]);
        ctx.raw.set("E3-1", withBody(URL1, BODY));
      }
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

  it("조사가 제목만 받아 둔 통화정책방향은 본문을 다시 받는다 (#165 Codex 리뷰)", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([statement("E1-1", "통화정책방향(2026.10.22)", "2026-10-22T01:30:00.000Z", URL1)]);
    ctx.raw.set("E1-1", listOnly(URL1));
    const invoke = vi.fn(async () => {
      ctx.addEvidence([statement("E3-1", "통화정책방향(2026.10.22)", "2026-10-22T01:30:00.000Z", URL1)]);
      ctx.raw.set("E3-1", withBody(URL1, BODY));
      return "ok";
    });
    expect(await ensureRateStatement(ctx, "한국 기준금리는 왜 동결됐어?", "cause", [{ name: "get_korean_economic_news", invoke }])).toBe("E3-1");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("질문이 말한 결정 · 때를 읽는다 ('결정을 내렸' 는 인하가 아님)", () => {
    expect(askedDecision("한국 기준금리는 왜 동결됐어?")).toBe("동결");
    expect(askedDecision("금리 왜 올렸어?")).toBe("인상");
    expect(askedDecision("한은이 금리를 왜 내렸어?")).toBe("인하");
    expect(askedDecision("한국은행이 기준금리를 유지한 이유가 뭐야?")).toBe("동결");
    expect(askedDecision("금통위가 왜 그런 결정을 내렸어?")).toBeNull();
    expect(askedDecision("금리를 올리지 않고 동결한 이유는?")).toBeNull();
    expect(askedMonth("2026년 8월 한국 기준금리는 왜 올렸어?")).toEqual({ year: 2026, month: 8 });
    expect(askedMonth("10월에 금리 왜 동결했어?")).toEqual({ month: 10 });
    expect(askedMonth("12개월 동안 금리 왜 올랐어?")).toBeNull();
    expect(statementDecision(BODY)).toBe("동결");
    expect(statementDecision(HIKE)).toBe("인상");
  });

  it("질문에 맞는 문서만 고른다: 결정 · 때가 맞는 본문 있는 문서 중 가장 최근, 없으면 고르지 않음 (#165 Codex 리뷰)", async () => {
    const oct = statement("E3-1", "통화정책방향(2026.10.22)", "2026-10-22T01:30:00.000Z", URL1);
    const aug = statement("E3-2", "통화정책방향(2026.8.27)", "2026-08-27T01:30:00.000Z", URL2);
    const raw = new Map<string, unknown>([["E3-1", withBody(URL1, BODY)], ["E3-2", withBody(URL2, HIKE)]]);
    expect(pickStatement([aug, oct], raw, "한국 기준금리는 왜 동결됐어?")?.id).toBe("E3-1");
    expect(pickStatement([aug, oct], raw, "금리 왜 올렸어?")?.id).toBe("E3-2");
    expect(pickStatement([aug, oct], raw, "2026년 8월 한국 기준금리는 왜 올렸어?")?.id).toBe("E3-2");
    expect(pickStatement([aug, oct], raw, "한국 기준금리 왜 이렇게 됐어?")?.id).toBe("E3-1");
    expect(pickStatement([aug, oct], raw, "8월에 금리 왜 동결했어?")).toBeUndefined();
    expect(pickStatement([aug, oct], raw, "금리 왜 내렸어?")).toBeUndefined();
    expect(pickStatement([aug, oct], new Map([["E3-1", listOnly(URL1)]]), "한국 기준금리는 왜 동결됐어?")).toBeUndefined();

    // 맞는 문서가 끝내 없으면 null (다른 결정의 이유를 작성에 강제하지 않음), 때를 물으면 4건까지 받음
    const ctx = new ResearchContext();
    const invoke = vi.fn(async () => {
      ctx.addEvidence([oct]);
      ctx.raw.set("E3-1", withBody(URL1, BODY));
      return "ok";
    });
    expect(await ensureRateStatement(ctx, "2026년 5월 한국 기준금리는 왜 올렸어?", "cause", [{ name: "get_korean_economic_news", invoke }])).toBeNull();
    expect(JSON.parse((invoke.mock.calls as unknown as [unknown, string][])[0]![1]).limit).toBe(4);
  });

  it("작성에는 본문 앞부분 · 결정 · 쓰는 법을 알린다 (본문이 없으면 빈 문자열)", () => {
    const older = statement("E3-2", "통화정책방향(2026.8.27)", "2026-08-27T07:00:00.000Z", URL2);
    const latest = statement("E3-1", "통화정책방향(2026.10.22)", "2026-10-22T07:00:00.000Z", URL1);
    const raw = new Map<string, unknown>([["E3-1", withBody(URL1, BODY)]]);
    const note = rateStatementNote([older, latest], "E3-1", raw);
    expect(note).toContain("[한국은행 통화정책방향]");
    expect(note).toContain("통화정책방향(2026.10.22) (ref E3-1, 2026-10-22, 결정: 기준금리 유지(동결))");
    expect(note).toContain("기준금리를 현재의 3.00% 수준에서 유지");
    expect(note).toContain('basis "news"');
    // 가장 최근 문서면 "더 최근 결정이 있을지 모른다" 는 문장을 쓰지 않게 하고, 지난 문서(8월 인상)를 골랐으면 그 줄을 붙이지 않음 (11/25 운영)
    expect(note).toContain("이번에 받은 한국은행 보도자료에는 이보다 최근 통화정책방향이 없습니다");
    expect(note).toContain('"이 설명은 2026-10-22 결정에 해당한다"');
    const augRaw = new Map<string, unknown>([["E3-2", withBody(URL2, HIKE)]]);
    const augNote = rateStatementNote([older, latest], "E3-2", augRaw);
    expect(augNote).toContain("결정: 기준금리 인상");
    expect(augNote).toContain("가장 최근 통화정책방향은 통화정책방향(2026.10.22) (ref E3-1, 2026-10-22) 이고, 그보다 최근 결정문은 없습니다");
    expect(rateStatementNote([latest], "E3-1", new Map())).toBe("");
    expect(rateStatementNote([latest], null, raw)).toBe("");
  });

  it("가장 최근 문서로 답했으면 '더 최근 결정은 확인되지 않았어요' 문장을 뺀다 (11/25 운영 · 로컬)", () => {
    const oct = statement("E3-1", "통화정책방향(2026.10.22)", "2026-10-22T01:30:00.000Z", URL1);
    const aug = statement("E3-2", "통화정책방향(2026.8.27)", "2026-08-27T01:30:00.000Z", URL2);
    expect(isLatestStatement([aug, oct], "E3-1")).toBe(true);
    expect(isLatestStatement([aug, oct], "E3-2")).toBe(false);
    expect(isLatestStatement([aug, oct], null)).toBe(false);

    const lead = "한국은행은 2026-10-22 물가의 높은 오름세와 금융안정 위험, 대내외 불확실성을 이유로 기준금리를 동결했어요.";
    const cases = [
      "다만 2026-11-25 현재 가장 최근의 금리 결정 여부와 그 이유는 확인하지 못했어요.",
      "다만 2026-11-25 현재 가장 최근 결정문은 확인되지 않아, 이 설명은 2026-10-22 결정에 해당해요.",
      "다만 이 설명은 2026-10-22 결정에 관한 내용이에요. 2026-11-25 기준 가장 최근 결정의 동결 사유인지는 확인되지 않았어요.",
      "이는 2026-10-22 결정문에 담긴 설명이에요.",
      "이 설명은 2026-10-22 금융통화위원회 결정문에 담겼어요.",
      "이 결정 자료가 설명하는 동결 이유는 2026-10-22 결정에 해당해요.",
    ];
    for (const tail of cases) {
      expect(dropNewerDecisionTalk({ summary: `${lead} ${tail}`, caveats: [], dataGaps: [] }).summary).toBe(lead);
    }
    const out = dropNewerDecisionTalk({
      summary: lead,
      caveats: [
        "2026-10-22 이후 금통위 결정은 확인되지 않았어요.",
        "기준금리는 정책금리라 대출 금리와 달라요.",
        "동결 사유는 한국은행의 2026-10-22 결정 설명에 해당해요.",
        "2026-10-22에는 기준금리를 동결했어요. 2026-11-25 당일의 결정 여부는 제공된 자료로 확인되지 않았어요.",
      ],
      dataGaps: [
        "가장 최근 결정의 이유는 확인하지 못했어요.",
        "2026-11-25 당일의 새 결정 또는 이후 발표 자료는 확인되지 않아, 2026-10-22 이후의 동결 이유까지는 확인할 수 없어요.",
        "2026-11-25 현재 가장 최근 금리 결정의 사유를 확인할 자료는 확보하지 못했어요.",
        "2026-11-25 당일 한국은행의 최신 기준금리 결정 여부를 확인할 자료가 없어요.",
        "물가와 금리의 인과관계는 확인되지 않았어요.",
      ],
    });
    expect(out.caveats).toEqual(["기준금리는 정책금리라 대출 금리와 달라요.", "2026-10-22에는 기준금리를 동결했어요."]);
    expect(out.dataGaps).toEqual(["물가와 금리의 인과관계는 확인되지 않았어요."]);
    // 앞으로의 결정 전망 · 숫자가 든 문장은 그대로
    const future = { summary: `${lead} 다음 금통위 결정은 아직 알 수 없어요.`, caveats: ["금통위원 7명 전원이 이번 결정에 찬성했어요."], dataGaps: [] };
    expect(dropNewerDecisionTalk(future)).toBe(future);
    // 다른 한계 · 확인된 사실은 그대로, 요약이 그 문장뿐이면 그대로
    const keep = { summary: `${lead} 물가와 금리의 인과관계는 확인되지 않았어요.`, caveats: [], dataGaps: [] };
    expect(dropNewerDecisionTalk(keep)).toBe(keep);
    const only = { summary: "가장 최근 결정은 확인되지 않았어요.", caveats: [], dataGaps: [] };
    expect(dropNewerDecisionTalk(only).summary).toBe(only.summary);
  });
});
