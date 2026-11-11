import { formatAge } from "../lib/age";
import type { ToolStep } from "./context";
import { labelFor } from "./events";
import type { ChangeDetail, Evidence, NumberCheck, Report, ReportMode, Verification, WriterOutput } from "./schema";
import { withPageUrl } from "./sources";

/** AI 생성 고지 (AI 기본법). 리포트 상단과 History 에 같이 남습니다. */
export const DISCLOSURE = "이 리포트는 생성형 AI 머핀이 여러 자료를 바탕으로 작성했으며, 내용에 오류나 누락이 있을 수 있어요. 출처와 기준일, 확인하지 못한 내용을 함께 살펴봐 주세요. 투자 권유가 아닌 참고용 정보이므로, 실제 투자 결정은 본인의 투자 목적과 위험 감수 수준을 충분히 고려해 신중하게 내려주세요.";

/** 판단 요청 모드("사도 돼?")의 상단 안내. 화면의 배너가 보여 줍니다. */
export const DECISION_NOTICE = "투자 판단을 대신하지 않습니다. 아래는 판단에 필요한 사실만 정리한 것입니다.";

/** 범위 밖 모드의 상단 안내. 조사 · 정제 · 작성을 건너뛰었다는 뜻입니다. */
export const OUT_OF_SCOPE_NOTICE = "머핀이 다루는 범위(환율 · 국내 ETF · 경제 뉴스 · 금리 · 물가 지표) 밖의 질문이라 데이터를 조사하지 않았습니다.";

/** 범위 밖 질문에 모델 없이 돌려주는 고정 본문. 숫자가 없어 검증은 항상 pass 입니다. */
export function outOfScopeOutput(question: string): WriterOutput {
  return {
    summary:
      "이 질문은 머핀이 다루는 금융 정보 범위(환율 · 국내 ETF · 경제 뉴스 · 금리 · 물가 지표) 밖이라 데이터를 조사하지 않았습니다. " +
      "범위 안의 질문으로 바꿔 물어보면 출처가 있는 리포트로 답합니다.",
    numbers: [],
    why: [],
    impact: [],
    caveats: [],
    dataGaps: [`"${question}" 에 답할 수 있는 tool 이 없습니다.`],
    nextTopics: ["오늘 달러 환율 얼마야?", "한국 기준금리는 왜 그대로야?", "KODEX 200 요즘 어때?"],
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
 */
export function sourcesFrom(evidence: Evidence[]): Report["sources"] {
  const out: Report["sources"] = [];
  for (const e of evidence) {
    if (!e.source.url) continue;
    if (out.some((s) => s.url === e.source.url && s.asOf === e.source.asOf)) continue;
    out.push({ id: e.id, ...e.source });
  }
  return out;
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

export function assembleReport(
  output: WriterOutput,
  evidence: Evidence[],
  verification: Verification,
  opts: {
    mode?: ReportMode;
    notice?: string;
    checks?: NumberCheck[];
    /** checks 와 같은 순서의 대조 세부 (장부 키 · 규칙) */
    matches?: Report["numbers"][number]["match"][];
    movement?: Report["movement"];
    charts?: Report["charts"];
  } = {},
): Report {
  return {
    version: 2,
    mode: opts.mode ?? "research",
    ...(opts.notice ? { notice: opts.notice } : {}),
    summary: output.summary,
    numbers: output.numbers.map((n, i) => ({ ...n, check: opts.checks?.[i] ?? "unverified", ...(opts.matches?.[i] ? { match: opts.matches[i] } : {}) })),
    why: output.why,
    impact: output.impact,
    caveats: output.caveats,
    dataGaps: output.dataGaps,
    nextTopics: output.nextTopics,
    sources: sourcesFrom(evidence),
    evidence,
    verification,
    ...(opts.movement ? { movement: opts.movement } : {}),
    ...(opts.charts ? { charts: opts.charts } : {}),
    disclosure: DISCLOSURE,
  };
}
