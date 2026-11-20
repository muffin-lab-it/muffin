import { describe, expect, it } from "vitest";
import { reportTopics, supportedReportTopics } from "./report-topics";

describe("지원되는 후속 질문", () => {
  it("지원하지 않는 키워드만 있으면 임의의 질문을 만들지 않는다", () => {
    expect(supportedReportTopics(["내 계좌 잔액", "비트코인 내일 가격"])).toEqual([]);
  });
  it("개념형 금리 주제를 조회 가능한 질문과 금리 영역으로 연결한다", () => {
    const [topic] = supportedReportTopics(["정책금리와 실효금리의 차이"], "fx");
    expect(topic.area).toBe("rate");
    expect(reportTopics).toContain(topic);
    expect(topic.question).toContain("최근 30일");
  });
  it("중복과 현재 질문을 제외한다", () => {
    const current = reportTopics[0].question;
    const topics = supportedReportTopics([current, current, "엔화 환율"], "fx", current);
    expect(new Set(topics.map(topic => topic.question)).size).toBe(topics.length);
    expect(topics.some(topic => topic.question === current)).toBe(false);
  });
  it("추천이 없으면 새로 채우지 않는다", () => {
    expect(supportedReportTopics([], "rate")).toEqual([]);
  });
});
