import { describe, expect, it } from "vitest";
import type { Evidence } from "@/src/agent/schema";
import { evidenceCategory } from "./reportCategory";

const entry = (tool: string, label: string, lineage?: Evidence["lineage"]): Evidence => ({ id: "E1", tool, label, values: {}, source: { name: "x", url: "https://example.com", asOf: "2026-11-19" }, lineage });

describe("출처 묶음 이름 (11/22 운영 확인: 지수가 '기타 자료' 로)", () => {
  it("코스피 · 미국 지수 tool 은 지수", () => {
    expect(evidenceCategory(entry("get_kr_stock_index", "코스피 지수 확인"))).toBe("지수");
    expect(evidenceCategory(entry("get_us_stock_index", "S&P 500 지수 확인"))).toBe("지수");
  });
  it("소비자물가지수 라벨은 물가, 코스피 라벨만으로는 지수가 아니다 (Codex 리뷰)", () => {
    expect(evidenceCategory(entry("get_macro_indicators", "물가·고용 지표 확인 · 한국은행 ECOS — 소비자물가지수 총지수"))).toBe("물가");
    expect(evidenceCategory(entry("get_korean_economic_news", "코스피 급락 기사"))).toBe("뉴스");
  });
  it("ETF 와 계산은 그대로", () => {
    expect(evidenceCategory(entry("get_etf_kr_price", "KODEX 200 (코스피 200)"))).toBe("ETF");
    expect(evidenceCategory(entry("calc_metrics", "코스피 종가 (기사 보도)", { op: "diff", inputs: ["E1"] }))).toBe("계산");
  });
});
