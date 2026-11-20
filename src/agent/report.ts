import { formatAge } from "../lib/age";
import type { ToolStep } from "./context";
import { labelFor } from "./events";
import type { ChangeDetail, Evidence, Intent, NumberCheck, Report, ReportMode, Verification, WriterOutput } from "./schema";
import { withPageUrl } from "./sources";

/** AI 생성 고지 (AI 기본법). 리포트 상단과 History 에 같이 남습니다. */
export const DISCLOSURE = "이 리포트는 생성형 AI 머핀이 여러 자료를 바탕으로 작성했으며, 내용에 오류나 누락이 있을 수 있어요. 출처와 기준일, 확인하지 못한 내용을 함께 살펴봐 주세요. 투자 권유가 아닌 참고용 정보이므로, 실제 투자 결정은 본인의 투자 목적과 위험 감수 수준을 충분히 고려해 신중하게 내려주세요.";

/** 판단 요청 모드("사도 돼?")의 상단 안내. 화면의 배너가 보여 줍니다. */
export const DECISION_NOTICE = "투자 판단을 대신하지 않습니다. 아래는 판단에 필요한 사실만 정리한 것입니다.";

/** 범위 밖 모드의 상단 안내. 조사 · 정제 · 작성을 건너뛰었다는 뜻입니다. */
export const OUT_OF_SCOPE_NOTICE = "머핀이 다루는 범위(환율 · 국내 ETF · 경제 뉴스 · 금리 · 물가 지표) 밖의 질문이라 데이터를 조사하지 않았습니다.";

/**
 * 범위 밖 안내의 추천 질문. 질문의 낱말로 영역을 짚어 "바로 넣을 수 있는 숫자 질문" 세 개를 고릅니다 (11/19 페르소나 테스트: 60건 중 15건이
 * "환율 우대 90%" · "적금 이자 계산" 같은 생활 금융 질문에 고정 추천 3개만 받음). 짚이는 게 없으면 기본 세 개.
 */
const SCOPE_SUGGESTIONS: { match: RegExp; topics: [string, string][] }[] = [
  { match: /엔화|엔\s*환율|만\s*엔|\d\s*엔|엔\s*(여행|환전|예산)|\bJPY\b|일본/i, topics: [
    ["오늘 원엔 환율 얼마야?", "100엔당 원화 금액과 기준일을 출처와 함께 보여 줍니다"],
    ["최근 한 달 원엔 환율 얼마나 움직였어?", "30일 전과 비교한 변화와 평소 움직임 폭을 보여 줍니다"],
    ["환율이 왜 움직여?", "큰 움직임이면 금리 차이 · 뉴스 · 다른 통화 흐름에서 원인을 확인합니다"],
  ] },
  { match: /환율|달러|유로|환전|우대|\bUSD\b|\bEUR\b/i, topics: [
    ["오늘 달러 환율 얼마야?", "1달러당 원화 금액과 기준일을 출처와 함께 보여 줍니다"],
    ["최근 한 달 원달러 환율 얼마나 움직였어?", "30일 전과 비교한 변화와 평소 움직임 폭을 보여 줍니다"],
    ["요즘 원달러 환율이 왜 이렇게 움직여?", "큰 움직임이면 금리 차이 · 뉴스 · 다른 통화 흐름에서 원인을 확인합니다"],
  ] },
  { match: /적금|예금|이자|대출|금리|이율/, topics: [
    ["한국 기준금리 지금 몇 %야?", "한국은행 기준금리와 기준일을 출처와 함께 보여 줍니다"],
    ["한국 기준금리 미국이랑 얼마나 차이 나?", "두 나라 정책금리 차이를 계산해 보여 줍니다"],
    ["기준금리가 내리면 예금 금리는 어떻게 돼?", "기준금리와 예금 금리의 관계를 데이터 기준으로 설명합니다"],
  ] },
  { match: /물가|장바구니|점심|밥값|인플레|\bCPI\b/i, topics: [
    ["최근 우리나라 물가가 왜 올랐어?", "소비자물가 상승률과 품목군별 기여도로 원인을 보여 줍니다"],
    ["요즘 물가 상승률 얼마야?", "전년 같은 달 대비 · 전월 대비 상승률을 출처와 함께 보여 줍니다"],
    ["지난달 대비 물가 얼마나 올랐어?", "전월 대비 변화와 많이 오른 품목군을 보여 줍니다"],
  ] },
  { match: /ETF|KODEX|TIGER|코스피|지수|주식|S&P|나스닥/i, topics: [
    ["KODEX 200 요즘 어때?", "종가 · 순자산가치 · 괴리율을 기준일과 함께 보여 줍니다"],
    ["KODEX 200이 코스피 200을 잘 따라가?", "ETF 와 기초지수의 기간 수익률 차이를 계산해 보여 줍니다"],
    ["KODEX 200 한 달 수익률 얼마야?", "30일 전 종가와 비교한 수익률을 보여 줍니다"],
  ] },
  { match: /뉴스|경제|경기|수출/, topics: [
    ["이번 주 경제 뉴스 뭐가 있어?", "최근 경제 기사 제목과 본문 확보 여부를 함께 보여 줍니다"],
    ["요즘 원달러 환율이 왜 이렇게 움직여?", "큰 움직임이면 금리 차이 · 뉴스 · 다른 통화 흐름에서 원인을 확인합니다"],
    ["최근 우리나라 물가가 왜 올랐어?", "소비자물가 상승률과 품목군별 기여도로 원인을 보여 줍니다"],
  ] },
];
const DEFAULT_SUGGESTIONS: [string, string][] = [
  ["오늘 달러 환율 얼마야?", "1달러당 원화 금액과 기준일을 출처와 함께 보여 줍니다"],
  ["한국 기준금리는 왜 그대로야?", "한국은행 기준금리와 최근 변화를 출처와 함께 보여 줍니다"],
  ["KODEX 200 요즘 어때?", "종가 · 순자산가치 · 괴리율을 기준일과 함께 보여 줍니다"],
];

export function scopeSuggestions(question: string): [string, string][] {
  return SCOPE_SUGGESTIONS.find((s) => s.match.test(question))?.topics ?? DEFAULT_SUGGESTIONS;
}

/** 범위 밖 질문에 모델 없이 돌려주는 고정 본문. 숫자가 없어 검증은 항상 pass 입니다. 추천 질문은 질문의 영역에 맞춥니다. */
export function outOfScopeOutput(question: string): WriterOutput {
  const topics = scopeSuggestions(question);
  return {
    summary:
      "머핀은 환율 · 국내 ETF · 경제 뉴스 · 금리 · 물가 지표의 숫자와 출처가 있는 질문에 답합니다. " +
      "이 질문은 그 데이터로 답하기 어려운 질문(개념 설명 · 상품 조건 · 계산 공식 등)이라 조사하지 않았습니다. " +
      "아래처럼 숫자를 물어보는 질문으로 바꾸면 출처가 있는 리포트로 답합니다.",
    headline: null,
    numbers: [],
    why: [],
    impact: [],
    impactTitles: [],
    caveats: [],
    dataGaps: [`"${question}" 에 답할 수 있는 tool 이 없습니다.`],
    nextTopics: topics.map(([topic]) => topic),
    topicReasons: topics.map(([, reason]) => reason),
  };
}

/** 미국 상장 ETF 안내의 상단 문구. 국내 ETF tool 로는 조회할 수 없어 조사를 건너뛰었다는 뜻입니다. */
export const FOREIGN_ETF_NOTICE = "미국에 상장된 ETF 는 머핀이 조회할 수 없어 데이터를 조사하지 않았습니다. 머핀은 국내 상장 ETF 만 봅니다.";

/**
 * 미국 상장 ETF 티커와, 같은 지수를 따라가는 국내 상장 ETF (11/20 QA: "QQQ 요즘 수익률 어때?" 가 빈 칸만 있는 리포트로 나옴).
 * 짝이 없는 티커(domestic 없음)는 국내 ETF 기본 질문을 추천합니다.
 */
const FOREIGN_ETFS: { match: RegExp; domestic?: [name: string, index: string] }[] = [
  { match: /\b(QQQ|QQQM)\b/i, domestic: ["TIGER 미국나스닥100", "나스닥100"] },
  { match: /\b(SPY|VOO|IVV|SPLG)\b/i, domestic: ["TIGER 미국S&P500", "S&P500"] },
  { match: /\b(SCHD)\b/i, domestic: ["TIGER 미국배당다우존스", "미국 배당 다우존스"] },
  { match: /\b(TQQQ|SQQQ|SOXL|SOXX|VTI|DIA|IWM|TLT|ARKK|JEPI|JEPQ)\b/i },
];
/** 국내 상장 ETF 브랜드. 질문에 같이 있으면 국내 ETF 를 묻는 것이라 평소대로 조사합니다 (예: "TIGER 미국나스닥100 이랑 QQQ 차이") */
const DOMESTIC_ETF_BRAND = /\b(KODEX|TIGER|ACE|RISE|KBSTAR|SOL|HANARO|ARIRANG|PLUS|KOSEF|TIMEFOLIO|KIWOOM|\d{6})\b/i;

/**
 * 미국 상장 ETF 만 묻는 질문이면 모델 없이 돌려주는 고정 본문, 아니면 null.
 * 요약은 왜 볼 수 없는지 한 줄, 추천 질문은 같은 지수의 국내 상장 ETF 와 환율입니다. 숫자가 없어 검증은 항상 pass 입니다.
 */
export function foreignEtfOutput(question: string): WriterOutput | null {
  const hit = FOREIGN_ETFS.find((f) => f.match.test(question));
  if (!hit || DOMESTIC_ETF_BRAND.test(question)) return null;
  const ticker = question.match(hit.match)![0].toUpperCase();
  const topics: [string, string][] = hit.domestic
    ? [
        [`${hit.domestic[0]} 한 달 수익률 얼마야?`, `${ticker} 와 같은 ${hit.domestic[1]} 지수를 따라가는 국내 상장 ETF 입니다`],
        [`${hit.domestic[0]} 요즘 어때?`, "종가 · 순자산가치 · 괴리율을 기준일과 함께 보여 줍니다"],
      ]
    : [
        ["KODEX 200 요즘 어때?", "종가 · 순자산가치 · 괴리율을 기준일과 함께 보여 줍니다"],
        ["KODEX 200 한 달 수익률 얼마야?", "30일 전 종가와 비교한 수익률을 보여 줍니다"],
      ];
  topics.push(["최근 한 달 원달러 환율 얼마나 움직였어?", "해외 지수를 따라가는 ETF 는 환율 영향을 함께 받습니다"]);
  return {
    summary:
      `${ticker} 는 미국에 상장된 ETF 라 머핀이 볼 수 없습니다. 머핀은 국내에 상장된 ETF 만 조회합니다. ` +
      (hit.domestic
        ? `같은 ${hit.domestic[1]} 지수를 따라가는 국내 상장 ETF(예: ${hit.domestic[0]})는 이름으로 물어보면 확인할 수 있습니다.`
        : `국내 상장 ETF 는 "KODEX 200" 처럼 이름으로 물어보면 확인할 수 있습니다.`),
    headline: null,
    numbers: [],
    why: [],
    impact: [],
    impactTitles: [],
    caveats: [],
    dataGaps: [`${ticker} 는 미국 상장 ETF 라 시세 · 수익률을 조회할 수 없습니다.`],
    nextTopics: topics.map(([topic]) => topic),
    topicReasons: topics.map(([, reason]) => reason),
  };
}

/** why.evidence 가 "데이터로 확인되지 않음" 인지. 실행 로그 · 평가 · v1 변환이 같은 기준을 씁니다. */
export const UNSUPPORTED_EVIDENCE = /확인되지\s*않/;

/** why 의 basis 별 개수. unsupported 는 근거 판정(3단계) 결과라 지금은 항상 0 입니다. */
export function summarizeWhy(why: WriterOutput["why"]): Verification["why"] {
  const out = { data: 0, news: 0, none: 0, unsupported: 0 };
  for (const w of why) out[w.basis] += 1;
  return out;
}

/**
 * 증거 장부에서 출처 목록을 만듭니다. 같은 url · asOf 는 처음 것만 남깁니다.
 * 계산 결과처럼 url 이 없는 증거는 사용자가 열어볼 수 없으니 출처에 넣지 않습니다 (evidence 에는 남습니다).
 * url 이 API 주소면 사람이 읽는 공식 페이지를 pageUrl 로 붙입니다 (src/agent/sources.ts).
 */
export function sourcesFrom(evidence: Evidence[]): Report["sources"] {
  const out: Report["sources"] = [];
  for (const e of evidence) {
    if (!e.source.url) continue;
    if (out.some((s) => s.url === e.source.url && s.asOf === e.source.asOf)) continue;
    out.push(withPageUrl({ id: e.id, ...e.source }));
  }
  return out;
}

/** impactTitles · topicReasons 는 짝 목록과 개수가 같을 때만 리포트에 넣습니다 (검증이 맞춰 두지만 범위 밖 · 모킹 경로도 같은 규칙) */
function aligned(texts: string[] | undefined, total: number): string[] | undefined {
  return texts && texts.length > 0 && texts.length === total ? texts : undefined;
}

/**
 * 작성 출력 + 증거 장부 + 검증 결과 → 최종 리포트.
 * numbers 의 check 는 검증기(1단계)가 정하고, 건너뛰었으면 모두 unverified 라 화면에서 회색으로만 보입니다.
 */
/**
 * 조회가 실패해 저장된 응답(src/tools/cache.ts)을 쓴 tool 을 "확인하지 못한 것" 에 한 줄씩 넣습니다.
 * 모델이 장부 note 를 빠뜨려도 사용자에게 보이게 코드가 넣는 것이고, 검증 뒤에 붙이므로 검증 대상이 아닙니다. 같은 tool 이 여러 번이면 가장 오래된 나이 하나.
 */
export function fallbackGaps(steps: ToolStep[]): string[] {
  const oldest = new Map<string, number>();
  for (const s of steps) {
    if (s.status !== "ok" || s.fallbackAgeMs === undefined) continue;
    oldest.set(s.tool, Math.max(oldest.get(s.tool) ?? 0, s.fallbackAgeMs));
  }
  return [...oldest].map(([tool, age]) => `${labelFor(tool)}: 조회가 실패해 ${formatAge(age)} 전에 받은 응답을 썼습니다 (데이터 기준일은 출처 그대로)`);
}

/** 환율 tool 이름 (src/tools/fx). 장부에서 환율 자료를 찾을 때 씁니다 */
const FX_TOOL = "get_fx_krw_rate";

/**
 * 환율 자료를 쓴 리포트의 "주의점" 에 코드가 넣는 한 줄 (11/20 QA: "환율이 네이버에서 검색한 것과 다름. 왜지?").
 * tool 의 note 는 원본 보기에만 있어 잘 안 보이므로, 어떤 환율인지와 왜 다를 수 있는지를 주의점에 적습니다.
 * 검증 뒤에 붙여 검증 대상이 아니고, 작성이 이미 같은 설명(포털 · 은행 앱)을 썼으면 넣지 않습니다.
 */
export function fxBasisCaveats(evidence: Evidence[], caveats: string[] = []): string[] {
  const fx = evidence.find((e) => e.tool === FX_TOOL);
  if (!fx || caveats.some((c) => /포털|은행 앱/.test(c))) return [];
  return [
    `환율은 하루 한 번 집계되는 기준 환율입니다 (출처: ${fx.source.name}). 포털 · 은행 앱의 실시간 환율이나 수수료가 붙는 실제 환전 금액과는 다를 수 있습니다.`,
  ];
}

export function assembleReport(
  output: WriterOutput,
  evidence: Evidence[],
  verification: Verification,
  opts: {
    mode?: ReportMode;
    intent?: Intent;
    notice?: string;
    checks?: NumberCheck[];
    /** checks 와 같은 순서의 대조 세부 (장부 키 · 규칙) */
    matches?: Report["numbers"][number]["match"][];
    /** checks 와 같은 순서로, 코드가 장부에서 풀어 쓴 변화량 (src/agent/change.ts). 없는 자리는 undefined */
    changes?: (ChangeDetail | undefined)[];
    movement?: Report["movement"];
    charts?: Report["charts"];
  } = {},
): Report {
  const impactTitles = aligned(output.impactTitles, output.impact.length);
  const topicReasons = aligned(output.topicReasons, output.nextTopics.length);
  return {
    version: 2,
    mode: opts.mode ?? "research",
    ...(opts.notice ? { notice: opts.notice } : {}),
    ...(opts.intent ? { intent: opts.intent } : {}),
    summary: output.summary,
    ...(output.headline ? { headline: output.headline } : {}),
    numbers: output.numbers.map((n, i) => ({
      ...n,
      check: opts.checks?.[i] ?? "unverified",
      ...(opts.matches?.[i] ? { match: opts.matches[i] } : {}),
      ...(opts.changes?.[i] ? { changeDetail: opts.changes[i] } : {}),
    })),
    why: output.why,
    impact: output.impact,
    ...(impactTitles ? { impactTitles } : {}),
    caveats: output.caveats,
    dataGaps: output.dataGaps,
    nextTopics: output.nextTopics,
    ...(topicReasons ? { topicReasons } : {}),
    sources: sourcesFrom(evidence),
    evidence: evidence.map((e) => ({ ...e, source: withPageUrl(e.source) })),
    verification,
    ...(opts.movement ? { movement: opts.movement } : {}),
    ...(opts.charts ? { charts: opts.charts } : {}),
    disclosure: DISCLOSURE,
  };
}

/**
 * why 가 비었을 때 화면이 보여 줄 한 줄. 유의성 게이트 결과(movement.level)로 "평소 범위라 원인을 찾지 않음" 과
 * "후보를 봤지만 근거 부족" 을 구분합니다 (11/19 페르소나 테스트: 20명 중 17명이 "데이터가 없다" 는 빈 칸을 지적).
 * 원인을 묻지 않은 질문(현황 · 비교 · 판단 요청 · 범위 밖)이면 null 이고 화면은 칸을 숨깁니다
 * (11/20 QA: "KODEX 200 지금 사도 돼?" 에도 "원인 자료를 확보하지 못했습니다" 가 떠 실패처럼 읽힘). intent 가 없는 예전 기록은 전처럼 보여 줍니다.
 */
export function whyEmptyNote(report: Pick<Report, "movement" | "intent">): string | null {
  if (report.intent && report.intent !== "cause") return null;
  const level = report.movement?.level;
  if (level === "normal") {
    return "이번 움직임은 지난 90일의 평소 범위 안이라 원인을 따로 찾지 않았습니다. 평소보다 크게 움직일 때 금리 차이 · 뉴스 · 다른 통화 같은 원인 후보를 확인합니다.";
  }
  if (level === "notable" || level === "extreme") {
    return "평소보다 큰 움직임이라 원인 후보(금리 차이 · 뉴스 · 다른 통화)를 확인했지만, 이번 움직임을 설명하는 근거는 부족했습니다. 아래 '주의점과 확인하지 못한 것' 을 참고하세요.";
  }
  return "이번 리포트에서는 원인을 뒷받침할 자료를 확보하지 못했습니다. 아래 '주의점과 확인하지 못한 것' 에 무엇이 부족했는지 적었습니다.";
}
