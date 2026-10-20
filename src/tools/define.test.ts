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

  it("성공한 결과에 증거 번호를 붙여 장부에 기록하고, 모델에게도 같은 id 를 돌려준다", async () => {
    const t = defineTool({
      name: "ok_tool",
      description: "test",
      parameters,
      execute: async () => ({ data: { v: 1, name: "x", nested: { skip: true }, list: [1] }, source, note: "주의" }),
    });
    const ctx = new ResearchContext();
    const out = await invoke(t, ctx, { q: "x" });

    expect(out).toEqual({ id: "E1", data: { v: 1, name: "x", nested: { skip: true }, list: [1] }, source: { id: "E1", ...source }, note: "주의" });
    expect(ctx.evidence).toEqual([{ id: "E1", tool: "ok_tool", label: "ok_tool · 테스트 출처", values: { v: 1, name: "x" }, source }]);
  });

  it("출처가 여러 개면 E1-1, E1-2 로 나누고 실패한 호출은 번호를 쓰지 않는다", async () => {
    const many = defineTool({
      name: "news_tool",
      description: "test",
      parameters,
      execute: async () => ({
        data: { count: 2, articles: [{ title: "기사 1", body: { text: "본문" } }, { title: "기사 2", body: { text: "본문" } }] },
        source: [source, { ...source, url: "https://example.com/2" }],
      }),
    });
    const bad = defineTool({
      name: "bad_tool",
      description: "test",
      parameters,
      execute: async () => {
        throw new Error("x");
      },
    });
    const ctx = new ResearchContext();
    await invoke(bad, ctx, { q: "x" });
    const out = (await invoke(many, ctx, { q: "x" })) as { id: string; source: { id: string }[] };

    expect(out.id).toBe("E1");
    expect(out.source.map((s) => s.id)).toEqual(["E1-1", "E1-2"]);
    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1-1", "E1-2"]);
    // 기사마다 그 기사의 값 (본문 같은 중첩 객체는 제외). 출처 수와 길이가 다르면 전체 요약값으로 돌아간다
    expect(ctx.evidence.map((e) => e.values)).toEqual([{ title: "기사 1" }, { title: "기사 2" }]);
    expect(ctx.sources).toHaveLength(2);
  });

  it("tool 이 끝날 때마다 onStep 을 부른다 (성공 · 실패 모두)", async () => {
    const seen: string[] = [];
    const ctx = new ResearchContext({ onStep: (s) => seen.push(`${s.tool}:${s.status}`) });
    const ok = defineTool({ name: "ok_tool", description: "test", parameters, execute: async () => ({ data: 1, source }) });
    const bad = defineTool({
      name: "bad_tool",
      description: "test",
      parameters,
      execute: async () => {
        throw new Error("x");
      },
    });
    await invoke(ok, ctx, { q: "x" });
    await invoke(bad, ctx, { q: "x" });
    expect(seen).toEqual(["ok_tool:ok", "bad_tool:error"]);
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

describe("defineTool 키 가리기", () => {
  it("execute 의 에러 메시지에 섞인 키를 지운다", async () => {
    process.env.TEST_SECRET_KEY = "SUPERSECRET123";
    const t = defineTool({
      name: "leaky_tool",
      description: "test",
      parameters,
      execute: async () => {
        throw new Error("https://api.test/SUPERSECRET123/data 실패");
      },
    });
    const ctx = new ResearchContext();
    const out = JSON.stringify(await invoke(t, ctx, { q: "x" }));
    delete process.env.TEST_SECRET_KEY;

    expect(out).not.toContain("SUPERSECRET123");
    expect(ctx.steps[0].error).toContain("[REDACTED]");
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
