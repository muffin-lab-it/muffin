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

describe("차트 조사와 지수 주제 (11/22)", () => {
  it("받침에 따라 이 · 가", async () => {
    const { particle } = await import("./ReportChart");
    expect(particle("환율")).toBe("이");
    expect(particle("지수")).toBe("가");
    expect(particle("물가")).toBe("가");
    expect(particle("금리")).toBe("가");
  });
  it("지수 차트는 '지수가 … 내렸어요'", () => {
    const chart = { kind: "line" as const, title: "코스피 2026-10-20 ~ 2026-11-19", unit: "지수(포인트)", series: [{ label: "코스피", ref: "E1", points: [{ t: "2026-10-20", v: 5553 }, { t: "2026-11-19", v: 5138 }] }] };
    const text = load(renderToStaticMarkup(<ReportChart chart={chart} evidence={[]} />)).text();
    expect(text).toContain("지수가 5,553에서 5,138로");
    expect(text).not.toContain("지표이");
  });
});

describe("1년 차트 (11/23 백엔드 #144 관계 질문)", () => {
  const yearChart = () => {
    const points = [] as { t: string; v: number }[];
    for (let i = 0; i <= 365; i += 2) {
      const t = new Date(Date.UTC(2025, 10, 20) + i * 86_400_000).toISOString().slice(0, 10);
      points.push({ t, v: 4005 + i * 2.37 });
    }
    points.push({ t: "2026-11-20", v: 4869.96 });
    return { kind: "line" as const, title: "코스피 2025-11-20 ~ 2026-11-20", unit: "지수(포인트)", series: [{ label: "코스피", ref: "E1", points }] };
  };
  it("양 끝에 연도를 붙이고 가운데 달 눈금을 둔다", () => {
    const $ = load(renderToStaticMarkup(<ReportChart chart={yearChart()} evidence={[]} />));
    const axis = $(".chart-axis text").map((_, el) => $(el).text()).get();
    expect(axis[0]).toBe("25.11.20");
    expect(axis[axis.length - 1]).toBe("26.11.20");
    expect(axis.length).toBeGreaterThanOrEqual(4);
    expect(axis.some(label => /^26년 \d+월$/.test(label))).toBe(true);
    expect($(".chart-month-line").length).toBe(axis.length - 2);
    expect($(".chart-line").attr("class")).toContain("chart-line-dense");
  });
  it("설명은 연도 · 1년간 · 지수 이름, 숫자 뒤 조사는 소리에 맞춰", () => {
    const text = load(renderToStaticMarkup(<ReportChart chart={yearChart()} evidence={[]} />)).text();
    expect(text).toContain("코스피 1년 변화를 확인해 보세요");
    expect(text).toContain("코스피 지수가 4,005에서 4,870으로");
    expect(text).toContain("2025년 11월 20일부터 2026년 11월 20일까지 1년간의 코스피 변화 그래프예요");
  });
  it("숫자 뒤 로 · 으로", async () => {
    const { roParticle } = await import("./ReportChart");
    expect(roParticle("4,870")).toBe("으로");
    expect(roParticle("1,336")).toBe("으로");
    expect(roParticle("836.49")).toBe("로");
    expect(roParticle("5,138")).toBe("로");
    expect(roParticle("1,337")).toBe("로");
    expect(roParticle("1,333")).toBe("으로");
  });
});
