import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, fetchJson, fetchText } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("http helpers", () => {
  it("fetchJson 은 JSON 을 파싱한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"a":1}', { status: 200 })));
    await expect(fetchJson("https://x.test")).resolves.toEqual({ a: 1 });
  });

  it("2xx 가 아니면 상태코드가 담긴 HttpError 를 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const err = await fetchText("https://x.test/secret").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("403");
  });
});
