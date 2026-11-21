import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Chart } from "@/src/agent/schema";
import { ReportChart, fxUnitLabel, nearestIndex } from "./ReportChart";

function chart(title: string, unit: string): Chart {
  return { kind: "line", title, unit, series: [{ label: title, ref: "E1", points: [{ t: "2026-10-20", v: 839.69 }, { t: "2026-11-05", v: 841.1 }, { t: "2026-11-19", v: 836.49 }] }] };
}

describe("차트 설명 (11/19 페르소나 테스트: 엔화 차트에 '지표 이')", () => {
  it("환율 단위를 통화별 한글 라벨로 읽는다", () => {
    expect(fxUnitLabel("KRW per 1 USD")).toBe("1달러당 원화 금액");
    expect(fxUnitLabel("KRW per 100 JPY")).toBe("100엔당 원화 금액");
    expect(fxUnitLabel("KRW per 1 EUR")).toBe("1유로당 원화 금액");
    expect(fxUnitLabel("2020=100")).toBeNull();
    expect(fxUnitLabel(undefined)).toBeNull();
  });

  it("엔화 · 유로 차트도 '환율' 로 부르고 단위 문장을 통화에 맞춘다", () => {
    const $ = load(renderToStaticMarkup(<ReportChart chart={chart("JPY(100)/KRW 최근 30일", "KRW per 100 JPY")} evidence={[]} />));
    const text = $.text();
    expect(text).toContain("환율 변화를 확인해 보세요");
    expect(text).toContain("100엔당 원화 금액을 원 단위로 표시했어요");
    expect(text).toContain("환율이 839.69에서 836.49로");
    expect(text).not.toContain("지표");
    const eur = load(renderToStaticMarkup(<ReportChart chart={chart("EUR/KRW 최근 30일", "KRW per 1 EUR")} evidence={[]} />)).text();
    expect(eur).toContain("1유로당 원화 금액(원)");
  });

  it("환율이 아닌 차트는 제목으로 주제를 고르고, 모르면 지표 값으로 적는다", () => {
    const text = load(renderToStaticMarkup(<ReportChart chart={chart("소비자물가지수 최근 12개월", "2020=100")} evidence={[]} />)).text();
    expect(text).toContain("물가 변화를 확인해 보세요");
    expect(text).toContain("2020=100 기준으로 표시했어요");
  });
});

describe("차트 인터랙티브 (11/21 사용자 요청)", () => {
  it("화면 위치에 가장 가까운 점을 고른다", () => {
    expect(nearestIndex([10, 20, 30], 24)).toBe(1);
    expect(nearestIndex([10, 20, 30], 26)).toBe(2);
    expect(nearestIndex([10], 100)).toBe(0);
  });
  it("처음에는 안내 문장과 짚을 수 있는 투명 판만 있고 말풍선은 없다", () => {
    const chart = { kind: "line" as const, title: "USD/KRW 최근 30일", unit: "KRW per 1 USD", series: [{ label: "달러당 원화", ref: "E1", points: [{ t: "2026-10-19", v: 1365.1 }, { t: "2026-11-19", v: 1392.4 }] }] };
    const $ = load(renderToStaticMarkup(<ReportChart chart={chart} evidence={[]} />));
    expect($("rect.chart-hover-target")).toHaveLength(1);
    expect($(".chart-hover")).toHaveLength(0);
    expect($(".chart-hover-text").text()).toContain("그날 값");
  });
});
