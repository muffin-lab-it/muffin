import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportActions } from "./ReportActions";

describe("리포트 동작 버튼", () => {
  it("보관은 자동이라 PDF 버튼만 있다 (11/20)", () => {
    const $ = load(renderToStaticMarkup(<ReportActions />));
    expect($("button").map((_, el) => $(el).text()).get()).toEqual(["PDF로 담기"]);
    expect($.text()).not.toContain("보관");
  });
});
