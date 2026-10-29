import { afterEach, describe, expect, it, vi } from "vitest";
import v2 from "../agent/fixtures/report.v2.sample.json";
import type { MuffinEvent } from "../agent/events";
import { ApiError, createReport, streamReport } from "./api";
import { CLIENT_HEADER, isClientId } from "./client";

const report = v2.report;

/** 문자열을 chunk 크기로 잘라 보내는 응답. 줄 중간에서 끊기는 상황을 재현합니다. */
function streamed(body: string, chunk: number, init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < body.length; i += chunk) controller.enqueue(encoder.encode(body.slice(i, i + chunk)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" }, ...init });
}

const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("streamReport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("NDJSON 을 줄 단위 이벤트로 바꾸고 report 로 끝난다 (청크가 줄 중간에서 끊겨도)", async () => {
    const events: MuffinEvent[] = [
      { type: "stage", stage: "research", status: "start" },
      { type: "step", step: { tool: "get_fx_krw_rate", status: "ok", ms: 12 } },
      { type: "stage", stage: "research", status: "done" },
      { type: "report", report: report as MuffinEvent extends { report: infer R } ? R : never, steps: [], rewrites: 0, id: "run-1" },
    ];
    const fetchMock = vi.fn(async () => streamed(ndjson(events), 7));
    vi.stubGlobal("fetch", fetchMock);

    const seen: MuffinEvent[] = [];
    const result = await streamReport({ question: "q", depth: "easy" }, (e) => seen.push(e));

    expect(seen.map((e) => e.type)).toEqual(["stage", "step", "stage", "report"]);
    expect(result).toEqual({ report, steps: [], rewrites: 0, id: "run-1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/report/stream", expect.objectContaining({ method: "POST" }));
  });

  it("error 이벤트면 메시지와 요청 id 로 throw 한다", async () => {
    vi.stubGlobal("fetch", async () => streamed(ndjson([{ type: "error", message: "Agent 실패", id: "run-2" }]), 1000));
    await expect(streamReport({ question: "q", depth: "easy" }, () => {})).rejects.toThrow("Agent 실패 (요청 id: run-2)");
  });

  it("HTTP 오류(라우트 없음 등)면 throw 한다", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Not Found" }), { status: 404 }));
    await expect(streamReport({ question: "q", depth: "easy" }, () => {})).rejects.toThrow("Not Found");
  });

  it("report 없이 스트림이 끝나면 throw 한다", async () => {
    vi.stubGlobal("fetch", async () => streamed(ndjson([{ type: "stage", stage: "research", status: "start" }]), 1000));
    await expect(streamReport({ question: "q", depth: "easy" }, () => {})).rejects.toThrow("리포트 없이");
  });
});

describe("createReport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("JSON 응답을 그대로 돌려준다", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ report, steps: [], rewrites: 0, id: "run-3" }));
    await expect(createReport({ question: "q", depth: "easy" })).resolves.toEqual({ report, steps: [], rewrites: 0, id: "run-3" });
  });

  it("실패하면 에러 메시지에 요청 id 를 붙인다", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "키 없음", id: "run-4" }, { status: 500 }));
    await expect(createReport({ question: "q", depth: "easy" })).rejects.toThrow("키 없음 (요청 id: run-4)");
  });
});

describe("브라우저 익명 id 헤더 · 429", () => {
  afterEach(() => vi.unstubAllGlobals());

  const memoryStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  const headerOf = (init: RequestInit | undefined) => (init?.headers as Record<string, string>)[CLIENT_HEADER];

  it("두 함수 모두 같은 브라우저 id 를 X-Muffin-Client 로 붙인다", async () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/stream")
        ? streamed(ndjson([{ type: "report", report, steps: [], rewrites: 0, id: "run-5" }]), 1000)
        : Response.json({ report, steps: [], rewrites: 0, id: "run-6" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createReport({ question: "q", depth: "easy" });
    await streamReport({ question: "q", depth: "easy" }, () => {});
    const [first, second] = fetchMock.mock.calls.map(([, init]) => headerOf(init));
    expect(isClientId(first)).toBe(true);
    expect(second).toBe(first);
  });

  it("서버 렌더링(window 없음)에서는 헤더를 붙이지 않는다", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ report, steps: [], rewrites: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await createReport({ question: "q", depth: "easy" });
    expect(headerOf(fetchMock.mock.calls[0][1])).toBeUndefined();
  });

  it("429 면 서버 문장과 요청 id 로 ApiError 를 던지고, retryAfterSec 를 담는다", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "요청이 많아요. 2분 뒤 다시 시도해 주세요.", id: "run-7", retryAfterSec: 120 }, { status: 429, headers: { "Retry-After": "120" } }),
    );
    const err = await streamReport({ question: "q", depth: "easy" }, () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, id: "run-7", retryAfterSec: 120, message: "요청이 많아요. 2분 뒤 다시 시도해 주세요. (요청 id: run-7)" });
  });

  it("429 인데 문장이 없으면 Retry-After 헤더로 남은 분을 적는다", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 429, headers: { "Retry-After": "61" } }));
    const err = await createReport({ question: "q", depth: "easy" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, retryAfterSec: 61, message: "요청이 많아요. 2분 뒤 다시 시도해 주세요." });
  });
});
