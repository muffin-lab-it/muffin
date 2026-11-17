import { describe, expect, it } from "vitest";
import type { EvalRow } from "./admin-evals";
import { opsPoint, weeklyPoints } from "./quality";

const row = (at: string, over: Partial<EvalRow> = {}): EvalRow => ({
  id: at, at, source: "ci", tag: null, set_name: null, questions: 19, errors: 0, avg_ms: 19000, models: null, tokens: null,
  rates: { intent: { pass: 17, total: 19, rate: 17 / 19 }, verification: { pass: 18, total: 19, rate: 18 / 19 }, latency: { pass: 19, total: 19, rate: 1 } },
  thresholds: { intent: 0.8, verification: 0.9, latency: 0.9 },
  failed: [], run_url: null, summary: null, ...over,
});

describe("quality: 공개 페이지 데이터", () => {
  it("주간 줄을 오래된 것부터 늘어놓고, 지표 라벨 · 통과율 · 기준 · 모든 지표 기준 안 여부를 만든다", () => {
    const pts = weeklyPoints([row("2026-11-20T22:17:00.000Z", { rates: { intent: { pass: 14, total: 19, rate: 14 / 19 } }, thresholds: { intent: 0.8 } }), row("2026-11-13T22:17:00.000Z")]);
    expect(pts.map((p) => p.at.slice(5, 10))).toEqual(["11-13", "11-20"]);
    expect(pts[0]!.metrics.map((m) => m.label)).toEqual(["의도 일치", "검증 통과", "55초 안"]);
    expect(pts[0]!.metrics[0]).toMatchObject({ pass: 17, total: 19, threshold: 0.8, ok: true });
    expect(pts[0]!.allOk).toBe(true);
    expect(pts[1]!.allOk).toBe(false);
  });

  it("운영 집계에서는 리포트 수 · 성공률 · p90 · 평균 · 비용만 꺼낸다", () => {
    const s = { range: "7d", since: "a", until: "b", total: 60, ok: 57, failed: 3, time: { count: 56, avgMs: 27000, p90Ms: 40000 }, cost: { count: 10, avg: { usd: 0.01, krw: 13.4, partial: false }, total: { usd: 0.1, krw: 134, partial: false }, unknown: 46 } } as never;
    expect(opsPoint(s)).toEqual({ since: "a", until: "b", reports: 56, successRate: 0.95, p90Ms: 40000, avgMs: 27000, cost: { usd: 0.01, krw: 13.4, partial: false }, truncated: false });
    expect(opsPoint({ range: "7d", since: "a", until: "b", total: 0, ok: 0, failed: 0, time: null, cost: null } as never, true)).toMatchObject({ reports: 0, successRate: null, p90Ms: null, cost: null, truncated: true });
  });
});
