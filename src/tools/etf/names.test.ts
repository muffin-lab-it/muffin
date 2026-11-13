/** 받아 둔 목록(etf-list.json)으로 이름을 찾습니다. API 를 부르지 않습니다. */
import { describe, expect, it } from "vitest";
import list from "./etf-list.json";
import { lookupName, normalize, type EtfListFile } from "./names";

const code = (q: string) => {
  const r = lookupName(q);
  return r && "code" in r ? r.code : r;
};

describe("ETF 이름 목록", () => {
  it("목록 파일 모양: 기준일 · 출처 · [코드, 이름] 이 있고 코드가 겹치지 않는다", () => {
    const file = list as EtfListFile;
    expect(file.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(file.items.length).toBeGreaterThan(500);
    expect(new Set(file.items.map(([c]) => c)).size).toBe(file.items.length);
    for (const [c, n] of file.items) {
      expect(c).toMatch(/^\d[0-9A-Z]{5}$/);
      expect(n.trim()).toBe(n);
    }
  });

  it("정규화: 대소문자 · 공백 · 끝의 ETF 를 무시한다", () => {
    expect(normalize(" kodex  200 etf ")).toBe("KODEX200");
    expect(normalize("TIGER 미국S&P500")).toBe("TIGER미국S&P500");
  });

  it.each([
    ["KODEX 200", "069500"],
    ["kodex 200", "069500"],
    ["KODEX200", "069500"],
    ["KODEX 200 ETF", "069500"],
    ["코덱스 200", "069500"],
    ["코덱스200", "069500"],
    ["삼성 KODEX 200", "069500"],
    ["삼성자산운용 KODEX 200", "069500"],
    ["TIGER 미국S&P500", "360750"],
    ["TIGER S&P500", "360750"],
    ["타이거 S&P500", "360750"],
    ["TIGER 에스앤피500", "360750"],
    ["TIGER NASDAQ100", "133690"],
    ["타이거 나스닥100", "133690"],
    ["미래에셋 TIGER 200", "102110"],
    ["KINDEX 미국S&P500", "360200"],
    ["KBSTAR 200", "148020"],
    ["ARIRANG 200", "152100"],
    // 앞부분이 같은 별칭은 긴 것이 먼저 (Codex 리뷰: `타임` 이 먼저 걸려 `TIME폴리오…` 가 되던 것)
    ["타임폴리오 미국S&P500액티브", "426020"],
    ["TIMEFOLIO 미국S&P500액티브", "426020"],
    ["타임 미국S&P500액티브", "426020"],
  ])("%s → %s", (query, expected) => {
    expect(code(query)).toBe(expected);
  });

  it("여러 개에 걸리면 후보를 이름이 짧은 순으로 돌려준다", () => {
    const r = lookupName("KODEX 2");
    expect(r && "candidates" in r ? r.candidates[0] : r).toEqual({ code: "069500", name: "KODEX 200" });
    const all = lookupName("S&P500");
    expect(all && "candidates" in all ? all.candidates.length : 0).toBeGreaterThan(10);
  });

  it("목록에 없으면 null (미국 상장 ETF · 새 상장은 API 조회로)", () => {
    expect(lookupName("SPY")).toBeNull();
    expect(lookupName("QQQ")).toBeNull();
    expect(lookupName("NEWCO 미래기술")).toBeNull();
    expect(lookupName("   ")).toBeNull();
  });
});
