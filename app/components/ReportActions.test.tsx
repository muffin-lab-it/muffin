import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pdfTitle, ReportActions } from "./ReportActions";

describe("리포트 동작 버튼", () => {
  it("보관은 자동이라 PDF 버튼만 있다 (11/20)", () => {
    const $ = load(renderToStaticMarkup(<ReportActions question="요즘 환율 왜 올라?" createdAt="2026-11-20T03:00:00Z" />));
    expect($("button").map((_, el) => $(el).text()).get()).toEqual(["PDF로 담기"]);
    expect($.text()).not.toContain("보관");
  });
  it("PDF 기본 파일명은 MuffinLab_날짜_질문 (11/21 서영 2)", () => {
    expect(pdfTitle("요즘 환율 왜 올라?", "2026-11-20T03:00:00Z")).toBe("MuffinLab_261120_요즘 환율 왜 올라");
    expect(pdfTitle("a/b:c*d?e\"f<g>h|i", "2026-11-20T16:30:00Z")).toBe("MuffinLab_261121_a b c d e f g h i");
    expect(pdfTitle("", "bad date", new Date("2026-11-21T00:00:00Z"))).toBe("MuffinLab_261121");
    expect(pdfTitle("가".repeat(40), "2026-11-20T03:00:00Z")).toBe(`MuffinLab_261120_${"가".repeat(30)}`);
  });
});
