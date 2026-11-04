import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MuffinEvent } from "@/src/agent/events";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import { reportSchema } from "@/src/agent/schema";
import { Progress, progressFromEvents } from "./Progress";

const render = (events: MuffinEvent[], message?: string) => load(renderToStaticMarkup(
  <Progress question="물가는 왜 올랐어?" events={events} error={message ? { message } : undefined} onRetry={vi.fn()} onEditQuestion={vi.fn()} />,
));

describe("MF-02 진행 화면", () => {
  it("호출 제한 대기 중에는 재시도를 비활성화한다", () => {
    const $ = load(renderToStaticMarkup(<Progress question="질문" events={[]} error={{ status: 429, message: "요청이 많아요", retryAfterSec: 5 }} onRetry={() => {}} />));
    expect($("button").attr("disabled")).toBeDefined();
    expect($("button").text()).toBe("5초 후 다시 시도");
  });
  it.each([403, 503])("%s는 반복 재시도 대신 홈 이동을 제공한다", status => {
    const $ = load(renderToStaticMarkup(<Progress question="질문" events={[]} error={{ status, message: "요청 불가" }} onRetry={() => {}} onEditQuestion={() => {}} />));
    expect($("button")).toHaveLength(0);
    expect($("a").attr("href")).toBe("/");
  });
  it("완료 단계만 진행률에 반영하고 오류가 나도 수치를 늘리지 않는다", () => {
    const events: MuffinEvent[] = [{ type: "stage", stage: "plan", status: "done" }, { type: "stage", stage: "research", status: "start" }];
    expect(render(events)("[role=progressbar]").attr("aria-valuenow")).toBe("20");
    expect(render([...events, { type: "error", message: "실패" }])("[role=progressbar]").attr("aria-valuenow")).toBe("20");
  });
  it("범위 밖 질문은 건너뛴 단계를 완료율 분모에서 제외한다", () => {
    const $ = render([{ type: "stage", stage: "plan", status: "done" }, { type: "plan", mode: "out_of_scope", intent: "out_of_scope", tools: [] }]);
    expect($("[role=progressbar]").attr("aria-valuenow")).toBe("50");
  });
  it("질문·진행 상태·이야기를 분리하고 계획을 실행 중으로 표현하지 않는다", () => {
    const $ = render([{ type: "plan", intent: "cause", mode: "research", tools: ["get_fx_krw_rate", "get_rate_data"] }]);
    expect($("[data-section]").map((_, el) => $(el).attr("data-section")).get()).toEqual(["question", "progress", "story"]);
    const story = $("[data-section=story]").text();
    expect(story).toContain("확인할 계획");
    expect(story).toContain("이렇게 조사할게요: 환율 확인 · 금리 확인");
    expect(story).not.toContain("get_fx_krw_rate");
    expect($.text()).not.toContain("확인할 자료 ·");
    expect($.text()).not.toContain("단계마다 걸리는 시간은 달라요.");
    expect(story).not.toContain("환율을 확인하고 있어요");
  });
  it("이벤트가 없으면 다섯 단계는 대기하고 임의로 시작하지 않는다", () => {
    const $ = render([]);
    expect($("li[data-state=waiting]")).toHaveLength(5);
    expect($.text()).not.toContain("이렇게 조사할게요:");
    expect($("[role=status]").text()).toContain("준비");
    expect($("button")).toHaveLength(0);
  });
  it("실제 단계의 시작과 완료를 반영한다", () => {
    const $ = render([
      { type: "stage", stage: "plan", status: "start" },
      { type: "stage", stage: "plan", status: "done" },
      { type: "stage", stage: "research", status: "start" },
    ]);
    expect($("li[data-state=done]").text()).toContain("질문 살펴보기");
    expect($("[aria-current=step]").text()).toContain("자료 찾기");
    expect($("li[data-state=waiting]")).toHaveLength(3);
  });
  it("범위 밖은 조사·정리·작성만 건너뛴다", () => {
    const $ = render([{ type: "plan", mode: "out_of_scope", intent: "out_of_scope", tools: [] }, { type: "stage", stage: "verify", status: "start" }]);
    expect($("li[data-state=skipped]")).toHaveLength(3);
    expect($.text()).not.toContain("이렇게 조사할게요:");
    expect($("[aria-current=step]").text()).toContain("근거 확인하기");
  });
  it("도구 실패는 전체 실패가 아니며 내부 오류 상세를 노출하지 않는다", () => {
    const $ = render([{ type: "step", step: { tool: "get_macro_indicators", status: "error", ms: 1200, error: "private upstream diagnostic" } }]);
    expect($("[role=alert]")).toHaveLength(0);
    expect($.text()).toContain("일부 자료를 확인하지 못했어요");
    expect($("details").text()).toContain("확인 실패 · 1.2초");
    expect($.text()).not.toContain("private upstream");
  });
  it("시간초과는 현재 단계를 멈추고 요청 ID와 복구 버튼을 표시한다", () => {
    const $ = render([{ type: "stage", stage: "write", status: "start" }, { type: "error", message: "조사 시간이 초과되었습니다.", id: "request-1" }]);
    expect($.text()).toContain("request-1");
    expect($("li[data-state=interrupted]").text()).toContain("중단");
    expect($("[aria-current]")).toHaveLength(0);
    expect($("button").map((_, el) => $(el).text()).get()).toEqual(["다시 시도", "질문 수정"]);
  });
  it("스트림 밖 연결 오류도 실패로 표시한다", () => {
    expect(render([], "네트워크 연결을 확인해 주세요.")("[role=alert]").text()).toContain("네트워크");
  });
  it("종료 오류 뒤의 이벤트를 반영하지 않는다", () => {
    const state = progressFromEvents([{ type: "error", message: "실패" }, { type: "stage", stage: "write", status: "start" }]);
    expect(state.status.write).toBe("waiting");
  });
  it("완성 이벤트는 저장 중 안내로 전환하며 저장 성공을 주장하지 않는다", () => {
    const report = reportSchema.parse(sample.report);
    const $ = render([{ type: "verify", verification: report.verification }, { type: "report", report, steps: [], rewrites: 0, id: "request-2" }]);
    expect($("[role=status]").text()).toContain("저장하고 있어요");
    expect($.text()).not.toContain("저장됐어요");
    expect($.text()).toContain("답변 전체의 정확성을 보장하지");
  });
});
