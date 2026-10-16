import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "./fixture.json";
import { execute } from "./index";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T12:00:00+09:00"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("get_fx_krw_rate", () => {
  it("fixture로 USD/KRW 최신 환율과 기간 변동을 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute({ currency: "USD", days: 14 });

    expect(result).toMatchObject({
      data: {
        pair: "USD/KRW",
        rate: 1342.51,
        asOf: "2026-10-16",
        comparison: { rate: 1354.87, asOf: "2026-10-02" },
        change: -12.36,
        changePct: -0.91,
      },
      source: { name: "Frankfurter v2", asOf: "2026-10-16" },
    });

    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.origin).toBe("https://api.frankfurter.dev");
    expect(requestedUrl.pathname).toBe("/v2/rates");
    expect(requestedUrl.searchParams.get("base")).toBe("usd");
    expect(requestedUrl.searchParams.get("quotes")).toBe("krw");
    expect(requestedUrl.searchParams.get("from")).toBeTruthy();
    expect(requestedUrl.searchParams.get("to")).toBeTruthy();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("Frankfurter가 오류를 반환하면 예외를 전달한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
      ),
    );

    await expect(execute({ currency: "USD", days: 14 })).rejects.toThrow("HTTP 404");
  });
});
