import { describe, expect, it } from "vitest";
import { RunContext } from "@openai/agents";
import { z } from "zod";
import { ResearchContext, mergeSources } from "../agent/context";
import { defineTool } from "./define";

const parameters = z.object({ q: z.string() });
const source = { name: "테스트 출처", url: "https://example.com/data", asOf: "2026-10-01" };

async function invoke(t: ReturnType<typeof defineTool>, ctx: ResearchContext, input: unknown) {
  return t.invoke(new RunContext(ctx), JSON.stringify(input));
}

describe("defineTool", () => {
  it("성공하면 출처와 실행 기록을 컨텍스트에 쌓는다", async () => {
    const t = defineTool({
      name: "ok_tool",
      description: "test",
      parameters,
      execute: async () => ({ data: { v: 1 }, source }),
    });
    const ctx = new ResearchContext();
    await invoke(t, ctx, { q: "x" });

    expect(ctx.sources).toEqual([source]);
    expect(ctx.steps).toMatchObject([{ tool: "ok_tool", status: "ok" }]);
  });

  it("execute 가 throw 해도 Agent 를 멈추지 않고 실패를 모델에 알린다", async () => {
    const t = defineTool({
      name: "bad_tool",
      description: "test",
      parameters,
      execute: async () => {
        throw new Error("HTTP 500");
      },
    });
    const ctx = new ResearchContext();
    const out = JSON.stringify(await invoke(t, ctx, { q: "x" }));

    expect(out).toContain("bad_tool 호출 실패");
    expect(out).toContain("HTTP 500");
    expect(ctx.sources).toEqual([]);
    expect(ctx.steps).toMatchObject([{ tool: "bad_tool", status: "error", error: "HTTP 500" }]);
  });

  it("timeoutMs 를 넘기면 실패 처리된다", async () => {
    const t = defineTool({
      name: "slow_tool",
      description: "test",
      parameters,
      timeoutMs: 20,
      execute: () => new Promise((r) => setTimeout(() => r({ data: 1, source }), 200)),
    });
    const ctx = new ResearchContext();
    const out = JSON.stringify(await invoke(t, ctx, { q: "x" }));
    expect(out.toLowerCase()).toMatch(/time|실패|error/);
    expect(ctx.sources).toEqual([]);
  });
});

describe("mergeSources", () => {
  it("tool 출처를 우선하고 모델 출처는 URL 이 겹치지 않는 것만 더한다", () => {
    const fromModel = [
      { ...source, name: "모델이 적은 이름" },
      { name: "다른 출처", url: "https://example.com/other", asOf: "2026-10-01" },
      { name: "URL 없음", url: "", asOf: "" },
    ];
    expect(mergeSources([source], fromModel)).toEqual([
      source,
      { name: "다른 출처", url: "https://example.com/other", asOf: "2026-10-01" },
    ]);
  });
});
