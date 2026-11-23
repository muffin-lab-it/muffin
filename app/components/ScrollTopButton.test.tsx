import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScrollTopButton, showsScrollTop } from "./ScrollTopButton";

describe("맨 위로 버튼 (11/23)", () => {
  it("화면 높이의 0.8배(최소 480px)보다 내려가야 나타난다", () => {
    expect(showsScrollTop(0, 900)).toBe(false);
    expect(showsScrollTop(700, 900)).toBe(false);
    expect(showsScrollTop(760, 900)).toBe(true);
    expect(showsScrollTop(470, 400)).toBe(false);
    expect(showsScrollTop(500, 400)).toBe(true);
  });
  it("서버 첫 화면에서는 숨긴 상태로 그리고, 읽는 사람에게 이름을 알려 준다", () => {
    const $ = load(renderToStaticMarkup(<ScrollTopButton />));
    const button = $("button.scroll-top");
    expect(button).toHaveLength(1);
    expect(button.attr("aria-label")).toBe("맨 위로 가기");
    expect(button.attr("data-visible")).toBeUndefined();
  });
});
