import type { Evidence, NumberCheck, Report, ReportMode, Verification, WriterOutput } from "./schema";

/** AI 생성 고지 (AI 기본법). 리포트 상단과 History 에 같이 남습니다. */
export const DISCLOSURE = "이 리포트는 생성형 AI 가 작성했습니다. 투자 권유가 아니며, 판단은 사용자에게 있습니다.";

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
export function assembleReport(
  output: WriterOutput,
  evidence: Evidence[],
  verification: Verification,
  opts: {
    mode?: ReportMode;
    notice?: string;
    checks?: NumberCheck[];
    movement?: Report["movement"];
    charts?: Report["charts"];
  } = {},
): Report {
  return {
    version: 2,
    mode: opts.mode ?? "research",
    ...(opts.notice ? { notice: opts.notice } : {}),
    summary: output.summary,
    numbers: output.numbers.map((n, i) => ({ ...n, check: opts.checks?.[i] ?? "unverified" })),
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
