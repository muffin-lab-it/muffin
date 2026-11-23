import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { cpiChart, cpiTrendCountry, cpiTrendHidden, ensureCpiTrend, trendPoints } from "./cpi-trend";
import type { Evidence } from "./schema";

const months = ["202511", "202512", "202601", "202602", "202603", "202604", "202605", "202606", "202607", "202608", "202609", "202610"];
const raw = (n = 12, gap = false) => ({
  observations: months.slice(12 - n).map((month, i) => ({ month, value: 118 + i * 0.2, previousYear: { month: "", value: 0, change: gap && i === n - 1 ? null : 2.3 + i * 0.05 } })),
});
const cpi = (id: string, country = "KR"): Evidence => ({
  id,
  tool: "get_macro_indicators",
  label: "물가",
  values: { country, indicator: "cpi", "latest.month": "202610", "latest.value": 120.73, "latest.previousYear.change": 2.82 },
  source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr/", asOf: "2026-10-01" },
});

describe("물가 질문의 1년 상승률 선 (11/23, 화면 #149)", () => {
  it("물가를 말한 질문만, 나라는 질문의 나라. 관계 질문 · 기간을 정한 질문은 아니다", () => {
    expect(cpiTrendCountry("요즘 물가 어때?")).toBe("KR");
    expect(cpiTrendCountry("미국 물가 요즘 어때?")).toBe("US");
    expect(cpiTrendCountry("요즘 물가 왜 이렇게 올라?")).toBe("KR");
    expect(cpiTrendCountry("물가와 금리 관계 알려줘")).toBeNull();
    expect(cpiTrendCountry("작년 물가 어땠어?")).toBeNull();
    expect(cpiTrendCountry("환율 왜 올라?")).toBeNull();
  });

  it("달마다 tool 이 계산한 전년 같은 달 대비 상승률로 점을 만들고(t 는 YYYY-MM), 값이 없는 달은 뺀다", () => {
    const points = trendPoints(raw());
    expect(points).toHaveLength(12);
    expect(points[0]).toEqual({ t: "2025-11", v: 2.3 });
    expect(trendPoints(raw(12, true))).toHaveLength(11);
    expect(trendPoints(undefined)).toEqual([]);
  });

  it("12개월 항목이 없으면 물가 tool 을 12개월로 한 번 부르고, 있으면 부르지 않는다. 실패하면 null", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([cpi("E1")]);
    ctx.raw.set("E1", raw(1));
    const invoke = vi.fn(async (...args: [unknown, string]) => {
      if (args.length) {
        ctx.addEvidence([cpi("E2")]);
        ctx.raw.set("E2", raw());
      }
      return "ok";
    });
    expect(await ensureCpiTrend(ctx, "요즘 물가 어때?", [{ name: "get_macro_indicators", invoke }])).toBe("E2");
    expect(JSON.parse(invoke.mock.calls[0]![1])).toEqual({ country: "KR", indicator: "cpi", endMonth: null, months: 12 });
    expect(await ensureCpiTrend(ctx, "요즘 물가 어때?", [{ name: "get_macro_indicators", invoke }])).toBe("E2");
    expect(invoke).toHaveBeenCalledTimes(1);
    const failed = new ResearchContext();
    await expect(ensureCpiTrend(failed, "요즘 물가 어때?", [{ name: "get_macro_indicators", invoke: vi.fn(async () => { throw new Error("실패"); }) }])).resolves.toBeNull();
    expect(await ensureCpiTrend(new ResearchContext(), "환율 왜 올라?", [{ name: "get_macro_indicators", invoke }])).toBeNull();
  });

  it("같은 나라 물가 항목이 따로 있을 때만 12개월 항목을 작성에게 숨긴다", () => {
    expect([...cpiTrendHidden([cpi("E1"), cpi("E2")], "E2")]).toEqual(["E2"]);
    expect(cpiTrendHidden([cpi("E2")], "E2").size).toBe(0);
    expect(cpiTrendHidden([cpi("E1", "US"), cpi("E2")], "E2").size).toBe(0);
  });

  it("차트는 kind line · unit '%' · 제목 괄호 앞이 주어. 점이 셋 미만이면 null", () => {
    expect(cpiChart(cpi("E2"), raw())).toEqual({
      kind: "line",
      title: "한국 소비자물가 상승률 (전년 같은 달 대비)",
      unit: "%",
      series: [{ label: "한국 소비자물가 상승률", ref: "E2", points: trendPoints(raw()) }],
    });
    expect(cpiChart(cpi("E2", "US"), raw())?.title).toBe("미국 소비자물가 상승률 (전년 같은 달 대비)");
    expect(cpiChart(cpi("E2"), raw(2))).toBeNull();
  });
});
