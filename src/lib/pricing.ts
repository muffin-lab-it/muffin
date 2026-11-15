/**
 * 모델별 단가와 리포트 비용 (리더). /admin 의 "리포트당 비용" 타일, /compare 의 "비용" 줄, 리포트 끝 이벤트의 cost 가 씁니다.
 * 팀원이 리포트를 돌려 보며 "한 장에 얼마" 를 바로 보게 하려는 것입니다 (Standard 는 10~20원, Deep 은 100원 안팎).
 *
 * 단가는 USD / 100만 토큰, 표준 요금입니다 (배치 · 지역 처리 요금 제외). 결제 화면과 조금 다를 수 있습니다.
 *  - gpt-5.4-mini: OpenAI 모델 페이지 https://developers.openai.com/api/docs/models/gpt-5.4-mini
 *  - gpt-6-luna · gpt-6-sol: https://llmgateway.io/changelog/gpt-6-sol-luna · https://pricepertoken.com/pricing-page/model/openai-gpt-6-luna
 * 캐시된 입력(프롬프트 캐시 적중)은 더 싼 단가로 셉니다. 환율은 상수라 가끔 손으로 갱신합니다.
 * 단가를 모르는 모델의 토큰은 비용에서 빠지고 partial 로 표시합니다 (0원처럼 보이지 않게).
 */
import { z } from "zod";

export const PRICE_AS_OF = "2026-11-15";
/** 원/달러. 2026-11-15 Frankfurter 중간환율 (환율 tool 과 같은 출처). 표시용 근사값 */
export const KRW_PER_USD = 1335;

export type Price = { input: number; cachedInput: number; output: number };
export const PRICES: Record<string, Price> = {
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
};

export const modelUsageSchema = z.object({
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  /** 입력 중 프롬프트 캐시에 맞은 토큰 (inputTokens 에 포함된 수) */
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type UsageByModel = Record<string, ModelUsage>;

/** 실행 한 번의 토큰 합계. byModel 은 11/15 이후 실행에만 있습니다 (모델별 단가를 적용하려면 필요) */
export const usageSummarySchema = z.object({
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  byModel: z.record(z.string(), modelUsageSchema).optional(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export type Cost = {
  usd: number;
  krw: number;
  /** 단가를 모르는 모델이 섞여 그 토큰이 빠진 값이면 true */
  partial: boolean;
};

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** 모델 id 에 맞는 단가. "gpt-6-luna-2026-09-22" 처럼 날짜가 붙은 id 도 가장 긴 접두사로 맞춥니다 */
export function priceFor(model: string): Price | undefined {
  const key = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key] : undefined;
}

/** Agents SDK 의 RunContext.usage 모양 중 쓰는 칸. inputTokensDetails 는 요청마다 { cached_tokens, … } 한 항목 */
export type SdkUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  inputTokensDetails?: Array<Record<string, number>> | Record<string, number>;
};

/** 캐시 적중 토큰 수. SDK 가 요청별 배열로 주거나 한 객체로 줄 수 있어 둘 다 받습니다 */
export function cachedTokensOf(details: SdkUsage["inputTokensDetails"]): number {
  if (!details) return 0;
  const entries = Array.isArray(details) ? details : [details];
  return entries.reduce((sum, d) => sum + (Number(d?.cached_tokens) || 0), 0);
}

/** 단계 하나가 쓴 토큰을 그 단계의 모델 칸에 더합니다 (muffin.ts 가 단계마다 부릅니다) */
export function addModelUsage(byModel: UsageByModel, model: string, usage: SdkUsage): void {
  const slot = byModel[model] ?? { requests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  slot.requests += usage.requests;
  slot.inputTokens += usage.inputTokens;
  slot.cachedInputTokens += Math.min(usage.inputTokens, cachedTokensOf(usage.inputTokensDetails));
  slot.outputTokens += usage.outputTokens;
  byModel[model] = slot;
}

/** 리포트 한 장의 비용. 모델별 기록이 없으면(11/15 전 기록 · 모킹 · 녹화) null */
export function costOf(usage: UsageSummary | null | undefined): Cost | null {
  const byModel = usage?.byModel;
  if (!byModel || Object.keys(byModel).length === 0) return null;
  let usd = 0;
  let priced = 0;
  let partial = false;
  for (const [model, u] of Object.entries(byModel)) {
    const price = priceFor(model);
    if (!price) {
      partial = true;
      continue;
    }
    priced += 1;
    const cached = Math.min(u.cachedInputTokens, u.inputTokens);
    usd += ((u.inputTokens - cached) * price.input + cached * price.cachedInput + u.outputTokens * price.output) / 1_000_000;
  }
  if (priced === 0) return null;
  return { usd: round(usd, 5), krw: round(usd * KRW_PER_USD, 1), partial };
}

export function sumCost(costs: Cost[]): Cost {
  const usd = costs.reduce((sum, c) => sum + c.usd, 0);
  return { usd: round(usd, 5), krw: round(usd * KRW_PER_USD, 1), partial: costs.some((c) => c.partial) };
}

export function meanCost(costs: Cost[]): Cost {
  const total = sumCost(costs);
  const usd = costs.length ? total.usd / costs.length : 0;
  return { usd: round(usd, 5), krw: round(usd * KRW_PER_USD, 1), partial: total.partial };
}

/** "$0.011" · "$0.07" · "$1.20". 1센트 밑은 셋째 자리까지 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd >= 0.1 ? 2 : 3)}`;
}

/** "약 15원". 1원 밑은 "1원 미만" */
export function formatKrw(krw: number): string {
  return krw < 1 ? "1원 미만" : `약 ${Math.round(krw).toLocaleString("ko-KR")}원`;
}

/** 화면 한 칸에 들어가는 비용 문구. 없으면 "-" */
export function formatCost(cost: Cost | null | undefined): string {
  if (!cost) return "-";
  return `${formatUsd(cost.usd)} · ${formatKrw(cost.krw)}${cost.partial ? " (일부 모델 단가 없음)" : ""}`;
}
