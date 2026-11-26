import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: ({ src, alt, ...props }: { src: string; alt: string; preload?: boolean; sizes?: string }) => { const { preload, ...rest } = props; void preload; return createElement("img", { src: typeof src === "string" ? src : "/mascot.png", alt, ...rest }); } }));
import Home from "../page";
import HistoryPage from "../history/page";
import * as homeReport from "./home-report";
import { ApiError } from "@/src/lib/api";

afterEach(() => { vi.restoreAllMocks(); });

describe("홈과 보관함 기본 상태", () => {
  it("질문을 비워 두고 Auto 머핀을 기본 선택하며 기존 요청 길이를 유지한다", () => {
    const $ = load(renderToStaticMarkup(<Home />));
    expect($("textarea").text()).toBe("");
    expect($("textarea").attr("maxlength")).toBe("500");
    expect($("input[name=area]")).toHaveLength(6);
    expect($("input[name=area][checked]").closest("label").text()).toContain("Auto 머핀");
    expect($("input[name=depth][checked]").attr("value")).toBe("easy");
    expect($("button[type=submit]").attr("disabled")).toBeDefined();
    // 11/26 사용자: 질문칸 제목은 보이는 '무엇이 궁금하세요?' (전에는 읽기 도구용 '궁금한 금융 질문')
    expect($("label[for=question]").text()).toBe("무엇이 궁금하세요?");
    expect($("[aria-label='리포트 생성 진행']")).toHaveLength(0);
  });
  it("콘셉트 순서 · 칸마다 그림 · 쉬운 난이도 설명 (11/26 사용자)", () => {
    const $ = load(renderToStaticMarkup(<Home />));
    expect($("form legend").map((_, el) => $(el).text()).get()).toEqual(["관심 영역", "분석 난이도"]);
    // 관심 영역 → 분석 난이도 → 질문 → 굽기 순서 (굽기는 질문칸과 같은 판 안)
    const order = $("form").find("legend, textarea, button[type=submit]").map((_, el) => el.tagName === "legend" ? $(el).text() : el.tagName).get();
    expect(order).toEqual(["관심 영역", "분석 난이도", "textarea", "button"]);
    expect($("textarea").closest("div").parent().find("button[type=submit]")).toHaveLength(1);
    expect($("input[name=area]").closest("label").find("svg")).toHaveLength(6);
    expect($("input[name=depth]").closest("label").find("svg")).toHaveLength(3);
    expect($("input[name=depth]").closest("label").map((_, el) => $(el).text()).get()).toEqual(["Easy쉽게 설명해줘요25초 이내", "Standard보통이에요30초 이내", "Deep Dive심층적이에요45초 이내"]);
  });
  it("보관함이 조회되기 전에 빈 상태로 오인시키지 않는다", () => {
    const $ = load(renderToStaticMarkup(<HistoryPage />));
    expect($("h1").text()).toBe("보관함");
    expect($("[role=status]").text()).toContain("불러오고 있어요");
    expect($.text()).not.toContain("아직 담아 둔 리포트가 없어요");
    expect($("label[for=history-search]").text()).toBe("질문으로 리포트 검색");
  });
});

describe("홈에서 지원 범위와 서버 오류를 구분", () => {
  const question = "한국 기준금리는?";
  async function failedHome(message: string, status: number, retryAfterSec?: number) {
    const request = homeReport.createHomeReport({ streamReport: vi.fn().mockRejectedValue(new ApiError(message, status, "error-1", retryAfterSec)), saveReport: vi.fn(), getReport: vi.fn() }, vi.fn());
    await request.start({question, depth: "easy", area: "rate"});
    vi.spyOn(homeReport, "createHomeReport").mockReturnValue(request);
    return load(renderToStaticMarkup(<Home />));
  }
  it("조사 오류 문구를 그대로 보여주고 지원 범위 안내 대신 재시도를 제공한다", async () => {
    const message = "조사 중 오류가 생겼어요. 잠시 후 다시 시도해 주세요.";
    const $ = await failedHome(message, 500);
    expect($("[role=alert]").text()).toContain(message);
    expect($("[role=alert] button").text()).toBe("다시 시도");
    expect($("[role=alert] button").attr("type")).toBe("button");
    expect($.text()).not.toContain("이 질문은 아직 답하기 어려워요.");
  });
  it("429 오류는 대기 시간 동안 재시도를 비활성화한다", async () => {
    const $ = await failedHome("요청이 많아요.", 429, 30);
    expect($("[role=alert] button").text()).toBe("30초 후 다시 시도");
    expect($("[role=alert] button").attr("disabled")).toBeDefined();
  });
  it.each([400,403,413,503])("HTTP %s는 오류를 표시하되 기존 정책대로 재시도 버튼을 숨긴다", async status => {
    const $ = await failedHome("서버 안내", status);
    expect($("[role=alert]").text()).toBe("서버 안내");
    expect($("[role=alert] button")).toHaveLength(0);
    expect($.text()).not.toContain("이 질문은 아직 답하기 어려워요.");
  });
  it("서버가 범위 밖으로 분류한 경우에만 지원 범위 안내를 표시한다", async () => {
    const request = homeReport.createHomeReport({ streamReport: vi.fn().mockImplementation(async (_, emit) => {
      emit({type: "plan", mode: "out_of_scope", intent: "out_of_scope", tools: []});
      throw new Error("late failure");
    }), saveReport: vi.fn(), getReport: vi.fn() }, vi.fn());
    await request.start({question: "오늘 점심은?", depth: "easy"});
    vi.spyOn(homeReport, "createHomeReport").mockReturnValue(request);
    const $ = load(renderToStaticMarkup(<Home />));
    expect($("[role=alert] h2").text()).toBe("이 질문은 아직 답하기 어려워요.");
    // 11/21 외부 F1: 다시 시도 버튼은 없고 "지우고 다시 쓰기" 만
    expect($("[role=alert] button").map((_, el) => $(el).text()).get()).toEqual(["지우고 다시 쓰기"]);
  });
});
