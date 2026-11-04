/**
 * Promptfoo 결과(-o 로 쓴 JSON)를 사람이 읽는 요약으로 (리더). 지표별 통과율을 기준(promptfooconfig.yaml 의 metadata.thresholds)과
 * 지난 번 결과(baseline)와 나란히 보여 주고, 기준 아래로 떨어진 지표를 돌려줍니다. run.ts 가 부르고, 테스트는 promptfoo.test.ts.
 */
import { metricLabels, type Metric } from "./asserts";

/** promptfoo 출력 JSON 중 쓰는 부분만 (0.125 기준) */
export type PromptfooComponent = { pass: boolean; score: number; reason: string; assertion?: { type: string; metric?: string } };
export type PromptfooRow = {
  success: boolean;
  latencyMs?: number;
  /** 0 없음 · 1 채점 실패 · 2 오류(provider 가 error 를 돌려줌). 채점 실패도 error 칸에 이유가 적히므로 오류 판단은 이 값으로 */
  failureReason?: number;
  error?: string | null;
  vars?: Record<string, unknown>;
  testCase?: { description?: string };
  /** output 은 provider.ts 의 EvalOutput. 여기서는 모델 이름만 봅니다 */
  response?: { error?: string; output?: { model?: string } | null };
  tokenUsage?: { total?: number; prompt?: number; completion?: number };
  gradingResult?: { pass: boolean; componentResults?: PromptfooComponent[] } | null;
};
export type PromptfooOutput = {
  evalId?: string;
  config?: { metadata?: { thresholds?: Partial<Record<string, number>> } };
  results: { timestamp?: string; stats?: { successes: number; failures: number; errors: number }; results: PromptfooRow[] };
};

export const metricOrder: Metric[] = ["intent", "tools", "numbers", "refs", "why", "judge", "advice", "verification", "rewrites", "latency"];

/** promptfooconfig.yaml 에 metadata.thresholds 가 없을 때 쓰는 값. 설정 파일이 기준의 원본입니다. */
export const defaultThresholds: Record<Metric, number> = {
  intent: 0.8,
  tools: 0.8,
  numbers: 0.8,
  refs: 1,
  why: 0.8,
  judge: 0.8,
  advice: 1,
  verification: 0.8,
  rewrites: 0.6,
  latency: 0.7,
};

export type MetricRate = { pass: number; total: number; rate: number | null };
export type Failed = { metric: Metric; rate: number; threshold: number };
export type Summary = { markdown: string; failed: Failed[]; errors: number; questions: number; rates: Record<Metric, MetricRate> };

const isMetric = (m: string | undefined): m is Metric => !!m && m in metricLabels;
const pct = (r: number | null) => (r === null ? "-" : `${Math.round(r * 100)}%`);
const delta = (now: number | null, before: number | null) => {
  if (now === null || before === null) return "-";
  const d = Math.round((now - before) * 100);
  return d === 0 ? "±0p" : `${d > 0 ? "+" : ""}${d}p`;
};
/** provider 가 error 를 돌려준 행(failureReason 2) 이나 채점 결과가 없는 행. 지표를 세지 않고 오류로 적습니다. 채점 실패(1)는 오류가 아닙니다 */
const rowError = (row: PromptfooRow): string | undefined => {
  if (row.failureReason === 2) return row.response?.error ?? row.error ?? "오류";
  if (!row.gradingResult) return row.response?.error ?? row.error ?? "결과 없음";
  return undefined;
};
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");
const idOf = (row: PromptfooRow) => String(row.vars?.id ?? row.testCase?.description ?? "?");

/** 지표마다 통과 수 / 전체 수. 오류 행은 세지 않습니다 */
export function metricRates(out: PromptfooOutput): Record<Metric, MetricRate> {
  const rates = Object.fromEntries(metricOrder.map((m) => [m, { pass: 0, total: 0, rate: null }])) as Record<Metric, MetricRate>;
  for (const row of out.results.results) {
    for (const c of row.gradingResult?.componentResults ?? []) {
      const m = c.assertion?.metric;
      if (!isMetric(m)) continue;
      rates[m].total += 1;
      if (c.pass) rates[m].pass += 1;
    }
  }
  for (const m of metricOrder) rates[m].rate = rates[m].total ? rates[m].pass / rates[m].total : null;
  return rates;
}

export function thresholdsOf(out: PromptfooOutput): Record<Metric, number> {
  const given = out.config?.metadata?.thresholds ?? {};
  return Object.fromEntries(metricOrder.map((m) => [m, typeof given[m] === "number" ? given[m] : defaultThresholds[m]])) as Record<Metric, number>;
}

/** 비교할 때 같이 보는 것: 쓴 모델(작성 단계, 깊이마다 다를 수 있음)과 토큰 합계 */
function usageLine(rows: PromptfooRow[]): string {
  const models = [...new Set(rows.map((r) => r.response?.output?.model).filter((m): m is string => !!m))];
  const prompt = rows.reduce((s, r) => s + (r.tokenUsage?.prompt ?? 0), 0);
  const completion = rows.reduce((s, r) => s + (r.tokenUsage?.completion ?? 0), 0);
  const parts = [models.length ? `모델 ${models.join(" · ")}` : "", prompt + completion ? `토큰 입력 ${prompt.toLocaleString("en-US")} · 출력 ${completion.toLocaleString("en-US")}` : ""].filter(Boolean);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

export type SummarizeOptions = { baseline?: PromptfooOutput; title?: string; /** "지난 번" 열의 이름. 모델 비교처럼 특정 결과와 비교할 때 그 이름 */ baselineLabel?: string };

export function summarize(out: PromptfooOutput, { baseline, title = "리포트 평가 (Promptfoo)", baselineLabel = "지난 번" }: SummarizeOptions = {}): Summary {
  const rows = out.results.results;
  const rates = metricRates(out);
  const thresholds = thresholdsOf(out);
  const base = baseline ? metricRates(baseline) : null;
  const failed: Failed[] = metricOrder
    .filter((m) => rates[m].rate !== null && rates[m].rate! < thresholds[m])
    .map((m) => ({ metric: m, rate: rates[m].rate!, threshold: thresholds[m] }));
  const errorRows = rows.filter((r) => rowError(r) !== undefined);
  const stamp = out.results.timestamp ? out.results.timestamp.slice(0, 16).replace("T", " ") : "";
  const avgSec = rows.length ? (rows.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / rows.length / 1000).toFixed(1) : "0";

  const shown = metricOrder.filter((m) => rates[m].total > 0 || (base !== null && base[m].total > 0));
  const metricTable = [
    `| 지표 | 통과 | 통과율 | 기준 | ${baselineLabel} | 상태 |`,
    `|---|---|---|---|---|---|`,
    ...shown.map((m) => {
      const r = rates[m];
      const status = r.rate === null ? "-" : r.rate >= thresholds[m] ? "✅" : "❌";
      const before = base ? `${pct(base[m].rate)} (${delta(r.rate, base[m].rate)})` : "-";
      return `| ${metricLabels[m]} | ${r.pass}/${r.total} | ${pct(r.rate)} | ${pct(thresholds[m])} | ${before} | ${status} |`;
    }),
  ];

  const used = metricOrder.filter((m) => rates[m].total > 0);
  const questionTable = [
    `| 질문 | 깊이 | ${used.map((m) => metricLabels[m]).join(" | ")} | 시간 |`,
    `|---|---|${used.map(() => "---").join("|")}|---|`,
    ...rows.map((row) => {
      const depth = String(row.vars?.depth ?? "-");
      const err = rowError(row);
      if (err !== undefined) return `| ${idOf(row)} | ${depth} | ${used.map(() => "오류").join(" | ")} | ${cell(err).slice(0, 80)} |`;
      const byMetric = new Map((row.gradingResult?.componentResults ?? []).map((c) => [c.assertion?.metric, c]));
      const marks = used.map((m) => {
        const c = byMetric.get(m);
        return c ? (c.pass ? "✓" : "✗") : "-";
      });
      return `| ${idOf(row)} | ${depth} | ${marks.join(" | ")} | ${((row.latencyMs ?? 0) / 1000).toFixed(1)}s |`;
    }),
  ];

  const failures: string[] = [];
  for (const row of rows) {
    const err = rowError(row);
    if (err !== undefined) {
      failures.push(`- ${idOf(row)}: 오류 — ${cell(err).slice(0, 200)}`);
      continue;
    }
    for (const c of row.gradingResult?.componentResults ?? []) {
      if (c.pass) continue;
      const m = c.assertion?.metric;
      failures.push(`- ${idOf(row)} · ${isMetric(m) ? metricLabels[m] : (m ?? c.assertion?.type ?? "?")}: ${cell(c.reason).slice(0, 200)}`);
    }
  }

  const headline = failed.length
    ? `❌ 기준 아래 지표 ${failed.length}개: ${failed.map((f) => `${metricLabels[f.metric]} ${pct(f.rate)} < ${pct(f.threshold)}`).join(", ")}`
    : errorRows.length
      ? `⚠️ 지표는 모두 기준 안이지만 오류 ${errorRows.length}건`
      : "✅ 모든 지표가 기준 안";

  const markdown = [
    `# ${title} ${stamp}`.trim(),
    "",
    headline,
    "",
    `질문 ${rows.length}개 (오류 ${errorRows.length}), 리포트 평균 ${avgSec}초${usageLine(rows)}${baseline ? `, ${baselineLabel}과 비교${baseline.results.results.length ? ` (평균 ${(baseline.results.results.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / baseline.results.results.length / 1000).toFixed(1)}초${usageLine(baseline.results.results)})` : ""}` : ""}`,
    "",
    "## 지표별 통과율",
    "",
    ...metricTable,
    "",
    "## 질문별",
    "",
    ...questionTable,
    "",
    "## 틀린 것",
    "",
    ...(failures.length ? failures : ["- (없음)"]),
    "",
  ].join("\n");
  return { markdown, failed, errors: errorRows.length, questions: rows.length, rates };
}
