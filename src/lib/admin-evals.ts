/**
 * /admin 품질 평가 패널의 데이터. 리더 관리.
 * scripts/promptfoo/run.ts 가 평가 한 번마다 evals 표에 넣은 요약(지표별 통과율 · 기준 · 미달 지표 · 시간 · 모델)을 읽습니다.
 * 주간 평가(Action 에서 전체 세트를 기본 설정으로 돌린 것: tag · set_name 없음)가 본 줄이고 따로 읽습니다 — 로컬 · 실험 실행이 많아도
 * 최근 기록에 밀려 사라지지 않게. 세트 일부 · 깊이 · 모델을 바꾼 실행은 실험 이름(tag)이 붙어 기록으로만 보입니다.
 */
import { dbEnabled, getDb, type Tables } from "./db";
import { isMetric, metricLabels, metricOrder, type Metric } from "./eval-metrics";

export type EvalRow = Tables<"evals">;
/** 읽는 줄 수 (최신순). 주간 평가라면 석 달치입니다 */
export const EVAL_LIMIT = 12;

export type LoadedEvals =
  /** Supabase 환경 변수가 없음 */
  | { source: "none"; weekly: EvalRow[]; rows: EvalRow[] }
  /** 읽었음. error 는 표가 없거나(마이그레이션 전) 조회가 실패한 것 — 화면에 안내하고 나머지는 그대로 그립니다 */
  | { source: "evals"; weekly: EvalRow[]; rows: EvalRow[]; error?: string };

export async function loadEvals(limit = EVAL_LIMIT): Promise<LoadedEvals> {
  if (!dbEnabled()) return { source: "none", weekly: [], rows: [] };
  // 클라이언트 만들기 · 조회가 throw 해도(환경 변수 모양 오류, 네트워크) 패널 안 안내문으로 그치고 화면 나머지는 그대로 그립니다
  try {
    const db = getDb();
    const [weekly, history] = await Promise.all([
      db.from("evals").select("*").eq("source", "ci").is("tag", null).is("set_name", null).order("at", { ascending: false }).limit(limit),
      db.from("evals").select("*").order("at", { ascending: false }).limit(limit),
    ]);
    const error = weekly.error ?? history.error;
    if (error) return { source: "evals", weekly: [], rows: [], error: error.message };
    return { source: "evals", weekly: weekly.data ?? [], rows: history.data ?? [] };
  } catch (err) {
    return { source: "evals", weekly: [], rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export type MetricLine = { metric: Metric; label: string; pass: number; total: number; rate: number | null; threshold: number | null; ok: boolean | null };

/** 지표 표 한 줄씩, 표 순서대로. 재지 않은 지표는 뺍니다 */
export function metricLines(row: EvalRow): MetricLine[] {
  return metricOrder.flatMap((metric) => {
    const r = row.rates[metric];
    if (!r || !r.total) return [];
    const threshold = typeof row.thresholds[metric] === "number" ? row.thresholds[metric]! : null;
    const ok = r.rate === null || threshold === null ? null : r.rate >= threshold;
    return [{ metric, label: metricLabels[metric], pass: r.pass, total: r.total, rate: r.rate, threshold, ok }];
  });
}

/** 기준 안에 든 지표 수 / 기준이 있는 지표 수. 추이 선에 씁니다 */
export function withinRatio(row: EvalRow): number | null {
  const lines = metricLines(row).filter((l) => l.ok !== null);
  return lines.length ? lines.filter((l) => l.ok).length / lines.length : null;
}

/** 미달 지표 이름들 (화면 문구용). 모르는 지표 이름은 그대로 둡니다 */
export function failedLabels(row: EvalRow): string[] {
  return row.failed.map((f) => (isMetric(f.metric) ? metricLabels[f.metric] : f.metric));
}
