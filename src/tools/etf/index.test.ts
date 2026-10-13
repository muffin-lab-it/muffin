/**
 * fixture 기반 테스트. 실제 API 를 호출하지 않으므로 키 없이 CI 에서 돌아갑니다.
 * fixture.json 은 KODEX 200(069500) 2026-09-14 ~ 2026-10-12 실제 응답입니다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { execute } from "./index";

type Row = (typeof fixture.response.body.items.item)[number];

function okBody(rows: Row[]) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { numOfRows: 400, pageNo: 1, totalCount: rows.length, items: { item: rows } },
    },
  };
}

const kodex200 = fixture.response.body.items.item;
const row = (srtnCd: string, itmsNm: string): Row => ({ ...kodex200[0], srtnCd, itmsNm });

/** 요청 URL 의 쿼리를 보고 응답을 고르는 가짜 fetch. 호출된 URL 은 calls 에 쌓인다. */
function mockApi(route: (params: URLSearchParams) => unknown, status = 200) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return new Response(JSON.stringify(route(url.searchParams)), { status });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("DATA_GO_KR_KEY", "test-key");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00+09:00"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("get_etf_kr_price", () => {
  it("종목코드로 조회하면 최신 시세와 기간 변화를 돌려준다", async () => {
    const calls = mockApi((p) => (p.get("likeSrtnCd") === "069500" ? fixture : okBody([])));

    const result = await execute({ query: "069500", days: 30 });

    expect(result.data).toEqual({
      etf: { code: "069500", isin: "KR7069500007", name: "KODEX 200", baseIndex: "코스피 200" },
      latest: {
        date: "2026-10-12",
        close: 101605,
        change: -4045,
        changePct: -3.83,
        nav: 101609.53,
        premiumPct: -0.004,
        open: 104360,
        high: 105000,
        low: 101275,
        volume: 29236913,
        tradeValue: 3005764846817,
        netAssets: 23695343489304,
        listedShares: 232750000,
        indexClose: 1004.92,
      },
      period: {
        from: "2026-09-14",
        to: "2026-10-12",
        tradingDays: 17,
        returnPct: -3.61,
        high: 114635,
        low: 101275,
        indexReturnPct: -4.37,
        trackingDiffPct: 0.76,
      },
    });
    expect(result.source).toEqual({
      name: "금융위원회 증권상품시세정보 (공공데이터포털, 원천 KRX)",
      url: "https://www.data.go.kr/data/15094806/openapi.do",
      asOf: "2026-10-12",
    });
    expect(result.note).toContain("T+1");

    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe("/1160100/GetSecuritiesProductInfoService_V2/getETFPriceInfo_V2");
    expect(calls[0].searchParams.get("serviceKey")).toBe("test-key");
    // T+1 공개라 days 보다 7일 넉넉히 받아 두고, 기간은 최신 기준일부터 거꾸로 days 일
    expect(calls[0].searchParams.get("beginBasDt")).toBe("20260906");
    expect(calls[0].searchParams.get("endBasDt")).toBe("20261013");
  });

  it("기간은 최신 기준일부터 거꾸로 days 일 안의 거래일만 계산한다", async () => {
    mockApi(() => fixture);

    const result = await execute({ query: "069500", days: 7 });

    // 최신 2026-10-12 기준 7일 전인 10-05 이후: 10-06, 10-07, 10-08, 10-12
    expect(result.data).toMatchObject({ period: { from: "2026-10-06", to: "2026-10-12", tradingDays: 4 } });
  });

  it("정확한 종목명이면 itmsNm 으로 한 번에 조회한다", async () => {
    const calls = mockApi((p) => (p.get("itmsNm") === "KODEX 200" ? fixture : okBody([])));

    const result = await execute({ query: "KODEX 200", days: 30 });

    expect(result.data).toMatchObject({ etf: { code: "069500" } });
    expect(calls).toHaveLength(1);
  });

  it("이름이 부분 일치로 하나만 찾아지면 그 종목코드로 다시 조회한다", async () => {
    const calls = mockApi((p) => {
      if (p.get("likeItmsNm") === "KODEX 2") return okBody([kodex200[0], kodex200[1]]);
      if (p.get("likeSrtnCd") === "069500") return fixture;
      return okBody([]);
    });

    const result = await execute({ query: "KODEX 2", days: 30 });

    expect(result.data).toMatchObject({ etf: { code: "069500", name: "KODEX 200" } });
    expect(calls.map((u) => [...u.searchParams.keys()].find((k) => /Nm|Cd/.test(k)))).toEqual([
      "itmsNm",
      "likeItmsNm",
      "likeSrtnCd",
    ]);
  });

  it("부분 일치 후보가 여러 개면 후보 목록을 담아 실패한다", async () => {
    mockApi((p) =>
      p.get("likeItmsNm") === "KODEX 200"
        ? okBody([row("069500", "KODEX 200"), row("223190", "KODEX 200가치저변동")])
        : okBody([]),
    );
    // itmsNm 정확 일치는 빈 응답이라고 가정한다
    await expect(execute({ query: "KODEX 200", days: 30 })).rejects.toThrow(
      /KODEX 200\(069500\).*KODEX 200가치저변동\(223190\)/,
    );
  });

  it("찾는 ETF 가 없으면 입력 형식을 안내하며 실패한다", async () => {
    mockApi(() => okBody([]));
    await expect(execute({ query: "코덱스200", days: 30 })).rejects.toThrow(/찾지 못했습니다.*KODEX 200/);
  });

  it("API 가 오류 코드를 돌려주면 실패한다", async () => {
    mockApi(() => ({ response: { header: { resultCode: "99", resultMsg: "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS" } } }));
    await expect(execute({ query: "069500", days: 30 })).rejects.toThrow("LIMITED NUMBER");
  });

  it("인증 실패 등 HTTP 오류면 실패한다", async () => {
    mockApi(
      () => ({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } }),
      403,
    );
    await expect(execute({ query: "069500", days: 30 })).rejects.toThrow("403");
  });

  it("실패 메시지에 API 키를 남기지 않는다", async () => {
    mockApi(() => ({ error: "server down" }), 500);
    const err = await execute({ query: "069500", days: 30 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("500");
    expect((err as Error).message).not.toContain("test-key");
  });

  it("DATA_GO_KR_KEY 가 없으면 호출하지 않고 실패한다", async () => {
    vi.stubEnv("DATA_GO_KR_KEY", "");
    const calls = mockApi(() => fixture);
    await expect(execute({ query: "069500", days: 30 })).rejects.toThrow("DATA_GO_KR_KEY");
    expect(calls).toHaveLength(0);
  });
});
