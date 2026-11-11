import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "./fixture.json";
import ecosFixture from "./ecos.fixture.json";
import { execute, parameters } from "./index";

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

  it("Frankfurter 실패 시 ECOS의 USD/KRW 매매기준율로 대체한다", async () => {
    vi.stubEnv("ECOS_API_KEY", "ecos-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("upstream error", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ecosFixture), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute({ currency: "USD", days: 14 });

    expect(result).toMatchObject({
      data: {
        pair: "USD/KRW",
        unit: "KRW per 1 USD",
        rate: 1342.51,
        comparison: { rate: 1354.87, asOf: "2026-10-02" },
        change: -12.36,
        changePct: -0.91,
      },
      source: { name: "한국은행 ECOS — 주요국 통화의 대원화환율", asOf: "2026-10-16" },
    });

    const ecosUrl = String(fetchMock.mock.calls[1][0]);
    expect(ecosUrl).toContain("/StatisticSearch/ecos-test-key/json/kr/1/1000/731Y001/D/");
    expect(ecosUrl).toMatch(/\/0000001$/);
    expect(JSON.stringify(result.source)).not.toContain("ecos-test-key");
  });

  it("ECOS fallback의 JPY 값은 이미 100엔 단위이므로 다시 곱하지 않는다", async () => {
    vi.stubEnv("ECOS_API_KEY", "ecos-test-key");
    const jpyRows = structuredClone(ecosFixture);
    jpyRows.StatisticSearch.row = [
      { ...jpyRows.StatisticSearch.row[0], ITEM_CODE1: "0000002", ITEM_NAME1: "원/일본엔(100엔)", TIME: "20261002", DATA_VALUE: "831.00" },
      { ...jpyRows.StatisticSearch.row[1], ITEM_CODE1: "0000002", ITEM_NAME1: "원/일본엔(100엔)", TIME: "20261016", DATA_VALUE: "847.00" },
    ];
    jpyRows.StatisticSearch.list_total_count = 2;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response("upstream error", { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(jpyRows), { status: 200 })),
    );

    const result = await execute({ currency: "JPY", days: 14 });

    expect(result.data).toMatchObject({
      pair: "JPY(100)/KRW",
      rate: 847,
      comparison: { rate: 831, asOf: "2026-10-02" },
      change: 16,
      changePct: 1.93,
    });
  });

  it("Frankfurter와 ECOS가 모두 실패해도 ECOS API 키를 오류에 노출하지 않는다", async () => {
    vi.stubEnv("ECOS_API_KEY", "ecos-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response("upstream error", { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ RESULT: { CODE: "INFO-200" } }), { status: 200 })),
    );

    const error = await execute({ currency: "USD", days: 14 }).then(
      () => new Error("expected execute to reject"),
      (caught: unknown) => caught instanceof Error ? caught : new Error(String(caught)),
    );

    expect(error.message).toContain("Frankfurter와 ECOS 환율 조회에 모두 실패했습니다");
    expect(error.message).toContain("INFO-200");
    expect(error.message).not.toContain("ecos-test-key");
  });

  it.each([
    ["단위", { UNIT_NAME: "달러" }],
    ["날짜", { TIME: "2026-10-16" }],
  ])("ECOS fallback이 잘못된 %s 응답을 거부한다", async (_label, change) => {
    vi.stubEnv("ECOS_API_KEY", "ecos-test-key");
    const invalid = structuredClone(ecosFixture);
    Object.assign(invalid.StatisticSearch.row[0], change);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response("upstream error", { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(invalid), { status: 200 })),
    );

    await expect(execute({ currency: "USD", days: 14 })).rejects.toThrow("ECOS 환율 응답 형식이 예상과 다릅니다.");
  });

  it("지원하지 않는 통화와 기간은 입력 스키마에서 거부한다", () => {
    expect(() => parameters.parse({ currency: "GBP", days: 14 })).toThrow();
    expect(() => parameters.parse({ currency: "USD", days: 0 })).toThrow();
  });
});
