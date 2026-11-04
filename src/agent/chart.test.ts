import { describe, expect, it } from "vitest";
import { displayScale, fxChart } from "./chart";
import type { Movement } from "./movement";
import { reportSchema, type Evidence } from "./schema";
import sample from "./fixtures/report.v2.sample.json";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const movement: Movement = {
  ref: "E1",
  pair: "USD/KRW",
  period: { from: "2026-10-05", to: "2026-11-04", days: 30 },
  movePct: 2.71,
  typicalPct: 1.69,
  zScore: 1.6,
  level: "notable",
  rates: { from: 1300, to: 1335.23 },
  baseline: { from: "2026-07-08", to: "2026-10-05", changes: 89, url: "https://api.frankfurter.dev/v2/rates?x", sourceName: "Frankfurter v2 일별 환율" },
  series: days("2026-10-04", 32).map((date, i) => ({ date, rate: 1300 + i })),
};
const news = (id: string, title: string, publishedAt: string): Evidence => ({
  id,
  tool: "get_korean_economic_news",
  label: `경제 뉴스 확인 · 연합뉴스`,
  values: { title, publishedAt },
  source: { name: "연합뉴스", url: `https://www.yna.co.kr/view/${id}`, asOf: publishedAt },
});

describe("환율 차트", () => {
  it("최근 30일 선 · 평소 폭 띠 · 기간 안의 뉴스 점을 코드가 만든다", () => {
    const chart = fxChart(movement, "C2", [
      news("E4-1", "한은 기준금리 동결", "2026-10-16"),
      news("E4-2", "너무 오래된 기사", "2026-09-01"),
      news("E4-3", "시차 하루 여유 안의 기사", "2026-11-04"),
      news("E4-4", "기간 밖 미래 기사", "2026-11-06"),
      { ...news("E5", "뉴스 아님", "2026-10-20"), tool: "get_rate_data" },
    ])!;
    expect(chart.kind).toBe("line");
    expect(chart.title).toBe("USD/KRW 최근 30일");
    expect(chart.unit).toBe("KRW per 1 USD");
    expect(chart.series[0]).toMatchObject({ label: "USD/KRW", ref: "C2" });
    expect(chart.series[0]!.points).toHaveLength(32);
    expect(chart.series[0]!.points[0]).toEqual({ t: "2026-10-04", v: 1300 });
    expect(chart.band).toEqual({ from: "2026-10-05", to: "2026-11-04", low: 1278.03, high: 1321.97, label: "평소 폭 ±1.69% (직전 90일 기준)" });
    expect(chart.events).toEqual([
      { ref: "E4-1", label: "한은 기준금리 동결", at: "2026-10-16" },
      { ref: "E4-3", label: "시차 하루 여유 안의 기사", at: "2026-11-04" },
    ]);
    // 리포트 모양 검사를 통과한다
    const report = reportSchema.parse({ ...(sample as { report: unknown }).report as object, charts: [chart] });
    expect(report.charts?.[0]?.band?.label).toContain("평소 폭");
  });

  it("엔화는 100엔 기준으로 점과 띠를 만들고, 뉴스 점은 오래된 순 최대 4개 · 라벨은 자른다", () => {
    const jpy: Movement = { ...movement, pair: "JPY(100)/KRW", rates: { from: 910, to: 925 }, series: [{ date: "2026-11-03", rate: 9.1 }, { date: "2026-11-04", rate: 9.25 }] };
    const chart = fxChart(jpy, "C3", Array.from({ length: 6 }, (_, i) => news(`E4-${i}`, `아주아주아주아주아주아주아주아주아주아주아주아주 긴 제목 ${i}`, `2026-11-0${4 - (i % 2)}`)))!;
    expect(displayScale("JPY(100)/KRW")).toBe(100);
    expect(chart.unit).toBe("KRW per 100 JPY");
    expect(chart.series[0]!.points).toEqual([{ t: "2026-11-03", v: 910 }, { t: "2026-11-04", v: 925 }]);
    expect(chart.band?.low).toBe(Number((910 * (1 - 0.0169)).toFixed(2)));
    expect(chart.events).toHaveLength(4);
    expect(chart.events![0]!.at <= chart.events![3]!.at).toBe(true);
    expect(chart.events![0]!.label.length).toBeLessThanOrEqual(28);
    expect(chart.events![0]!.label.endsWith("…")).toBe(true);
  });

  it("일별 환율이 없으면 차트를 만들지 않는다", () => {
    expect(fxChart({ ...movement, series: [] }, "C2", [])).toBeNull();
  });
});
