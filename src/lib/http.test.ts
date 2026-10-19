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

  it("redirect 옵션을 fetch 에 넘기고, 기본값은 follow 다", async () => {
    const spy = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchText("https://x.test/a");
    await fetchText("https://x.test/b", { redirect: "error" });
    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][1].redirect).toBe("follow");
    expect(calls[1][1].redirect).toBe("error");
  });

  it("에러 메시지와 url 에 쿼리(키)가 남지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const err = await fetchJson("https://x.test/api?serviceKey=SECRET123&q=1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const httpErr = err as HttpError;
    expect(httpErr.message).not.toContain("SECRET123");
    expect(httpErr.url).toBe("https://x.test/api");
  });
});
