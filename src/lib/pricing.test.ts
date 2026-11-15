import { describe, expect, it } from "vitest";
import { addModelUsage, cachedTokensOf, costOf, formatCost, formatKrw, formatUsd, KRW_PER_USD, meanCost, priceFor, PRICES, sumCost, type UsageByModel } from "./pricing";

describe("리포트 비용 (src/lib/pricing.ts)", () => {
  it("모델 id 는 정확히 같거나 날짜가 붙은 것만 맞추고, 가장 긴 접두사를 고른다", () => {
    expect(priceFor("gpt-6-luna")).toBe(PRICES["gpt-6-luna"]);
    expect(priceFor("gpt-6-luna-2026-09-22")).toBe(PRICES["gpt-6-luna"]);
    expect(priceFor("gpt-5.4-mini-2026-03-17")).toBe(PRICES["gpt-5.4-mini"]);
    expect(priceFor("gpt-6-lunatic")).toBeUndefined();
    expect(priceFor("gpt-6")).toBeUndefined();
  });

  it("단계별 토큰을 모델 칸에 더하고, 캐시 적중은 SDK 의 요청별 배열에서 합산한다", () => {
    const byModel: UsageByModel = {};
    addModelUsage(byModel, "gpt-6-luna", { requests: 1, inputTokens: 1_000, outputTokens: 100, inputTokensDetails: [{ cached_tokens: 200 }] });
    addModelUsage(byModel, "gpt-6-luna", { requests: 1, inputTokens: 500, outputTokens: 50, inputTokensDetails: [{ cached_tokens: 100 }, { cached_tokens: 50 }] });
    addModelUsage(byModel, "gpt-5.4-mini", { requests: 1, inputTokens: 300, outputTokens: 30 });
    expect(byModel).toEqual({
      "gpt-6-luna": { requests: 2, inputTokens: 1_500, cachedInputTokens: 350, outputTokens: 150 },
      "gpt-5.4-mini": { requests: 1, inputTokens: 300, cachedInputTokens: 0, outputTokens: 30 },
    });
    expect(cachedTokensOf({ cached_tokens: 7 })).toBe(7);
    expect(cachedTokensOf(undefined)).toBe(0);
    // 캐시 수가 입력보다 크게 오는 이상한 응답은 입력까지만 센다
    addModelUsage(byModel, "gpt-6-sol", { requests: 1, inputTokens: 10, outputTokens: 1, inputTokensDetails: [{ cached_tokens: 99 }] });
    expect(byModel["gpt-6-sol"]!.cachedInputTokens).toBe(10);
  });

  it("비용 = (입력 - 캐시) × 입력 단가 + 캐시 × 캐시 단가 + 출력 × 출력 단가, 100만 토큰 기준. 원화는 상수 환율", () => {
    const cost = costOf({
      requests: 2,
      inputTokens: 10_300,
      outputTokens: 1_030,
      byModel: {
        "gpt-6-luna": { requests: 1, inputTokens: 10_000, cachedInputTokens: 2_000, outputTokens: 1_000 },
        "gpt-5.4-mini": { requests: 1, inputTokens: 300, cachedInputTokens: 0, outputTokens: 30 },
      },
    });
    // luna: 8000×0.1 + 2000×0.01 + 1000×0.5 = 1320 / 1e6, mini: 300×0.75 + 30×4.5 = 360 / 1e6
    expect(cost).toEqual({ usd: 0.00168, krw: Math.round(0.00168 * KRW_PER_USD * 10) / 10, partial: false });
  });

  it("모델별 기록이 없으면 null, 단가를 모르는 모델만 있으면 null, 섞여 있으면 partial", () => {
    expect(costOf(undefined)).toBeNull();
    expect(costOf({ requests: 1, inputTokens: 10, outputTokens: 1 })).toBeNull();
    expect(costOf({ requests: 1, inputTokens: 10, outputTokens: 1, byModel: {} })).toBeNull();
    expect(costOf({ requests: 1, inputTokens: 10, outputTokens: 1, byModel: { "gpt-9-nova": { requests: 1, inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 } } })).toBeNull();
    const mixed = costOf({
      requests: 2,
      inputTokens: 1_010,
      outputTokens: 2,
      byModel: {
        "gpt-9-nova": { requests: 1, inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 },
        "gpt-6-luna": { requests: 1, inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 1 },
      },
    });
    expect(mixed).toMatchObject({ partial: true });
    // luna 1000×0.1 + 1×0.5 = 100.5 / 1e6 → 소수 다섯째 자리로 반올림
    expect(mixed!.usd).toBe(0.0001);
  });

  it("합계 · 평균과 화면 문구", () => {
    const a = { usd: 0.01, krw: 13.35, partial: false };
    const b = { usd: 0.07, krw: 93.45, partial: true };
    expect(sumCost([a, b])).toEqual({ usd: 0.08, krw: 106.8, partial: true });
    expect(meanCost([a, b])).toEqual({ usd: 0.04, krw: 53.4, partial: true });
    expect(formatUsd(0.0112)).toBe("$0.011");
    expect(formatUsd(0.07)).toBe("$0.070");
    expect(formatUsd(1.2)).toBe("$1.20");
    expect(formatKrw(14.6)).toBe("약 15원");
    expect(formatKrw(1234.4)).toBe("약 1,234원");
    expect(formatKrw(0.4)).toBe("1원 미만");
    expect(formatCost(a)).toBe("$0.010 · 약 13원");
    expect(formatCost(b)).toBe("$0.070 · 약 93원 (일부 모델 단가 없음)");
    expect(formatCost(null)).toBe("-");
  });
});
