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

describe("막대 차트 · 비율 선 차트 (11/23)", () => {
  const etf = (label: string, ref: string, v: number) => ({ label, ref, points: [{ t: "2026-11-20", v }] });
  it("시리즈마다 막대 하나, 0 기준 색 · 부호, 가장 높은 · 낮은 것", () => {
    const chart = { kind: "bar" as const, title: "대표 ETF 최근 30일 가격 수익률", unit: "%", series: [etf("KODEX 200 (국내 대형주)", "E3", -15.06), etf("ACE 국고채10년 (국내 국채)", "E7", 2.71), etf("KODEX 코스닥150 (국내 코스닥)", "E4", -21.1)] };
    const $ = load(renderToStaticMarkup(<ReportChart chart={chart} evidence={[]} />));
    expect($(".chart-svg")).toHaveLength(0);
    expect($(".bar-rows li")).toHaveLength(3);
    expect($(".bar-value").map((_, el) => $(el).text()).get()).toEqual(["-15.06%", "+2.71%", "-21.10%"]); // 카드와 같은 꼴 (11/23 운영 검수)
    expect($(".bar-fill").eq(1).attr("class")).toContain("tone-up");
    expect($(".bar-fill").eq(0).attr("class")).toContain("tone-down");
    expect($(".chart-summary").text()).toContain("가장 높은 것은 ACE 국고채10년 (국내 국채) +2.71%, 가장 낮은 것은 KODEX 코스닥150 (국내 코스닥) -21.10%예요.");
    expect($(".chart-summary").text()).toContain("2026년 11월 20일 기준이에요.");
  });
  it("비율(%) 선 차트는 %p 로 변화를 말하고 월별 점은 '2026년 10월'", () => {
    const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const chart = { kind: "line" as const, title: "한국 소비자물가 상승률 (전년 같은 달 대비)", unit: "%", series: [{ label: "한국 CPI", ref: "E1", points: months.map((t, i) => ({ t, v: Number((2.38 + i * 0.04).toFixed(2)) })) }] };
    const $ = load(renderToStaticMarkup(<ReportChart chart={chart} evidence={[]} />));
    const text = $.text();
    expect(text).toContain("한국 소비자물가 상승률이 2.38%에서 2.82%로 0.44%p 올랐어요");
    expect(text).toContain("2025년 11월부터 2026년 10월까지 1년간의 한국 소비자물가 상승률 변화 그래프예요. 단위는 %예요.");
    expect(text).toContain("그달 값이 보여요");
    expect($("svg").attr("aria-label")).toContain("(+0.44%p)");
    const axis = $(".chart-axis text").map((_, el) => $(el).text()).get();
    expect(axis[0]).toBe("25.11");
    expect(axis[axis.length - 1]).toBe("26.10");
    expect($(".chart-grid text").first().text()).toMatch(/%$/);
  });
});

describe("11/23 운영 검수", () => {
  it("막대 차트 제목의 ISO 기간을 한국어로 보여 준다", () => {
    const etf = (label: string, v: number) => ({ label, ref: "E1", points: [{ t: "2026-11-20", v }] });
    const chart = { kind: "bar" as const, title: "대표 ETF 최근 30일 가격 수익률 (2026-10-21~2026-11-20)", unit: "%", series: [etf("A", 1), etf("B", -2)] };
    const $ = load(renderToStaticMarkup(<ReportChart chart={chart} evidence={[]} />));
    expect($("figcaption").text()).toBe("대표 ETF 최근 30일 가격 수익률 (2026년 10월 21일~11월 20일)");
  });
});
