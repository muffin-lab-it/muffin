import { describe, expect, it } from "vitest";
import sample from "../../src/agent/fixtures/report.v2.sample.json";
import type { ResearchResult } from "../../src/agent/muffin";
import { reportSchema } from "../../src/agent/schema";
import { buildReplay, defaultId, recordable, renderIndex, renderManifest, type Captured } from "./lib";

const result: ResearchResult = {
  report: reportSchema.parse((sample as { report: unknown }).report),
  steps: [{ tool: "get_fx_krw_rate", status: "error", ms: 8_000, error: "HTTP 503 https://api.frankfurter.dev/v2/rates?x=SECRET" }],
  rewrites: 1,
  plan: { intent: "cause", mode: "research", tools: ["get_fx_krw_rate"], reason: "fixture" },
  facts: null,
  model: "gpt-6-luna",
  usage: { requests: 3, inputTokens: 100, outputTokens: 50 },
};
const captured: Captured[] = [
  { t: 0, event: { type: "stage", stage: "plan", status: "start" } },
  { t: 900, event: { type: "plan", intent: "cause", mode: "research", tools: ["get_fx_krw_rate"] } },
  { t: 8_900, event: { type: "step", step: result.steps[0]! } },
  { t: 20_000, event: { type: "report", report: result.report, steps: [], rewrites: 0, id: "x" } },
  { t: 20_001, event: { type: "error", message: "x" } },
];

describe("녹화 만들기", () => {
  it("report · error 이벤트는 빼고, step 의 외부 오류 문구는 지우고, 형식을 검사한다", () => {
    const r = buildReplay(captured, result, { id: "fx-test", question: "환율이 왜 올랐나요?", depth: "standard", area: "fx", recordedAt: "2026-11-04T12:30:00.000Z", ms: 20_000 });
    expect(r.events.map((e) => e.type)).toEqual(["stage", "plan", "step"]);
    expect(r.events[2]).toEqual({ t: 8_900, type: "step", step: { tool: "get_fx_krw_rate", status: "error", ms: 8_000, error: "데이터를 확인하지 못했습니다." } });
    expect(r.steps[0]?.error).toBe("데이터를 확인하지 못했습니다.");
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(r).toMatchObject({ version: 1, id: "fx-test", model: "gpt-6-luna", ms: 20_000, rewrites: 1 });
    expect(recordable(r)).toEqual({ ok: true });
    expect(recordable({ ...r, report: { ...r.report, verification: { ...r.report.verification, advice: 2 } } })).toMatchObject({ ok: false });
  });

  it("기본 id 는 영역-날짜-시각(한국 시간)", () => {
    expect(defaultId("fx", "2026-11-04T12:30:00.000Z")).toBe("fx-20261104-2130");
    expect(defaultId(undefined, "2026-11-04T15:05:00.000Z")).toBe("any-20261105-0005");
  });

  it("index.ts 는 JSON 을 정적으로 import 하고, manifest 는 최신순 메타", () => {
    expect(renderIndex([])).toContain("export const replays: Record<string, unknown> = {};");
    const code = renderIndex(["rate-compare", "etf-decision"]);
    expect(code).toContain('import r0 from "./etf-decision.json";');
    expect(code).toContain('import r1 from "./rate-compare.json";');
    expect(code).toContain('  "etf-decision": r0,');
    const a = buildReplay(captured, result, { id: "aaa", question: "q", depth: "easy", recordedAt: "2026-11-04T12:30:00.000Z", ms: 1 });
    const b = buildReplay(captured, result, { id: "bbb", question: "q", depth: "deep", area: "etf", recordedAt: "2026-11-05T12:30:00.000Z", ms: 2 });
    expect(renderManifest([a, b]).map((m) => m.id)).toEqual(["bbb", "aaa"]);
    expect(renderManifest([b])[0]).toEqual({ id: "bbb", recordedAt: "2026-11-05T12:30:00.000Z", question: "q", depth: "deep", area: "etf", model: "gpt-6-luna", ms: 2 });
  });
});
