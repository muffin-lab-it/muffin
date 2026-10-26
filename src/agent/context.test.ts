import { describe, expect, it } from "vitest";
import { ResearchContext } from "./context";
import type { Evidence } from "./schema";

const source = { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-10-19" };
const fx: Evidence = { id: "E1", tool: "get_fx_krw_rate", label: "환율 확인 · Frankfurter v2", values: { rate: 1392.4 }, source };

describe("ResearchContext", () => {
  it("데이터 tool 은 E 번호, 계산은 C 번호를 따로 센다", () => {
    const ctx = new ResearchContext();
    expect([ctx.nextCallId(), ctx.nextCallId(), ctx.nextCalcId(), ctx.nextCallId(), ctx.nextCalcId()]).toEqual(["E1", "E2", "C1", "E3", "C2"]);
  });

  it("장부에 올리면 출처도 쌓이고, url 이 없는 계산 결과는 출처에 넣지 않는다", () => {
    const ctx = new ResearchContext();
    const calc: Evidence = {
      id: "C1",
      tool: "calc_metrics",
      label: "계산 · 한미 금리 차이",
      values: { changePp: 0.88 },
      source: { name: "Muffin 계산", url: "", asOf: "2026-10-16" },
      lineage: { op: "pp_diff", inputs: ["E2", "E3"] },
    };
    ctx.addEvidence([fx, calc]);

    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1", "C1"]);
    expect(ctx.sources).toEqual([source]);
    expect(ctx.findEvidence("C1")?.lineage).toEqual({ op: "pp_diff", inputs: ["E2", "E3"] });
    expect(ctx.findEvidence("E9")).toBeUndefined();
  });

  it("tool 이 끝날 때마다 onStep 을 부른다", () => {
    const seen: string[] = [];
    const ctx = new ResearchContext({ onStep: (s) => seen.push(`${s.tool}:${s.status}`) });
    ctx.addStep({ tool: "get_fx_krw_rate", status: "ok", ms: 3 });
    ctx.addStep({ tool: "get_rate_data", status: "error", ms: 5, error: "x" });
    expect(seen).toEqual(["get_fx_krw_rate:ok", "get_rate_data:error"]);
    expect(ctx.steps).toHaveLength(2);
  });
});
