import { describe, expect, it } from "vitest";
import type { Evidence } from "@/src/agent/schema";
import { formatDateKo, fxBasisNote, newsCountLine, sourceLinkLabel, valueTone } from "./format";

describe("날짜 · 색 · 기준 설명 · 링크 라벨 (11/21 QA 1묶음)", () => {
  it("날짜는 2026. 11. 20. 꼴로, 날짜가 아니면 그대로", () => {
    expect(formatDateKo("2026-11-20")).toBe("2026. 11. 20.");
    expect(formatDateKo("2026-01-05T09:00:00Z")).toBe("2026. 1. 5.");
    expect(formatDateKo("2026년 10월")).toBe("2026년 10월");
    expect(formatDateKo("2026-10")).toBe("2026. 10.");
    expect(formatDateKo("2026-13")).toBe("2026-13");
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

describe("기사 건수 줄의 언론사 (11/22)", () => {
  it("넷 이상이면 셋만 적고 외 N곳", () => {
    const news = (id: string, publisher: string): Evidence => ({ id, tool: "get_economic_news", label: "기사", values: { title: "t", publisher, publishedAt: "2026-11-21", body: "unavailable" }, source: { name: publisher, url: "https://example.com/a", asOf: "2026-11-21" } });
    expect(newsCountLine(["한국경제", "경남일보", "국제신문", "매일경제", "연합뉴스"].map((p, i) => news(`E1-${i}`, p)))).toBe("기사 5건 · 2026. 11. 21. · 한국경제 · 경남일보 · 국제신문 외 2곳");
  });
});

describe("문장 속 날짜 (11/22 운영: '2026-10월 2.5%예요')", () => {
  it("연월 · 날짜 · 기간을 한국어로", async () => {
    const { prettyDates } = await import("./format");
    expect(prettyDates("한국의 계절조정 실업률은 2026-10월 2.5%예요.")).toBe("한국의 계절조정 실업률은 2026년 10월 2.5%예요.");
    expect(prettyDates("2026-10 기준 2.82% 올랐어요")).toBe("2026년 10월 기준 2.82% 올랐어요");
    expect(prettyDates("2026-11-20 기준 3%로, 2025-11-20보다 높아요")).toBe("2026년 11월 20일 기준 3%로, 2025년 11월 20일보다 높아요");
    expect(prettyDates("최근 30일(2026-10-20~2026-11-19)")).toBe("최근 30일(2026년 10월 20일~11월 19일)");
    expect(prettyDates("2025-12-20 ~ 2026-01-19")).toBe("2025년 12월 20일~2026년 1월 19일");
    expect(prettyDates("2025-10의 2.38%에서 2026-10의 2.82%로")).toBe("2025년 10월의 2.38%에서 2026년 10월의 2.82%로");
  });
  it("날짜가 아닌 것은 건드리지 않는다", async () => {
    const { prettyDates } = await import("./format");
    expect(prettyDates("(2020=100) 지수 120.73")).toBe("(2020=100) 지수 120.73");
    expect(prettyDates("https://example.com/2026-11-20/article")).toBe("https://example.com/2026-11-20/article");
    expect(prettyDates("2026-13 은 달이 아님, 1,392.40원")).toBe("2026-13 은 달이 아님, 1,392.40원");
    expect(prettyDates("2026-11-20T09:00:00Z")).toBe("2026-11-20T09:00:00Z");
  });
});
