import { describe, expect, it } from "vitest";
import { etfIntro, hasBatchim, withEtfIntro } from "./etf-intro";
import type { Evidence } from "./schema";

const etf = (id: string, name: string, baseIndex: string): Evidence => ({
  id,
  tool: "get_etf_kr_price",
  label: "국내 ETF 시세 확인",
  values: { name, baseIndex, "latest.close": 78660 },
  source: { name: "금융위원회 증권상품시세정보", url: "https://www.data.go.kr/data/15094806/openapi.do", asOf: "2026-11-24" },
});

describe("Easy 요약의 ETF 소개 한 문장 (QA-02)", () => {
  it("읽는 소리의 받침으로 은 · 는 / 을 · 를 을 고른다", () => {
    expect(hasBatchim("KODEX 200")).toBe(true); // 이백
    expect(hasBatchim("TIGER 미국S&P500")).toBe(true);
    expect(hasBatchim("ACE KRX금현물")).toBe(true);
    expect(hasBatchim("KODEX 2차전지산업")).toBe(true);
    expect(hasBatchim("TIGER 미국테크TOP10 INDXX")).toBe(false); // 엑스
    expect(hasBatchim("KODEX 코스닥150")).toBe(true);
    expect(hasBatchim("코스피 200 지수")).toBe(false);
    expect(hasBatchim("KIS 10년 국고채 지수 (총수익)")).toBe(false);
  });

  it("기초지수로 소개 문장을 만든다 (지수 · 괄호 꼬리 정리)", () => {
    expect(etfIntro("KODEX 200", "코스피 200")).toBe("KODEX 200은 코스피 200 지수를 따라가는 국내 상장 ETF예요.");
    expect(etfIntro("ACE KRX금현물", "KRX 금현물지수")).toBe("ACE KRX금현물은 KRX 금현물지수를 따라가는 국내 상장 ETF예요.");
    expect(etfIntro("ACE 국고채10년", "KIS 10년 국고채 지수 (총수익)")).toBe("ACE 국고채10년은 KIS 10년 국고채 지수를 따라가는 국내 상장 ETF예요.");
    expect(etfIntro("TIGER 미국나스닥100", "NASDAQ 100")).toBe("TIGER 미국나스닥100은 NASDAQ 100 지수를 따라가는 국내 상장 ETF예요.");
  });

  it("Easy 요약이 이름을 설명 없이 쓰면 그 이름이 처음 나오는 문장 앞에 넣는다 (11/25 로컬 'KODEX 200 요즘 어때?')", () => {
    const out = withEtfIntro(
      { summary: "KODEX 200은 2026-11-24 하루 반등했지만, 최근 한 달 가격 수익률은 하락했어요. 한 달 가격 수익률은 -8.53%였어요." },
      [etf("E1", "KODEX 200", "코스피 200")],
      "easy",
    );
    expect(out.summary).toBe("KODEX 200은 코스피 200 지수를 따라가는 국내 상장 ETF예요. KODEX 200은 2026-11-24 하루 반등했지만, 최근 한 달 가격 수익률은 하락했어요. 한 달 가격 수익률은 -8.53%였어요.");
  });

  it("상품 이름에 든 지수 이름은 설명으로 보지 않는다 (11/25 로컬 'TIGER 미국S&P500 수익률 어때?')", () => {
    const out = withEtfIntro({ summary: "TIGER 미국S&P500은 최근 30일 가격 기준으로 하락했어요." }, [etf("E1", "TIGER 미국S&P500", "S&P 500")], "easy");
    expect(out.summary).toBe("TIGER 미국S&P500은 S&P 500 지수를 따라가는 국내 상장 ETF예요. TIGER 미국S&P500은 최근 30일 가격 기준으로 하락했어요.");
  });

  it("이미 설명했거나 Easy 가 아니거나 이름이 셋 이상(대표 ETF 비교)이면 그대로", () => {
    const explained = { summary: "KODEX 200은 코스피 200 지수를 따라가도록 만든 ETF예요. 종가는 80,630원이에요." };
    expect(withEtfIntro(explained, [etf("E1", "KODEX 200", "코스피 200")], "easy")).toBe(explained);
    const plain = { summary: "KODEX 200은 하루 반등했어요." };
    expect(withEtfIntro(plain, [etf("E1", "KODEX 200", "코스피 200")], "standard")).toBe(plain);
    const many = { summary: "KODEX 200 · KODEX 코스닥150 · TIGER 미국S&P500 이 모두 내렸어요." };
    const basket = [etf("E1", "KODEX 200", "코스피 200"), etf("E2", "KODEX 코스닥150", "코스닥 150"), etf("E3", "TIGER 미국S&P500", "S&P 500")];
    expect(withEtfIntro(many, basket, "easy")).toBe(many);
    const none = { summary: "국내 국채 ETF가 올랐어요." };
    expect(withEtfIntro(none, basket, "easy")).toBe(none);
  });
});
