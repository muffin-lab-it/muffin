/**
 * /admin 실행 로그 집계. 리더 관리.
 *
 * 데이터는 Supabase runs 표입니다 (docs/web-spec.md 4.3 · 4.7). 표가 연결되기 전(은경 db.ts · 마이그레이션, 서영 runs 저장)에는
 * loadRuns 가 예시 데이터를 돌려주고 화면 맨 위에 예시 데이터라고 표시합니다. 연결되면 loadRuns 안의 조회만 바꿉니다.
 */
import type { ToolStep } from "../agent/context";
import type { Verification } from "../agent/schema";
import { sampleRuns } from "./admin.sample";

/** 화면이 보는 기간(일) */
export const WINDOW_DAYS = 7;
/** 이 시간이 지나도 started 로 남은 줄은 끝난 기록 없이 멈춘 요청으로 봅니다 (라우트 maxDuration 60초 + 여유) */
export const STALE_STARTED_MS = 2 * 60_000;
/** 최근 실패 목록 길이 */
export const FAILURE_LIMIT = 10;

/** runs 표 한 줄. 칸 이름은 표 그대로입니다. client_id · ip_hash 는 화면에 쓰지 않아 뺐습니다. */
export type RunRow = {
  id: string;
  at: string;
  ok: boolean;
  /** started | input | config | limited | agent | ok */
  stage: string;
  mock: boolean;
  input?: { question: string; depth: string; area?: string } | null;
  ms: number;
  model?: string | null;
  usage?: { requests: number; inputTokens: number; outputTokens: number } | null;
  steps?: ToolStep[] | null;
  rewrites?: number | null;
  verification?: Pick<Verification, "status" | "numbers" | "advice" | "revisions"> | null;
  intent?: string | null;
  error?: string | null;
};

export type TimeStat = { count: number; avgMs: number; p90Ms: number };
export type ToolStat = { tool: string; calls: number; ok: number; avgMs: number };
export type FailureRow = { id: string; at: string; stage: string; question: string; error: string };

export type RunsSummary = {
  since: string;
  until: string;
  /** 기간 안의 요청. Mock · 진행 중 · 호출 제한은 뺀 수 */
  total: number;
  ok: number;
  failed: number;
  /** 호출 제한으로 막힌 요청. 성공률에서 뺍니다 */
  limited: number;
  /** Mock 요청(MUFFIN_MOCK). 모든 숫자에서 뺍니다 */
  mock: number;
  /** 리포트를 만든 요청(성공, 범위 밖 제외)의 응답 시간 */
  time: TimeStat | null;
  byDepth: ({ depth: string } & TimeStat)[];
  /** 리포트를 만든 요청당 평균 토큰 */
  tokens: { input: number; output: number } | null;
  /** 리포트를 만든 요청 중 숫자 검증을 거친 것 (skipped 제외) */
  verification: { checked: number; pass: number; rewritten: number; numbers: number; unverified: number; advice: number } | null;
  intents: { intent: string; count: number }[];
  tools: ToolStat[];
  failures: FailureRow[];
};

const DEPTHS = ["easy", "standard", "deep"];

function timeStat(values: number[]): TimeStat | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const avgMs = Math.round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length);
  return { count: sorted.length, avgMs, p90Ms: sorted[Math.ceil(sorted.length * 0.9) - 1]! };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 실행 로그 줄들을 화면 숫자로 모읍니다. now 기준 최근 days 일만 봅니다. */
export function summarizeRuns(rows: RunRow[], now = new Date(), days = WINDOW_DAYS): RunsSummary {
  const until = now.getTime();
  const since = until - days * 24 * 60 * 60_000;
  const inWindow = rows.filter((r) => {
    const t = Date.parse(r.at);
    return t >= since && t <= until;
  });
  const real = inWindow.filter((r) => !r.mock);
  // started 로 남은 줄: 2분이 지났으면 끝난 기록 없이 멈춘 요청(실패), 아니면 아직 진행 중이라 뺍니다.
  const counted = real.filter((r) => r.stage !== "started" || until - Date.parse(r.at) > STALE_STARTED_MS);
  const limited = counted.filter((r) => r.stage === "limited");
  const served = counted.filter((r) => r.stage !== "limited");
  const ok = served.filter((r) => r.ok);
  const failed = served.filter((r) => !r.ok);
  // 범위 밖 질문은 분류만 하고 2초 안에 끝나서 리포트 시간 · 토큰 · 검증 숫자를 흐립니다. 리포트를 만든 요청만 봅니다.
  const reports = ok.filter((r) => r.intent !== "out_of_scope");

  const byDepth = DEPTHS.flatMap((depth) => {
    const stat = timeStat(reports.filter((r) => r.input?.depth === depth).map((r) => r.ms));
    return stat ? [{ depth, ...stat }] : [];
  });

  const usages = reports.flatMap((r) => (r.usage ? [r.usage] : []));
  const tokens = usages.length
    ? {
        input: Math.round(usages.reduce((sum, u) => sum + u.inputTokens, 0) / usages.length),
        output: Math.round(usages.reduce((sum, u) => sum + u.outputTokens, 0) / usages.length),
      }
    : null;

  const checked = reports.filter((r) => r.verification && r.verification.status !== "skipped");
  const verification = checked.length
    ? {
        checked: checked.length,
        pass: checked.filter((r) => r.verification!.status === "pass").length,
        rewritten: checked.filter((r) => (r.verification!.revisions ?? r.rewrites ?? 0) > 0).length,
        numbers: checked.reduce((sum, r) => sum + r.verification!.numbers.total, 0),
        unverified: checked.reduce((sum, r) => sum + r.verification!.numbers.unverified, 0),
        advice: checked.reduce((sum, r) => sum + r.verification!.advice, 0),
      }
    : null;

  const intentCounts = new Map<string, number>();
  for (const r of served) if (r.intent) intentCounts.set(r.intent, (intentCounts.get(r.intent) ?? 0) + 1);
  const intents = [...intentCounts].map(([intent, count]) => ({ intent, count })).sort((a, b) => b.count - a.count || a.intent.localeCompare(b.intent));

  const toolCalls = new Map<string, { calls: number; ok: number; ms: number }>();
  for (const step of served.flatMap((r) => r.steps ?? [])) {
    const t = toolCalls.get(step.tool) ?? { calls: 0, ok: 0, ms: 0 };
    t.calls += 1;
    t.ok += step.status === "ok" ? 1 : 0;
    t.ms += step.ms;
    toolCalls.set(step.tool, t);
  }
  const tools = [...toolCalls]
    .map(([tool, t]) => ({ tool, calls: t.calls, ok: t.ok, avgMs: Math.round(t.ms / t.calls) }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

  const failures = [...failed]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, FAILURE_LIMIT)
    .map((r) => ({
      id: r.id,
      at: r.at,
      stage: r.stage,
      question: clip(r.input?.question ?? "", 80),
      error: clip(r.error ?? (r.stage === "started" ? "시작만 기록되고 끝난 기록이 없습니다" : ""), 160),
    }));

  return {
    since: new Date(since).toISOString(),
    until: now.toISOString(),
    total: served.length,
    ok: ok.length,
    failed: failed.length,
    limited: limited.length,
    mock: inWindow.length - real.length,
    time: timeStat(reports.map((r) => r.ms)),
    byDepth,
    tokens,
    verification,
    intents,
    tools,
    failures,
  };
}

export type LoadedRuns = { source: "sample" | "runs"; rows: RunRow[] };

/** runs 표 연결 전에는 예시 데이터입니다. 연결되면 여기서 runs 의 최근 WINDOW_DAYS 일을 조회합니다. */
export async function loadRuns(now = new Date()): Promise<LoadedRuns> {
  return { source: "sample", rows: sampleRuns(now) };
}
