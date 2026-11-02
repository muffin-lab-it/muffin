/**
 * /admin 예시 데이터. runs 표가 연결되기 전에 화면을 확인하는 용도이고, 실제 요청이 아닙니다 (화면에도 그렇게 표시).
 * now 기준 최근 7일에 낮에는 촘촘히, 밤(한국 시간 1~8시)에는 드문드문 흩어 놓습니다. 같은 now 면 항상 같은 값입니다 (테스트 · 스크린샷용).
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
  { question: "엔화 환율 지금 얼마야? 일본 여행 가려고", area: "fx", depth: "easy", intent: "status", tools: ["get_fx_krw_rate"], baseMs: 11_400 },
  { question: "미국 금리가 내리면 내 대출 이자는 어떻게 돼?", area: "rate", depth: "standard", intent: "cause", tools: ["get_rate_data", "get_korean_economic_news"], baseMs: 28_800 },
];

const COUNT = 150;
const WEEK_MS = 7 * 24 * 60 * 60_000;
// 실패 · 특수 줄은 번호 규칙으로 섞습니다. 앞의 것이 우선입니다.
const isMock = (i: number) => i % 29 === 11;
const isLimited = (i: number) => i % 37 === 5;
const isBadInput = (i: number) => i % 53 === 21;
const isStale = (i: number) => i % 71 === 33;
const isTimeout = (i: number) => i % 23 === 7;
const isModelFail = (i: number) => i % 41 === 13;

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
  get_etf_kr_price: [0.01, "공공데이터포털 응답 시간 초과"],
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

function rowFor(s: Scenario, i: number, base: Pick<RunRow, "id" | "at" | "input" | "intent">): RunRow {
  if (isMock(i)) return { ...okRow(s, i, base), mock: true, model: null, ms: between(i, 7, [900, 1_600]) };
  // 호출 제한은 바디를 읽기 전에 막으므로 질문이 없습니다 (docs/web-spec.md 4.5).
  if (isLimited(i)) return { ...base, input: null, intent: null, ok: false, stage: "limited", mock: false, ms: 6, error: "브라우저 키 10분 한도 (10회)" };
  if (isBadInput(i)) return { ...base, input: null, intent: null, ok: false, stage: "input", mock: false, ms: 3, error: "invalid body" };
  // 범위 밖 질문은 2초 안에 끝나므로 조사 중 실패 · 멈춤으로 두지 않습니다.
  if (s.intent === "out_of_scope") return okRow(s, i, base);
  if (isStale(i)) return { ...base, ok: false, stage: "started", mock: false, ms: 0 };
  if (isTimeout(i)) {
    return { ...base, ok: false, stage: "agent", mock: false, ms: between(i, 8, [55_020, 55_480]), error: "조사 시간이 초과되었습니다. 질문 범위를 줄여 다시 시도해 주세요." };
  }
  if (isModelFail(i)) {
    return { ...base, ok: false, stage: "agent", mock: false, ms: between(i, 8, [31_200, 33_900]), error: "OpenAI 요청 시간 초과 (재시도 1회 후에도 응답 없음)" };
  }
  return okRow(s, i, base);
}

/** 최근 7일의 예시 실행 로그 (최신순). 성공 · 시간 초과 · 모델 오류 · 호출 제한 · 입력 오류 · 멈춘 요청 · Mock · tool 실패가 섞여 있습니다. */
export function sampleRuns(now = new Date()): RunRow[] {
  const rows: RunRow[] = [];
  let t = now.getTime() - 4 * 60_000; // 가장 최근 요청은 4분 전
  for (let i = 0; i < COUNT && t > now.getTime() - WEEK_MS; i++) {
    const s = scenarios[(i * 7 + Math.floor(i / 10)) % scenarios.length]!;
    const base = {
      id: `${t.toString(36)}-${(i * 7919 + 104_729).toString(36).slice(-6)}`,
      at: new Date(t).toISOString(),
      input: { question: s.question, depth: s.depth, area: s.area },
      intent: s.intent,
    };
    rows.push(rowFor(s, i, base));
    const kstHour = new Date(t + 9 * 60 * 60_000).getUTCHours();
    const night = kstHour >= 1 && kstHour < 8;
    t -= Math.round((14 + 80 * noise(i, 9)) * (night ? 3.5 : 1)) * 60_000;
  }
  return rows;
}
