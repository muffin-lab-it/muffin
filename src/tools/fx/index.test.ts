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
        unit: "KRW per 1 USD",
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

  it("days=1이면 최신 기준일의 전날 이하에서 가장 가까운 값을 비교한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute({ currency: "USD", days: 1 });

    expect(result.data.comparison).toEqual({ rate: 1342.21, asOf: "2026-10-15" });
    expect(result.data.change).toBe(0.3);

    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.searchParams.get("from")).toBe("2026-10-01");
  });

  it("JPY/KRW는 100엔 기준으로 반환한다", async () => {
    const jpyFixture = [
      { date: "2026-10-02", base: "JPY", quote: "KRW", rate: 8.31 },
      { date: "2026-10-16", base: "JPY", quote: "KRW", rate: 8.47 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(jpyFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await execute({ currency: "JPY", days: 14 });

    expect(result.data).toMatchObject({
      pair: "JPY(100)/KRW",
      unit: "KRW per 100 JPY",
      rate: 847,
      comparison: { rate: 831, asOf: "2026-10-02" },
      change: 16,
      changePct: 1.93,
    });
  });

  it("days=365에서도 최신 기준일 기준의 비교값을 고른다", async () => {
    const longRangeFixture = [
      { date: "2025-10-16", base: "USD", quote: "KRW", rate: 1300 },
      { date: "2026-10-16", base: "USD", quote: "KRW", rate: 1342.51 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(longRangeFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await execute({ currency: "USD", days: 365 });

    expect(result.data.comparison).toEqual({ rate: 1300, asOf: "2025-10-16" });
    expect(result.data.change).toBe(42.51);
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
