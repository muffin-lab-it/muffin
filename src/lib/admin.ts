/**
 * /admin 실행 로그 집계. 리더 관리.
 *
 * 데이터는 Supabase runs 표입니다 (docs/web-spec.md 4.3 · 4.7). 표가 연결되기 전(은경 db.ts · 마이그레이션, 서영 runs 저장)에는
 * loadRuns 가 예시 데이터를 돌려주고 화면 맨 위에 예시 데이터라고 표시합니다. 연결되면 loadRuns 안의 조회만 바꿉니다.
 */
import type { ToolStep } from "../agent/context";
import type { Verification } from "../agent/schema";
import { sampleRuns } from "./admin.sample";

const HOUR = 60 * 60_000;
/** 화면이 고를 수 있는 기간과 막대 한 칸의 길이 */
export const RANGES = {
  "24h": { label: "24시간", ms: 24 * HOUR, bucketMs: HOUR },
  "7d": { label: "7일", ms: 7 * 24 * HOUR, bucketMs: 6 * HOUR },
} as const;
export type RangeKey = keyof typeof RANGES;
export const DEFAULT_RANGE: RangeKey = "7d";
/** 리포트 하나의 시간 예산. src/agent/muffin.ts 의 TIME_BUDGET_MS(스트림 라우트 마감)와 같은 값입니다 */
export const BUDGET_MS = 55_000;
/** 이 시간이 지나도 started 로 남은 줄은 끝난 기록 없이 멈춘 요청으로 봅니다 (라우트 maxDuration 60초 + 여유) */
export const STALE_STARTED_MS = 2 * 60_000;
/** 이벤트 목록 길이 */
export const EVENT_LIMIT = 12;
/** 막대 칸 경계를 한국 시간(UTC+9) 정각에 맞춥니다 */
const KST_OFFSET = 9 * HOUR;

export function parseRange(value: string | string[] | undefined): RangeKey {
  return value === "24h" || value === "7d" ? value : DEFAULT_RANGE;
}

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
/** 막대 한 칸: start 부터 bucketMs 동안의 요청 */
export type Bucket = { start: string; ok: number; failed: number; limited: number; avgMs: number | null };
export type LatencyPoint = { at: string; ms: number; depth: string };
export type EventLevel = "bad" | "warn" | "info";
/** kind: agent(조사 중 오류) · started(중간에 멈춤) · input · config · limited(호출 제한) · tool(tool 실패, 리포트는 나감) */
export type AdminEvent = { id: string; at: string; level: EventLevel; kind: string; question: string; detail: string; tool?: string };

export type RunsSummary = {
  range: RangeKey;
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
  /** 시간 순 막대 (오래된 것부터). 마지막 칸이 지금을 포함합니다 */
  buckets: Bucket[];
  bucketMs: number;
  /** 리포트마다 응답 시간 점 */
  points: LatencyPoint[];
  /** 최신순 이벤트 */
  events: AdminEvent[];
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

const failureEvent: Record<string, { level: EventLevel; detail: string }> = {
  agent: { level: "bad", detail: "" },
  started: { level: "warn", detail: "시작만 기록되고 끝난 기록이 없습니다" },
  input: { level: "warn", detail: "" },
  config: { level: "bad", detail: "" },
};

/** 실행 로그 줄들을 화면 숫자로 모읍니다. now 기준 최근 range 기간만 봅니다. */
export function summarizeRuns(rows: RunRow[], now = new Date(), range: RangeKey = DEFAULT_RANGE): RunsSummary {
  const { ms: rangeMs, bucketMs } = RANGES[range];
  const until = now.getTime();
  const since = until - rangeMs;
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

  // 막대: 한국 시간 정각 경계로 자르고, 기간 시작이 첫 칸 안에 들어오도록 한 칸을 더 둡니다.
  const end = Math.floor((until + KST_OFFSET) / bucketMs) * bucketMs - KST_OFFSET + bucketMs;
  const count = Math.round(rangeMs / bucketMs) + 1;
  const start = end - count * bucketMs;
  const slots = Array.from({ length: count }, (_, i) => ({ start: start + i * bucketMs, ok: 0, failed: 0, limited: 0, ms: [] as number[] }));
  const slotOf = (r: RunRow) => slots[Math.min(count - 1, Math.max(0, Math.floor((Date.parse(r.at) - start) / bucketMs)))]!;
  for (const r of limited) slotOf(r).limited += 1;
  for (const r of served) slotOf(r)[r.ok ? "ok" : "failed"] += 1;
  for (const r of reports) slotOf(r).ms.push(r.ms);
  const buckets = slots.map((s) => ({
    start: new Date(s.start).toISOString(),
    ok: s.ok,
    failed: s.failed,
    limited: s.limited,
    avgMs: s.ms.length ? Math.round(s.ms.reduce((sum, v) => sum + v, 0) / s.ms.length) : null,
  }));

  const events: AdminEvent[] = [];
  for (const r of failed) {
    const kind = failureEvent[r.stage] ? r.stage : "agent";
    events.push({ id: r.id, at: r.at, level: failureEvent[kind]!.level, kind, question: clip(r.input?.question ?? "", 80), detail: clip(r.error ?? failureEvent[kind]!.detail, 160) });
  }
  for (const r of limited) events.push({ id: r.id, at: r.at, level: "info", kind: "limited", question: clip(r.input?.question ?? "", 80), detail: clip(r.error ?? "", 160) });
  for (const r of served) {
    (r.steps ?? []).forEach((step, k) => {
      if (step.status === "error") {
        events.push({ id: `${r.id}:${k}`, at: r.at, level: "warn", kind: "tool", tool: step.tool, question: clip(r.input?.question ?? "", 80), detail: clip(step.error ?? "", 160) });
      }
    });
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));

  return {
    range,
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
    buckets,
    bucketMs,
    points: reports.map((r) => ({ at: r.at, ms: r.ms, depth: r.input?.depth ?? "standard" })),
    events: events.slice(0, EVENT_LIMIT),
  };
}

export type Health = "ok" | "warn" | "bad" | "idle";
/** 상태 기준: [정상 이상, 주의 이상]. 이보다 나쁘면 장애입니다 */
export const THRESHOLDS = {
  success: [0.95, 0.85],
  /** p90 응답 시간: 45초 안이면 정상, 예산(55초) 안이면 주의 */
  p90Ms: [45_000, BUDGET_MS],
  pass: [0.9, 0.75],
  tool: [0.95, 0.85],
} as const;

const rank: Record<Health, number> = { idle: 0, ok: 1, warn: 2, bad: 3 };
const atLeast = (value: number | null, [ok, warn]: readonly [number, number]): Health =>
  value === null ? "idle" : value >= ok ? "ok" : value >= warn ? "warn" : "bad";
/** 기준값까지는 포함합니다 ("45초 안" = 45초 이하) */
const atMost = (value: number | null, [ok, warn]: readonly [number, number]): Health =>
  value === null ? "idle" : value <= ok ? "ok" : value <= warn ? "warn" : "bad";

/**
 * 화면의 상태등. 전체 상태는 성공률 · 응답 시간 · 권유 표현 중 가장 나쁜 것이고, 검증은 장애여도 전체를 주의까지만 올립니다
 * (리포트는 나가고 빠진 숫자는 화면에 드러나므로). tool 실패는 리포트가 나가므로 tool 상태등에만 표시합니다.
 */
export function healthOf(s: RunsSummary) {
  const success = atLeast(s.total ? s.ok / s.total : null, THRESHOLDS.success);
  const latency = atMost(s.time?.p90Ms ?? null, THRESHOLDS.p90Ms);
  const verification = atLeast(s.verification ? s.verification.pass / s.verification.checked : null, THRESHOLDS.pass);
  const advice: Health = s.verification ? (s.verification.advice === 0 ? "ok" : "bad") : "idle";
  const tools: Record<string, Health> = Object.fromEntries(s.tools.map((t) => [t.tool, atLeast(t.ok / t.calls, THRESHOLDS.tool)]));
  const overall = [success, latency, advice, verification === "bad" ? "warn" : verification].reduce<Health>(
    (worst, h) => (rank[h as Health] > rank[worst] ? (h as Health) : worst),
    "idle",
  );
  return { overall, success, latency, verification, advice, tools };
}

export type LoadedRuns = { source: "sample" | "runs"; rows: RunRow[] };

/** runs 표 연결 전에는 예시 데이터입니다. 연결되면 여기서 runs 의 최근 7일(가장 긴 기간)을 조회합니다. */
export async function loadRuns(now = new Date()): Promise<LoadedRuns> {
  return { source: "sample", rows: sampleRuns(now) };
}
