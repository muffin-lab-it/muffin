import { describe, expect, it } from "vitest";
import type { Evidence } from "@/src/agent/schema";
import { formatDateKo, fxBasisNote, newsCountLine, sourceLinkLabel, valueTone } from "./format";

describe("날짜 · 색 · 기준 설명 · 링크 라벨 (11/21 QA 1묶음)", () => {
  it("날짜는 2026. 11. 20. 꼴로, 날짜가 아니면 그대로", () => {
    expect(formatDateKo("2026-11-20")).toBe("2026. 11. 20.");
    expect(formatDateKo("2026-01-05T09:00:00Z")).toBe("2026. 1. 5.");
    expect(formatDateKo("2026년 10월")).toBe("2026년 10월");
    expect(formatDateKo(undefined)).toBe("");
  });
  it("본값이 부호 있는 비율일 때만 오름 · 내림 색", () => {
    expect(valueTone("+2.82%")).toBe("tone-up");
    expect(valueTone("−0.56%p")).toBe("tone-down");
    expect(valueTone("-7.47%")).toBe("tone-down");
    expect(valueTone("3.00%")).toBeNull();
    expect(valueTone("1,331.92원")).toBeNull();
    expect(valueTone("−4.69원")).toBeNull();
  });
  it("환율 장부에만 고시 기준 설명이 붙는다", () => {
    expect(fxBasisNote("get_fx_krw_rate", "Frankfurter v2")).toContain("유럽중앙은행");
    expect(fxBasisNote("get_fx_krw_rate", "한국은행 ECOS — 주요국 통화의 대원화환율")).toContain("한국은행");
    expect(fxBasisNote("get_rate_data", "한국은행 ECOS")).toBeNull();
  });
  it("API 응답 주소는 JSON 이라고 알려 준다", () => {
    expect(sourceLinkLabel("https://api.frankfurter.dev/v2/rates?base=USD")).toBe("원본 응답(JSON) ↗");
    expect(sourceLinkLabel("https://ecos.bok.or.kr/")).toBe("출처 사이트 ↗");
    expect(sourceLinkLabel("not a url")).toBe("출처 사이트 ↗");
  });
  it("기사만 있는 리포트의 한 줄: 건수 · 날짜 · 언론사", () => {
    const news = (id: string, publishedAt: string, publisher: string): Evidence => ({ id, tool: "get_economic_news", label: "기사", values: { title: "t", publisher, publishedAt, body: "available" }, source: { name: publisher, url: "https://example.com/a", asOf: publishedAt } });
    expect(newsCountLine([news("E1-1", "2026-11-20", "연합뉴스"), news("E1-2", "2026-11-19", "연합뉴스")])).toBe("기사 2건 · 2026. 11. 19. ~ 2026. 11. 20. · 연합뉴스");
    expect(newsCountLine([news("E1-1", "2026-11-20", "연합뉴스")])).toBe("기사 1건 · 2026. 11. 20. · 연합뉴스");
  });
});

describe("ETF 카드 한 줄 (11/21 QA-02)", () => {
  it("기초지수가 있으면 무엇을 따라가는지, 아니면 없음", async () => {
    const { etfBasisNote } = await import("./format");
    expect(etfBasisNote({ tool: "get_etf_kr_price", values: { name: "KODEX 200", baseIndex: "코스피 200" } })).toBe("코스피 200 지수를 따라가는 국내 상장 ETF");
    expect(etfBasisNote({ tool: "get_etf_kr_price", values: { name: "KODEX 200" } })).toBeNull();
    expect(etfBasisNote({ tool: "get_fx_krw_rate", values: { baseIndex: "x" } })).toBeNull();
  });
});
