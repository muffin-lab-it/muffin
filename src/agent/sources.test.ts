import { describe, expect, it } from "vitest";
import { pageUrlFor, withPageUrl, withPageUrls } from "./sources";

describe("pageUrlFor · withPageUrl (출처의 사람이 읽는 주소)", () => {
  it("API 주소는 공식 페이지 주소로 바꾼다", () => {
    expect(pageUrlFor("https://api.frankfurter.dev/v2/rates?base=USD&quote=KRW")).toBe("https://frankfurter.dev/");
    expect(pageUrlFor("https://api.frankfurter.app/latest?from=USD&to=KRW")).toBe("https://frankfurter.dev/");
    expect(pageUrlFor("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml")).toBe(
      "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
    );
    expect(pageUrlFor("https://ecos.bok.or.kr/api/StatisticSearch/KEY/json/kr/1/100/722Y001/M/202601/202610/0101000")).toBe("https://ecos.bok.or.kr/");
    expect(pageUrlFor("https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=x")).toBe("https://fred.stlouisfed.org/series/DFF");
    expect(pageUrlFor("https://api.stlouisfed.org/fred/series/observations")).toBe("https://fred.stlouisfed.org/");
    expect(pageUrlFor("https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo?serviceKey=x")).toBe(
      "https://www.data.go.kr/data/15094806/openapi.do",
    );
  });

  it("이미 페이지인 주소 · 모르는 주소 · 빈 주소 · 주소가 아닌 글은 바꾸지 않는다", () => {
    expect(pageUrlFor("https://fred.stlouisfed.org/series/DFF")).toBeUndefined();
    expect(pageUrlFor("https://ecos.bok.or.kr")).toBeUndefined();
    expect(pageUrlFor("https://www.yna.co.kr/view/AKR20261017000100002")).toBeUndefined();
    expect(pageUrlFor("https://www.data.go.kr/data/15094806/openapi.do")).toBeUndefined();
    expect(pageUrlFor("")).toBeUndefined();
    expect(pageUrlFor("계산 (E3 − E2)")).toBeUndefined();
  });

  it("withPageUrl 은 url 과 다를 때만 pageUrl 을 붙이고, 이미 있으면 그대로 둔다", () => {
    const api = { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates?base=USD&quote=KRW", asOf: "2026-10-19" };
    expect(withPageUrl(api)).toEqual({ ...api, pageUrl: "https://frankfurter.dev/" });
    const page = { name: "FRED — DFF", url: "https://fred.stlouisfed.org/series/DFF", asOf: "2026-10-16" };
    expect(withPageUrl(page)).toBe(page);
    const kept = { ...api, pageUrl: "https://example.com/custom" };
    expect(withPageUrl(kept)).toBe(kept);
  });

  it("withPageUrls 는 출처 목록과 장부의 출처를 함께 채운다", () => {
    type Src = { name: string; url: string; asOf: string; pageUrl?: string };
    const report: { sources: (Src & { id: string })[]; evidence: { id: string; source: Src }[] } = {
      sources: [{ id: "E1", name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-10-19" }],
      evidence: [{ id: "E1", source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-10-19" } }],
    };
    const out = withPageUrls(report);
    expect(out.sources[0]!.pageUrl).toBe("https://frankfurter.dev/");
    expect(out.evidence[0]!.source.pageUrl).toBe("https://frankfurter.dev/");
  });
});
