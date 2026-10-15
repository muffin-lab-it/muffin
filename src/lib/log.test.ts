import { afterEach, describe, expect, it, vi } from "vitest";
import { clip, logRun, newRunId } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("run log", () => {
  it("성공은 console.log 에 JSON 한 줄로 남긴다", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logRun({ id: "a", at: "2026-10-14T00:00:00Z", ok: true, stage: "ok", mock: false, ms: 1234 });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ type: "muffin.run", id: "a", ok: true, ms: 1234 });
  });

  it("실패는 console.error 로 남긴다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logRun({ id: "b", at: "x", ok: false, stage: "agent", mock: false, ms: 5, error: "boom" });
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({ stage: "agent", error: "boom" });
  });

  it("id 는 매번 다르고 긴 질문은 자른다", () => {
    expect(newRunId()).not.toBe(newRunId());
    expect(clip("가".repeat(300))).toHaveLength(201);
  });
});
