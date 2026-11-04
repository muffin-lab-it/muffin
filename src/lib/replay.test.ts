import { describe, expect, it, vi } from "vitest";
import sample from "../agent/fixtures/report.v2.sample.json";
import type { MuffinEvent } from "../agent/events";
import { reportSchema } from "../agent/schema";
import { fitSpeed, getReplay, listReplays, playbackMs, playReplay, publicStep, recordedLabel, replayedReport, replayNotice, replaySchema, SPEED_MAX, type Replay } from "./replay";

// src/replays/index.ts 는 생성 파일이라 테스트에서는 고정 녹화 하나로 바꿉니다
vi.mock("../replays", () => ({
  replays: {
    "fixture-fx": {
      version: 1,
      id: "fixture-fx",
      recordedAt: "2026-11-04T12:30:00.000Z",
      question: "환율이 왜 올랐나요?",
      depth: "standard",
      area: "fx",
      model: "gpt-6-luna",
      ms: 27_400,
      events: [
        { t: 0, type: "stage", stage: "plan", status: "start" },
        { t: 1_200, type: "plan", intent: "cause", mode: "research", tools: ["get_fx_krw_rate"] },
        { t: 1_250, type: "stage", stage: "plan", status: "done" },
        { t: 1_300, type: "stage", stage: "research", status: "start" },
        { t: 2_300, type: "step", step: { tool: "get_fx_krw_rate", status: "ok", ms: 980 } },
        { t: 30_000, type: "stage", stage: "research", status: "done" },
        { t: 30_100, type: "verify", verification: { status: "pass", numbers: { total: 1, verified: 1, derived: 0, reported: 0, unverified: 0 }, why: { data: 0, news: 0, none: 0, unsupported: 0 }, advice: 0, revisions: 0, removed: [] } },
      ],
      report: (sample as { report: unknown }).report,
      steps: [{ tool: "get_fx_krw_rate", status: "ok", ms: 980 }],
      rewrites: 0,
    },
    broken: { version: 1 },
  },
}));

describe("리플레이", () => {
  it("녹화를 id 로 꺼내 검사해 주고, 없거나 id 모양이 틀리면 undefined, 파일이 틀리면 throw", () => {
    const r = getReplay("fixture-fx");
    expect(r?.question).toBe("환율이 왜 올랐나요?");
    expect(r?.report).toEqual(reportSchema.parse((sample as { report: unknown }).report));
    expect(getReplay("nope")).toBeUndefined();
    expect(getReplay("Bad Id!")).toBeUndefined();
    expect(getReplay("constructor")).toBeUndefined(); // 프로토타입 속성은 녹화가 아님
    expect(getReplay("hasownproperty")).toBeUndefined();
    expect(() => getReplay("broken")).toThrow();
  });

  it("목록은 최신순 메타만", () => {
    expect(() => listReplays()).toThrow(); // broken 이 섞여 있으면 테스트가 잡게 throw
  });

  it("안내문은 녹화 시각(한국 시간)을 밝히고, 재생용 리포트는 기존 안내 앞에 붙인다", () => {
    const r = getReplay("fixture-fx")!;
    expect(recordedLabel(r.recordedAt)).toBe("11/4 21:30");
    expect(replayNotice(r)).toContain("저장된 실행 다시 보기 · 11/4 21:30 에 실제로 만든 리포트입니다. 지금 데이터가 아닙니다.");
    // 샘플 리포트에는 움직임 안내가 있어 그 앞에 붙고, 안내가 없으면 그대로
    expect(replayedReport(r).notice).toBe(`${replayNotice(r)} ${r.report.notice}`);
    const plain: Replay = { ...r, report: { ...r.report, notice: undefined } };
    expect(replayedReport(plain).notice).toBe(replayNotice(r));
    const decision: Replay = { ...r, report: { ...r.report, notice: "투자 판단을 대신하지 않습니다." } };
    expect(replayedReport(decision).notice).toBe(`${replayNotice(r)} 투자 판단을 대신하지 않습니다.`);
    expect(publicStep({ tool: "t", status: "error", ms: 1, error: "HTTP 503 https://x?key=SECRET" })).toEqual({ tool: "t", status: "error", ms: 1, error: "데이터를 확인하지 못했습니다." });
  });

  it("원래 간격을 속도로 나눠 기다리고(상한 있음), t 를 뗀 이벤트를 순서대로 넘기며, 중단되면 멈춘다", async () => {
    const r = getReplay("fixture-fx")!;
    const waits: number[] = [];
    const seen: MuffinEvent[] = [];
    await playReplay(r, (e) => seen.push(e), { speed: 2, maxGapMs: 10_000, wait: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([600, 25, 25, 500, 5_000, 50]);
    expect(seen).toHaveLength(7);
    expect(seen[0]).toEqual({ type: "stage", stage: "plan", status: "start" });
    expect(seen[4]).toEqual({ type: "step", step: { tool: "get_fx_krw_rate", status: "ok", ms: 980 } });
    expect("t" in seen[1]!).toBe(false);

    const controller = new AbortController();
    const got: MuffinEvent[] = [];
    await playReplay(r, (e) => got.push(e), {
      wait: async () => {
        if (got.length === 2) controller.abort();
      },
      signal: controller.signal,
    });
    expect(got).toHaveLength(2);
  });

  it("재생 길이는 간격 상한을 적용한 합이고, 마감 안에 못 끝나는 속도는 끝날 만큼 올린다", () => {
    const r = getReplay("fixture-fx")!;
    // 간격: 1200 · 50 · 50 · 1000 · 15000(27700 을 상한으로) · 100 = 17400
    expect(playbackMs(r)).toBe(17_400);
    expect(playbackMs(r, 2)).toBe(8_700);
    expect(fitSpeed(r, 1, 50_000)).toBe(1);
    expect(fitSpeed(r, 0.25, 50_000)).toBe(0.348); // 17400 / 50000
    expect(fitSpeed(r, 4, 50_000)).toBe(4);
    expect(fitSpeed(r, 1, 100)).toBe(SPEED_MAX);
  });

  it("replaySchema 는 report · error 이벤트와 모르는 depth 를 거른다", () => {
    const r = getReplay("fixture-fx")!;
    expect(() => replaySchema.parse({ ...r, events: [{ t: 0, type: "report" }] })).toThrow();
    expect(() => replaySchema.parse({ ...r, depth: "extreme" })).toThrow();
    expect(() => replaySchema.parse({ ...r, id: "Has Space" })).toThrow();
  });
});
