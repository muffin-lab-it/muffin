/**
 * /admin 예시 데이터. runs 표가 연결되기 전에 화면을 확인하는 용도이고, 실제 요청이 아닙니다 (화면에도 그렇게 표시).
 * now 기준 최근 7일에 흩어 놓고, 같은 now 면 항상 같은 값이 나옵니다 (테스트 · 스크린샷용).
 * 시간 기준값은 10/28 ~ 10/30 실측(환율 원인 27.4초, ETF 30.1초, 금리 Deep 41.7초, 여행 Easy 10.8초)에서 가져왔습니다.
 */
import type { ToolStep } from "../agent/context";
import type { RunRow } from "./admin";

type Scenario = { question: string; area: string; depth: "easy" | "standard" | "deep"; intent: string; tools: string[]; baseMs: number };

const scenarios: Scenario[] = [
  { question: "요즘 원달러 환율이 왜 이렇게 움직여?", area: "fx", depth: "standard", intent: "cause", tools: ["get_fx_krw_rate", "get_korean_economic_news"], baseMs: 27_400 },
  { question: "다음 달에 미국 여행 가는데 요즘 환율 어때?", area: "fx", depth: "easy", intent: "status", tools: ["get_fx_krw_rate"], baseMs: 10_800 },
  { question: "KODEX 200 지금 사도 돼?", area: "etf", depth: "standard", intent: "decision", tools: ["get_etf_kr_price", "get_korean_economic_news"], baseMs: 30_100 },
  { question: "한국 기준금리랑 미국 금리 차이가 요즘 어때?", area: "rate", depth: "deep", intent: "compare", tools: ["get_rate_data", "get_rate_data", "calc_metrics"], baseMs: 41_700 },
  { question: "최근 우리나라 물가가 왜 올랐어?", area: "macro", depth: "standard", intent: "cause", tools: ["get_macro_indicators", "get_korean_economic_news"], baseMs: 24_300 },
  { question: "이번 주 경제 뉴스에서 금리 관련 이슈 정리해줘", area: "news", depth: "standard", intent: "status", tools: ["get_korean_economic_news"], baseMs: 19_600 },
  { question: "KODEX 200이랑 TIGER 200 최근 3개월 수익률 비교해줘", area: "etf", depth: "standard", intent: "compare", tools: ["get_etf_kr_price", "get_etf_kr_price", "calc_metrics"], baseMs: 26_900 },
  { question: "비트코인 지금 얼마야?", area: "etf", depth: "standard", intent: "out_of_scope", tools: [], baseMs: 2_300 },
];

const COUNT = 46;
// 실패는 리포트를 만드는 질문에만 둡니다 (범위 밖 질문은 2초 안에 끝나 시간 초과가 날 수 없음).
const TIMEOUT_FAILS = new Set([4, 18, 33]);
const MODEL_FAIL = 14;
const LIMITED = 9;
const BAD_INPUT = 27;
const STALE = 38;
const MOCKS = new Set([15, 41]);

const toolMs: Record<string, [number, number]> = {
  get_fx_krw_rate: [450, 1000],
  get_korean_economic_news: [250, 950],
  get_etf_kr_price: [600, 1500],
  get_rate_data: [400, 1200],
  get_macro_indicators: [450, 900],
  calc_metrics: [0, 2],
};
const toolFailures: Record<string, [number, string]> = {
  get_korean_economic_news: [0.2, "기사 본문을 확보하지 못했습니다"],
  get_rate_data: [0.06, "ECOS 응답 오류 (HTTP 503)"],
};
const tokens = { easy: [11_840, 1_630], standard: [19_270, 2_940], deep: [31_460, 5_210] } as const;

/** 0 이상 1 미만의 고정 난수. 같은 (i, k) 면 같은 값입니다. */
function noise(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const between = (i: number, k: number, [lo, hi]: readonly [number, number]) => Math.round(lo + (hi - lo) * noise(i, k));

function stepsFor(s: Scenario, i: number): ToolStep[] {
  return s.tools.map((tool, k) => {
    const [rate, error] = toolFailures[tool] ?? [0, ""];
    const failed = noise(i, 20 + k) < rate;
    return { tool, status: failed ? "error" : "ok", ms: between(i, 10 + k, toolMs[tool] ?? [300, 900]), ...(failed ? { error } : {}) };
  });
}

function okRow(s: Scenario, i: number, base: Pick<RunRow, "id" | "at" | "input" | "intent">): RunRow {
  if (s.intent === "out_of_scope") {
    return {
      ...base, ok: true, stage: "ok", mock: false, ms: between(i, 1, [1_900, 2_800]), model: "gpt-5.4-mini",
      usage: { requests: 1, inputTokens: between(i, 2, [1_880, 1_990]), outputTokens: between(i, 3, [120, 190]) },
      steps: [], rewrites: 0,
      verification: { status: "pass", numbers: { total: 0, verified: 0, derived: 0, reported: 0, unverified: 0 }, advice: 0, revisions: 0 },
    };
  }
  const revisions = i % 5 === 2 ? 1 : 0;
  const partial = i % 7 === 3;
  const total = s.depth === "easy" ? 2 : s.depth === "deep" ? 5 + (noise(i, 4) < 0.5 ? 0 : 1) : 3 + (noise(i, 4) < 0.5 ? 0 : 1);
  const derived = s.tools.includes("calc_metrics") ? 1 : 0;
  const reported = s.tools.includes("get_korean_economic_news") && noise(i, 5) < 0.3 ? 1 : 0;
  const unverified = partial ? 1 : 0;
  const [inputTokens, outputTokens] = tokens[s.depth];
  return {
    ...base, ok: true, stage: "ok", mock: false,
    ms: Math.round(s.baseMs * (0.82 + 0.4 * noise(i, 1))) + revisions * between(i, 6, [8_700, 11_600]),
    model: s.depth === "deep" ? "gpt-6-sol" : "gpt-6-luna",
    usage: {
      requests: (s.depth === "easy" ? 4 : s.depth === "deep" ? 6 : 5) + revisions,
      inputTokens: Math.round(inputTokens * (0.85 + 0.3 * noise(i, 2)) * (1 + 0.4 * revisions)),
      outputTokens: Math.round(outputTokens * (0.85 + 0.3 * noise(i, 3)) * (1 + 0.6 * revisions)),
    },
    steps: stepsFor(s, i),
    rewrites: revisions,
    verification: {
      status: partial ? "partial" : "pass",
      numbers: { total, verified: total - derived - reported - unverified, derived, reported, unverified },
      advice: 0,
      revisions,
    },
  };
}

/** 최근 7일의 예시 실행 로그 46줄 (최신순). 성공 · 시간 초과 · 모델 오류 · 호출 제한 · 입력 오류 · 멈춘 요청 · Mock 이 섞여 있습니다. */
export function sampleRuns(now = new Date()): RunRow[] {
  return Array.from({ length: COUNT }, (_, i) => {
    const s = scenarios[(i * 5) % scenarios.length]!;
    const t = now.getTime() - (7 + i * 217 + Math.round(40 * noise(i, 0))) * 60_000;
    const base = {
      id: `${t.toString(36)}-${(i * 7919 + 104_729).toString(36).slice(-6)}`,
      at: new Date(t).toISOString(),
      input: { question: s.question, depth: s.depth, area: s.area },
      intent: s.intent,
    };
    if (MOCKS.has(i)) return { ...okRow(s, i, base), mock: true, model: null, ms: between(i, 7, [900, 1_600]) };
    if (i === LIMITED) return { ...base, intent: null, ok: false, stage: "limited", mock: false, ms: 6, error: "브라우저 키 10분 한도 (10회)" };
    if (i === BAD_INPUT) return { ...base, input: null, intent: null, ok: false, stage: "input", mock: false, ms: 3, error: "invalid body" };
    if (i === STALE) return { ...base, ok: false, stage: "started", mock: false, ms: 0 };
    if (TIMEOUT_FAILS.has(i)) {
      return { ...base, ok: false, stage: "agent", mock: false, ms: between(i, 8, [55_020, 55_480]), error: "조사 시간이 초과되었습니다. 질문 범위를 줄여 다시 시도해 주세요." };
    }
    if (i === MODEL_FAIL) {
      return { ...base, ok: false, stage: "agent", mock: false, ms: between(i, 8, [31_200, 33_900]), error: "OpenAI 요청 시간 초과 (재시도 1회 후에도 응답 없음)" };
    }
    return okRow(s, i, base);
  });
}
