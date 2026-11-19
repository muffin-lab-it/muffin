/**
 * 환율 원인 질문의 필수 근거 보강 (리더, 11/16).
 *
 * 원인 지도(movement.ts causeMap)의 "다른 통화 대비 흐름" 후보는 잰 통화와 같은 기간의 다른 통화(USD · EUR · JPY 중 나머지) 환율이 있어야 확인됩니다.
 * 조사(research.ts)는 그 지도를 모르고, 지시문에 없는 통화를 모델이 알아서 더 조회하는 건 절반쯤이었습니다 (11/16 실측: 같은 질문 3회 중 1회 누락 → 원인 0개).
 * "순서와 필수 근거는 코드가 보장하고 모델은 단계 안에서 판단한다" 는 원칙대로, 조사가 끝난 뒤 장부에 없는 통화만 환율 tool 을 직접 불러 채웁니다.
 *  - 조사와 같은 래퍼(defineTool)를 지나므로 장부(E 번호) · 실행 기록(step · 진행 화면) · 재시도 · 캐시 폴백이 그대로 적용됩니다.
 *  - 실패해도 리포트는 이어집니다 (error step 만 남음). 환율이 주제가 아니거나 잴 대상이 없거나 환율 tool 이 없으면 아무것도 부르지 않습니다.
 *  - 정제 전에 채우므로 정제가 사실 목록에 넣을 수 있고, 큰 움직임이면 정제가 뺐더라도 후보 근거로 다시 봅니다 (movement.ts rescuedRefs).
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { missingPairs, type Target } from "./movement";
import { areaTools } from "./plan";
import type { Area, Evidence } from "./schema";

/** 레지스트리 tool 중 여기서 쓰는 부분 (Agents SDK FunctionTool 의 name · invoke) */
export type InvokableTool = { name: string; invoke: (runContext: RunContext<ResearchContext>, input: string) => Promise<unknown> };

/** target: muffin.ts 가 보강 전에 고른 잴 대상. 보강으로 통화가 늘어도 게이트가 같은 통화를 재게 밖에서 한 번만 고릅니다 (Codex 리뷰) */
export async function ensureOtherPairs(ctx: ResearchContext, question: string, area: Area | undefined, tools: readonly InvokableTool[], target?: Target): Promise<{ currency: string; days: number }[]> {
  const fx = tools.find((t) => t.name === areaTools.fx);
  if (!fx) return [];
  const missing = missingPairs(ctx.evidence, question, area, target);
  if (missing.length === 0) return [];
  const rc = new RunContext(ctx);
  // 래퍼가 실패를 장부 · step 에 남기므로 여기서는 리포트를 멈추지 않습니다
  await Promise.all(missing.map((m) => fx.invoke(rc, JSON.stringify(m)).catch(() => undefined)));
  return missing;
}

/** 물가 원인 질문인지. 분류 영역과 무관하게 질문 낱말로 봅니다 (뉴스 영역의 "물가가 왜 올랐는지 뉴스에서는…" 도 품목군 자료가 있으면 낫습니다) */
export function isPriceQuestion(question: string): boolean {
  return /물가|소비자물가|인플레|\bcpi\b/i.test(question);
}

/** 품목군 조회 입력. endMonth 는 조사가 받은 총지수의 관측 월로 바꿔 보냅니다 (months 는 tool 이 무시) */
export const CPI_CATEGORIES_INPUT = { country: "KR", indicator: "cpi_categories", endMonth: null, months: 1 } as const;

export function hasCpiCategories(evidence: Evidence[]): boolean {
  return evidence.some((e) => e.values.indicator === "cpi_categories");
}

/** 조사가 받아 온 한국 CPI 총지수 항목의 최신 관측 월 (YYYYMM). 없으면 undefined */
export function krCpiMonth(evidence: Evidence[]): string | undefined {
  const cpi = evidence.find((e) => e.values.indicator === "cpi" && e.values.country === "KR" && /^\d{6}$/.test(String(e.values["latest.month"] ?? "")));
  return cpi ? String(cpi.values["latest.month"]) : undefined;
}

/**
 * 물가 원인 질문이면 품목군별 등락률 · 기여도(get_macro_indicators cpi_categories)를 코드가 채웁니다 (11/19 페르소나 테스트: "왜 올랐어" 에 원인 0개).
 * 조사가 이미 받아 왔거나, 물가 질문이 아니거나, 거시지표 tool 이 없으면 부르지 않습니다. 실패해도 리포트는 이어집니다 (error step 만 남음).
 */
export async function ensureCpiCategories(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<boolean> {
  const macro = tools.find((t) => t.name === areaTools.macro);
  if (!macro || !isPriceQuestion(question) || hasCpiCategories(ctx.evidence)) return false;
  // 조사가 한국 CPI 총지수를 받아 왔을 때만, 그 관측 월에 맞춰 품목군을 받습니다. 미국 물가 질문이나 과거 월 질문에 최신 한국 품목군을 붙이지 않게 (Codex 리뷰)
  const month = krCpiMonth(ctx.evidence);
  if (!month) return false;
  await macro.invoke(new RunContext(ctx), JSON.stringify({ ...CPI_CATEGORIES_INPUT, endMonth: month })).catch(() => undefined);
  return true;
}
