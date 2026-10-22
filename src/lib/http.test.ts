import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, ResponseFormatError, fetchJson, fetchText } from "./http";

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

  it("2xx 인데 JSON 이 아니면(점검 페이지) content-type 과 페이지 제목을 담은 ResponseFormatError 를 던진다", async () => {
    const html = "<!doctype html><html><head><title>\n  Site Maintenance | St. Louis Fed </title></head><body>…</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })),
    );
    const err = await fetchJson("https://api.test/fred/observations?api_key=SECRET123&series_id=DGS10").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResponseFormatError);
    const formatErr = err as ResponseFormatError;
    expect(formatErr.message).toContain("JSON 이 아닌 응답");
    expect(formatErr.message).toContain("text/html");
    expect(formatErr.message).toContain("Site Maintenance | St. Louis Fed");
    expect(formatErr.message).not.toContain("SECRET123");
    expect(formatErr.url).toBe("https://api.test/fred/observations");
    expect(formatErr.contentType).toBe("text/html; charset=utf-8");
  });

  it("JSON 이 아닌 응답에 제목이 없으면 content-type 과 url 만 적는다", async () => {
    // 문자열 본문은 content-type 이 자동으로 붙으므로, 헤더 없는 경우는 바이트 본문으로 만든다
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(), { status: 200 })));
    const err = await fetchJson("https://api.test/empty").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResponseFormatError);
    expect((err as Error).message).toBe("JSON 이 아닌 응답 (content-type 없음) https://api.test/empty");
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
