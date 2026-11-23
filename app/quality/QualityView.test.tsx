import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QualityView } from "./QualityView";

const weekly = [
  { at: "2026-11-13T22:17:00.000Z", questions: 19, errors: 0, avgMs: 19100, allOk: true, runUrl: null, metrics: [
    { label: "의도 일치", pass: 17, total: 19, rate: 17 / 19, threshold: 0.8, ok: true },
    { label: "검증 통과", pass: 18, total: 19, rate: 18 / 19, threshold: 0.9, ok: true },
  ] },
  { at: "2026-11-20T22:17:00.000Z", questions: 19, errors: 1, avgMs: 21000, allOk: false, runUrl: null, metrics: [
    { label: "의도 일치", pass: 14, total: 19, rate: 14 / 19, threshold: 0.8, ok: false },
    { label: "검증 통과", pass: 19, total: 19, rate: 1, threshold: 0.9, ok: true },
  ] },
];
const ops = { since: "2026-11-10T00:00:00.000Z", until: "2026-11-17T00:00:00.000Z", reports: 56, successRate: 0.95, p90Ms: 40200, avgMs: 27000, cost: { usd: 0.0112, krw: 14.95, partial: false }, truncated: false };

describe("QualityView (심사용 공개 페이지)", () => {
  it("주간 평가를 날짜 열 · 지표 행으로 그리고, 기준 미달 칸을 표시한다", () => {
    const $ = load(renderToStaticMarkup(<QualityView weekly={weekly} ops={ops} generatedAt="2026-11-17T06:00:00.000Z" />));
    const heads = $("table").first().find("thead th").map((_, el) => $(el).text()).get();
    expect(heads[0]).toBe("지표");
    expect(heads[1]).toContain("11. 14.");
    expect(heads[2]).toContain("오류 1");
    const rows = $("table").first().find("tbody tr").map((_, el) => $(el).find("th").text()).get();
    expect(rows).toEqual(["의도 일치", "검증 통과", "리포트 평균 시간", "모든 지표 기준 안"]);
    const intent = $("table").first().find("tbody tr").first().find("td");
    expect(intent.eq(0).text()).toContain("89%");
    expect(intent.eq(1).text()).toContain("74%");
    expect(intent.eq(1).attr("class")).toMatch(/bad/);
    expect($("table").first().find("tbody tr").last().find("td").map((_, el) => $(el).text()).get()).toEqual(["예", "아니오"]);
  });

  it("운영 7일 · 기준선 · 만든 것 숫자와 확인 링크를 보여 주고, 질문 원문은 없다", () => {
    const html = renderToStaticMarkup(<QualityView weekly={weekly} ops={ops} generatedAt="2026-11-17T06:00:00.000Z" />);
    const $ = load(html);
    const tiles = $("dl").first().find("dd").map((_, el) => $(el).text()).get();
    expect(tiles[0]).toBe("56건");
    expect(tiles[1]).toBe("95%");
    expect(tiles[2]).toContain("40.2초");
    expect(tiles[4]).toContain("$0.011 · 약 15원");
    expect(html).toContain("561.5일 전");
    expect(html).toContain("946");
    expect($("a[href='/compare']").length).toBe(1);
    expect($("a[href='/replay']").length).toBe(1);
    // 실행 기록의 질문 · 오류 문구 같은 건 넘기지도 않고 그리지도 않습니다
    expect(html).not.toContain("error");
  });

  it("기록이 없으면 안내 문구로 대신한다", () => {
    const html = renderToStaticMarkup(<QualityView weekly={[]} ops={null} generatedAt="2026-11-17T06:00:00.000Z" />);
    expect(html).toContain("아직 기록이 없어요");
    expect(html).toContain("실행 기록을 지금 읽지 못했어요");
  });
});
