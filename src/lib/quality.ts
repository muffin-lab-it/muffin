/**
 * /quality (심사용 공개 페이지)의 데이터 모양과 고정 숫자. 리더 관리.
 * 비밀번호 없이 읽는 페이지라 집계 숫자만 내보냅니다. 질문 원문 · 오류 문구 · 모델 응답은 넣지 않습니다.
 *  - 주간 평가: evals 표의 주간 줄(Action · 전체 세트)을 시간순으로 (src/lib/admin-evals.ts)
 *  - 운영: runs 표 최근 7일 집계 (src/lib/admin.ts summarizeRuns)
 *  - 고정 숫자: 기준선 실측 · 테스트 · PR · Codex. 손으로 갱신하며 asOf 를 같이 적습니다.
 */
import { loadRuns, summarizeRuns, type RunsSummary } from "./admin";
import { loadEvals, metricLines, type EvalRow } from "./admin-evals";
import type { Cost } from "./pricing";

export const QUALITY_FACTS = {
  asOf: "2026-11-17",
  tests: 946,
  mergedPrs: 102,
  codexReviewedPrs: 61,
  codexFindingsFixed: 23,
  judgePairs: 98,
  judgeAccuracy: 95.9,
  /** scripts/baseline 11/5 실측: 같은 12문항을 같은 모델에 tool · 장부 · 검증 없이 물은 답과 비교 (docs/eval/baseline) */
  baselineAsOf: "2026-11-05",
  baselineQuestions: 12,
  baseline: [
    { label: "근거 장부로 확인된 숫자 카드", without: "0% (장부 없음)", muffin: "100% (34/34)" },
    { label: "가장 최근 기준일 (중앙값)", without: "561.5일 전", muffin: "2일 전" },
    { label: "출처 링크가 열리는 비율", without: "97%", muffin: "100%" },
    { label: "투자 권유 문장", without: "1건", muffin: "0건" },
    { label: "응답 시간 (평균)", without: "12.7초", muffin: "23.3초" },
  ],
} as const;

export type WeeklyMetric = { label: string; pass: number; total: number; rate: number | null; threshold: number | null; ok: boolean | null };
export type WeeklyPoint = { at: string; questions: number; errors: number; avgMs: number | null; metrics: WeeklyMetric[]; allOk: boolean | null; runUrl: string | null };

/** 주간 평가 줄을 오래된 것부터. 지표는 metricLines 순서 */
export function weeklyPoints(rows: EvalRow[]): WeeklyPoint[] {
  return [...rows]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((row) => {
      const metrics = metricLines(row).map(({ label, pass, total, rate, threshold, ok }) => ({ label, pass, total, rate, threshold, ok }));
      const judged = metrics.filter((m) => m.ok !== null);
      return {
        at: row.at,
        questions: row.questions,
        errors: row.errors,
        avgMs: row.avg_ms,
        metrics,
        allOk: judged.length ? judged.every((m) => m.ok) : null,
        runUrl: row.run_url,
      };
    });
}

export type OpsPoint = {
  since: string;
  until: string;
  reports: number;
  successRate: number | null;
  p90Ms: number | null;
  avgMs: number | null;
  cost: Cost | null;
  /** 7일치가 한 번에 읽는 상한을 넘어 최신 기록만 집계한 것 (loadRuns 의 truncated). 화면에 밝힙니다 */
  truncated: boolean;
};

/** 최근 7일 운영 집계 중 공개해도 되는 것만 */
export function opsPoint(s: RunsSummary, truncated = false): OpsPoint {
  return {
    since: s.since,
    until: s.until,
    reports: s.time?.count ?? 0,
    successRate: s.total ? s.ok / s.total : null,
    p90Ms: s.time?.p90Ms ?? null,
    avgMs: s.time?.avgMs ?? null,
    cost: s.cost?.avg ?? null,
    truncated,
  };
}

export type QualityData = { weekly: WeeklyPoint[]; ops: OpsPoint | null; generatedAt: string };

/** 공개 페이지라 요청마다 DB 를 읽지 않게, 인스턴스 안에서 한 시간 동안 같은 결과를 돌려줍니다 (getDb 의 fetch 는 no-store 라 페이지 revalidate 로는 안 묶임 — Codex 리뷰) */
export const QUALITY_TTL_MS = 60 * 60 * 1000;
let cached: { at: number; data: QualityData } | undefined;

export async function loadQuality(now = new Date()): Promise<QualityData> {
  if (cached && now.getTime() - cached.at < QUALITY_TTL_MS) return cached.data;
  // 둘 중 하나가 실패해도 나머지는 그대로 그립니다 (DB 가 멈춰 있어도 고정 숫자와 안내는 보이게)
  const [evals, runs] = await Promise.all([loadEvals().catch(() => null), loadRuns(now).catch(() => null)]);
  const weekly = evals ? weeklyPoints(evals.weekly) : [];
  // DB 환경 변수가 없으면 loadRuns 는 예시 데이터를 돌려줍니다 (/admin 연습용). 공개 페이지에 예시 숫자를 운영 실적처럼 내보내지 않습니다 (Codex 리뷰)
  const ops = runs && runs.source === "runs" ? opsPoint(summarizeRuns(runs.rows, now, "7d"), runs.truncated) : null;
  const data = { weekly, ops, generatedAt: now.toISOString() };
  cached = { at: now.getTime(), data };
  return data;
}

/** 테스트용 */
export function resetQualityCache(): void {
  cached = undefined;
}
