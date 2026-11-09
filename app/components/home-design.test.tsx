import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: ({ src, alt, ...props }: { src: string; alt: string; preload?: boolean; sizes?: string }) => { const { preload, ...rest } = props; void preload; return createElement("img", { src: typeof src === "string" ? src : "/mascot.png", alt, ...rest }); } }));
import Home from "../page";
import HistoryPage from "../history/page";

describe("홈과 보관함 기본 상태", () => {
  it("질문을 비워 두고 Auto 머핀을 기본 선택하며 기존 요청 길이를 유지한다", () => {
    const $ = load(renderToStaticMarkup(<Home />));
    expect($("textarea").text()).toBe("");
    expect($("textarea").attr("maxlength")).toBe("500");
    expect($("input[name=area]")).toHaveLength(6);
    expect($("input[name=area][checked]").closest("label").text()).toContain("Auto 머핀");
    expect($("input[name=depth][checked]").attr("value")).toBe("easy");
    expect($("button[type=submit]").attr("disabled")).toBeDefined();
    expect($("label[for=question]").text()).toBe("궁금한 금융 질문");
    expect($("[aria-label='리포트 생성 진행']")).toHaveLength(0);
  });
  it("보관함이 조회되기 전에 빈 상태로 오인시키지 않는다", () => {
    const $ = load(renderToStaticMarkup(<HistoryPage />));
    expect($("h1").text()).toBe("보관함");
    expect($("[role=status]").text()).toContain("불러오고 있어요");
    expect($.text()).not.toContain("아직 담아 둔 리포트가 없어요");
    expect($("label[for=history-search]").text()).toBe("질문으로 리포트 검색");
  });
});
