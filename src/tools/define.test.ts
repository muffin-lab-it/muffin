import { describe, expect, it } from "vitest";
import { RunContext } from "@openai/agents";
import { z } from "zod";
import { ResearchContext, mergeSources } from "../agent/context";
import { MAX_VALUE_LENGTH, defineTool } from "./define";
import type { ToolResult } from "./types";

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
      execute: async () => ({ data: { v: 1, name: "x", latest: { close: 40175, deep: { more: { tooDeep: 1 } } }, list: [1] }, source, note: "주의" }),
    });
    const ctx = new ResearchContext();
    const out = await invoke(t, ctx, { q: "x" });

    expect(out).toEqual({
      id: "E1",
      data: { v: 1, name: "x", latest: { close: 40175, deep: { more: { tooDeep: 1 } } }, list: [1] },
      source: { id: "E1", ...source },
      note: "주의",
    });
    // 중첩 객체는 점으로 이어 3단계까지(latest.deep.more 의 안쪽은 제외), 배열은 제외. tool 의 note 는 장부에도 남습니다
    expect(ctx.evidence).toEqual([
      { id: "E1", tool: "ok_tool", label: "ok_tool · 테스트 출처", values: { v: 1, name: "x", "latest.close": 40175 }, source, note: "주의" },
    ]);
  });

  it("출처를 목록으로 돌려주면 1건이어도 E1-1 로 번호를 붙인다 (건수에 따라 모양이 바뀌지 않게)", async () => {
    const one = defineTool({
      name: "news_tool",
      description: "test",
      parameters,
      execute: async () => ({ data: { count: 1, articles: [{ title: "기사 1" }] }, source: [source] }),
    });
    const ctx = new ResearchContext();
    const out = (await invoke(one, ctx, { q: "x" })) as { id?: string; ids: string[]; source: { id: string }[] };

    // 모델이 보는 번호는 장부에 있는 것뿐이다. 호출 번호(E1)는 돌려주지 않는다
    expect(out).not.toHaveProperty("id");
    expect(out.ids).toEqual(["E1-1"]);
    expect(out.source).toEqual([{ id: "E1-1", ...source }]);
    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1-1"]);
  });

  it("출처가 여러 개면 E1-1, E1-2 로 나누고 실패한 호출은 번호를 쓰지 않는다", async () => {
    const many = defineTool({
      name: "news_tool",
      description: "test",
      parameters,
      execute: async () => ({
        data: {
          count: 2,
          articles: [
            { title: "기사 1", body: { status: "available", text: "본문 ".repeat(100) } },
            { title: "기사 2", body: { status: "available", text: "본문 ".repeat(100) } },
          ],
        },
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
    const out = (await invoke(many, ctx, { q: "x" })) as { id?: string; ids: string[]; source: { id: string }[] };

    expect(out).not.toHaveProperty("id");
    expect(out.ids).toEqual(["E1-1", "E1-2"]);
    expect(out.source.map((s) => s.id)).toEqual(["E1-1", "E1-2"]);
    expect(ctx.evidence.map((e) => e.id)).toEqual(["E1-1", "E1-2"]);
    // 기사마다 그 기사의 값. 긴 본문은 빠지고 짧은 중첩 값(body.status)은 남는다. 출처 수와 길이가 다르면 전체 요약값으로 돌아간다
    expect(ctx.evidence.map((e) => e.values)).toEqual([
      { title: "기사 1", "body.status": "available" },
      { title: "기사 2", "body.status": "available" },
    ]);
    expect(ctx.sources).toHaveLength(2);
  });

  it("기본 선택은 긴 문자열(정의문 · 본문)을 장부에 올리지 않고, data 는 그대로 모델에 보낸다", async () => {
    const definition = "From 24 Sep 2026: the BOJ encourages the uncollateralized overnight call rate … ".repeat(20);
    expect(definition.length).toBeGreaterThan(MAX_VALUE_LENGTH);
    const t = defineTool({
      name: "rate_tool",
      description: "test",
      parameters,
      execute: async () => ({ data: { rate: 1.25, asOf: "2026-10-13", stale: false, definition, ratio: Number.NaN }, source }),
    });
    const ctx = new ResearchContext();
    const out = (await invoke(t, ctx, { q: "x" })) as { data: { definition: string } };

    expect(out.data.definition).toBe(definition);
    expect(ctx.evidence[0].values).toEqual({ rate: 1.25, asOf: "2026-10-13", stale: "false" });
  });

  it("evidence 로 장부에 올릴 값을 직접 고른다 (객체 하나 → 모든 출처에 같이, 배열 → 출처마다 하나씩)", async () => {
    const one = defineTool({
      name: "rate_tool",
      description: "test",
      parameters,
      execute: async () => ({ data: { rate: 1.25, asOf: "2026-10-13", definition: "x".repeat(300), title: "Policy rate" }, source }),
      // data 의 타입이 execute 반환값에서 추론되므로 여기서 필드 이름을 틀리면 typecheck 가 잡습니다.
      evidence: (data) => ({ rate: data.rate, asOf: data.asOf, definition: data.definition }),
    });
    const many = defineTool({
      name: "news_tool",
      description: "test",
      parameters,
      execute: async () => ({
        data: { count: 2, items: [{ headline: "기사 1", score: 0.9 }, { headline: "기사 2", score: 0.4 }] },
        source: [source, { ...source, url: "https://example.com/2" }],
      }),
      evidence: (data) => data.items.map((a) => ({ headline: a.headline })),
    });
    const ctx = new ResearchContext();
    await invoke(one, ctx, { q: "x" });
    await invoke(many, ctx, { q: "x" });

    // 직접 고른 값은 길이 제한 없이 그대로 올라간다
    expect(ctx.evidence[0].values).toEqual({ rate: 1.25, asOf: "2026-10-13", definition: "x".repeat(300) });
    expect(ctx.evidence.slice(1).map((e) => e.values)).toEqual([{ headline: "기사 1" }, { headline: "기사 2" }]);
  });

  it("evidence 가 throw 하거나 배열 길이가 출처 수와 다르면 기본 선택으로 돌아가고, 호출은 성공으로 남는다", async () => {
    const throws = defineTool({
      name: "throws_tool",
      description: "test",
      parameters,
      execute: async () => ({ data: { v: 1 }, source }),
      evidence: () => {
        throw new Error("evidence 버그");
      },
    });
    const wrongLength = defineTool({
      name: "wrong_tool",
      description: "test",
      parameters,
      execute: async () => ({ data: { v: 2 }, source: [source, { ...source, url: "https://example.com/2" }] }),
      evidence: () => [{ v: 99 }],
    });
    const ctx = new ResearchContext();
    await invoke(throws, ctx, { q: "x" });
    await invoke(wrongLength, ctx, { q: "x" });

    expect(ctx.evidence.map((e) => e.values)).toEqual([{ v: 1 }, { v: 2 }, { v: 2 }]);
    expect(ctx.steps.map((s) => s.status)).toEqual(["ok", "ok"]);
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
      execute: () => new Promise<ToolResult>((r) => setTimeout(() => r({ data: 1, source }), 200)),
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
