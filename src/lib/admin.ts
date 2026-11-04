/**
 * /admin 실행 로그 집계. 리더 관리.
 *
 * 데이터는 Supabase runs 표입니다 (docs/web-spec.md 4.3 · 4.7). loadRuns 가 최근 7일을 읽고(1000줄씩, 최대 10쪽),
 * Supabase 환경 변수가 없거나 화면이 `?source=sample` 로 요청하면 예시 데이터를 돌려주며 화면 맨 위에 그렇게 표시합니다.
 * 줄은 서영의 실행 로그 저장(4.4)이 넣습니다. 그 전에는 표가 비어 있어 "기록 없음" 으로 보입니다.
 */
import type { ToolStep } from "../agent/context";
import type { Verification } from "../agent/schema";
import { formatAge } from "./age";
import { sampleRuns } from "./admin.sample";
import { dbEnabled, getDb } from "./db";

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
export type ToolStat = {
  tool: string;
  calls: number;
  /** 리포트가 데이터를 받은 호출 (저장 응답으로 나간 것 포함) */
  ok: number;
  /** 외부 API 가 실제로 답한 호출 (저장 응답 제외). tool 상태등은 이것으로 */
  live: number;
  /** 조회가 실패해 저장 응답(tool_cache)으로 나간 호출 */
  fallbacks: number;
  /** 회로 차단기가 열려 외부 호출을 건너뛴 호출 */
  skipped: number;
  avgMs: number;
  /** 마지막으로 외부 조회가 실패한 시각과 사유 (저장 응답으로 나간 것 포함) */
  lastFailAt?: string;
  lastFail?: string;
};
/** 짧은 기간의 실측: 상용 AI 상태 페이지와 나란히 보는 "우리 쪽 헬시값" */
export type WindowStat = { total: number; ok: number; avgMs: number | null };
/** 막대 한 칸: start 부터 bucketMs 동안의 요청 */
export type Bucket = { start: string; ok: number; failed: number; limited: number; avgMs: number | null };
export type LatencyPoint = { at: string; ms: number; depth: string };
export type EventLevel = "bad" | "warn" | "info";
/** kind: agent(조사 중 오류) · started(중간에 멈춤) · input · config · limited(호출 제한) · tool(tool 실패, 리포트는 나감) · cache(조회 실패로 저장된 응답 사용) */
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
/**
 * 기간 안의 요청을 셈할 수 있는 것만 고릅니다. Mock 은 빼고, started 로 남은 줄은 2분이 지났으면 끝난 기록 없이 멈춘 요청(실패),
 * 아니면 아직 진행 중이라 뺍니다. 호출 제한(limited)은 따로 돌려줍니다.
 */
function countable(rows: RunRow[], since: number, until: number): { limited: RunRow[]; served: RunRow[] } {
  const counted = rows.filter((r) => {
    const t = Date.parse(r.at);
    return t >= since && t <= until && !r.mock && (r.stage !== "started" || until - t > STALE_STARTED_MS);
  });
  return { limited: counted.filter((r) => r.stage === "limited"), served: counted.filter((r) => r.stage !== "limited") };
}

/** 최근 ms 동안의 요청 수 · 성공 · 리포트 평균 응답 (범위 밖 제외). 상용 AI 상태 옆에 두는 실측입니다 */
export function windowStats(rows: RunRow[], now = new Date(), ms = HOUR): WindowStat {
  const until = now.getTime();
  const { served } = countable(rows, until - ms, until);
  const ok = served.filter((r) => r.ok);
  const stat = timeStat(ok.filter((r) => r.intent !== "out_of_scope").map((r) => r.ms));
  return { total: served.length, ok: ok.length, avgMs: stat?.avgMs ?? null };
}

export function summarizeRuns(rows: RunRow[], now = new Date(), range: RangeKey = DEFAULT_RANGE): RunsSummary {
  const { ms: rangeMs, bucketMs } = RANGES[range];
  const until = now.getTime();
  const since = until - rangeMs;
  const inWindow = rows.filter((r) => {
    const t = Date.parse(r.at);
    return t >= since && t <= until;
  });
  const real = inWindow.filter((r) => !r.mock);
  const { limited, served } = countable(rows, since, until);
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

  const toolCalls = new Map<string, { calls: number; ok: number; live: number; fallbacks: number; skipped: number; ms: number; lastFailAt?: string; lastFail?: string }>();
  for (const r of served) {
    for (const step of r.steps ?? []) {
      const t = toolCalls.get(step.tool) ?? { calls: 0, ok: 0, live: 0, fallbacks: 0, skipped: 0, ms: 0 };
      const fallback = step.fallbackAgeMs !== undefined;
      t.calls += 1;
      t.ok += step.status === "ok" ? 1 : 0;
      t.live += step.status === "ok" && !fallback ? 1 : 0;
      t.fallbacks += fallback ? 1 : 0;
      t.skipped += step.breaker === "open" ? 1 : 0;
      t.ms += step.ms;
      // 실패 = 외부 조회를 해 봤는데 안 된 것. 저장 응답으로 리포트가 나갔어도 API 쪽은 실패입니다.
      // 회로가 열려 건너뛴 호출은 외부를 부르지 않았으므로 "마지막 실패" 시각을 옮기지 않습니다 (언제 실제로 실패했는지가 남게)
      if ((step.status === "error" || fallback) && step.breaker !== "open" && (!t.lastFailAt || r.at > t.lastFailAt)) {
        t.lastFailAt = r.at;
        t.lastFail = step.status === "error" ? (step.error ?? "실패") : `조회 실패 · ${formatAge(step.fallbackAgeMs ?? 0)} 전 저장 응답 사용`;
      }
      toolCalls.set(step.tool, t);
    }
  }
  const tools: ToolStat[] = [...toolCalls]
    .map(([tool, t]) => ({
      tool,
      calls: t.calls,
      ok: t.ok,
      live: t.live,
      fallbacks: t.fallbacks,
      skipped: t.skipped,
      avgMs: Math.round(t.ms / t.calls),
      ...(t.lastFailAt ? { lastFailAt: t.lastFailAt, lastFail: t.lastFail } : {}),
    }))
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
      } else if (step.fallbackAgeMs !== undefined) {
        // 조회는 실패했지만 저장된 응답으로 리포트가 나간 경우. 외부 API 상태를 보는 신호라 정보로 남깁니다.
        events.push({ id: `${r.id}:${k}`, at: r.at, level: "info", kind: "cache", tool: step.tool, question: clip(r.input?.question ?? "", 80), detail: `${step.breaker === "open" ? "회로 열림(호출 생략)" : "조회 실패"} · ${formatAge(step.fallbackAgeMs)} 전 응답 사용` });
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
  // tool 상태등은 외부 API 가 실제로 답한 비율입니다. 저장 응답으로 리포트가 나갔어도 API 는 실패한 것이라 넣지 않습니다
  const tools: Record<string, Health> = Object.fromEntries(s.tools.map((t) => [t.tool, atLeast(t.live / t.calls, THRESHOLDS.tool)]));
  const overall = [success, latency, advice, verification === "bad" ? "warn" : verification].reduce<Health>(
    (worst, h) => (rank[h as Health] > rank[worst] ? (h as Health) : worst),
    "idle",
  );
  return { overall, success, latency, verification, advice, tools };
}

export type LoadedRuns =
  /** 예시 데이터. no-db 는 Supabase 환경 변수가 없는 것, requested 는 화면이 `?source=sample` 로 요청한 것 */
  | { source: "sample"; reason: "no-db" | "requested"; rows: RunRow[] }
  /** runs 표. truncated 는 최근 7일 기록이 PAGE × MAX_PAGES 를 넘어 최신 것만 읽은 것 */
  | { source: "runs"; rows: RunRow[]; truncated: boolean };

/** runs 표에서 읽는 칸. client_id · ip_hash 는 화면에 쓰지 않아 읽지 않습니다 */
export const RUN_COLUMNS = "id, at, ok, stage, mock, input, ms, model, usage, steps, rewrites, verification, intent, error";
/** 한 번에 읽는 줄 수 (Supabase 의 요청당 상한 1000). 7일치가 더 많으면 이어서 읽습니다 */
export const PAGE = 1000;
export const MAX_PAGES = 10;

/** PostgREST 필터 값. 점 · 쉼표 · 괄호가 들어가는 값(시각 · id)은 따옴표로 감싸야 합니다 */
const quote = (value: string) => `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;

/**
 * runs 표의 최근 7일(가장 긴 기간)을 최신순으로 읽습니다. 기간 나누기는 summarizeRuns 가 합니다.
 * 쪽 넘김은 줄 번호(offset)가 아니라 마지막 줄의 (시각, id) 뒤부터입니다. 읽는 중에 새 요청이 들어와도 같은 줄을 두 번 세거나 건너뛰지 않게
 * 하려는 것이고, 끝 시각은 now 로 고정합니다. 상한(MAX_PAGES)까지 꽉 찼으면 한 줄을 더 읽어 정말 더 있는지 확인한 뒤에만 truncated 입니다.
 * Supabase 환경 변수가 없으면 예시 데이터이고, 화면이 예시를 요청해도(스크린샷 · 시연 연습) 예시입니다. 조회 오류는 throw 해 화면이 알립니다.
 */
export async function loadRuns(now = new Date(), { source }: { source?: "sample" } = {}): Promise<LoadedRuns> {
  if (source === "sample") return { source: "sample", reason: "requested", rows: sampleRuns(now) };
  if (!dbEnabled()) return { source: "sample", reason: "no-db", rows: sampleRuns(now) };
  const since = new Date(now.getTime() - RANGES["7d"].ms).toISOString();
  const until = now.toISOString();
  const db = getDb();
  // after 가 있으면 그 줄 뒤부터: 시각이 더 이르거나, 같은 시각이면 id 가 더 작은 줄 (정렬과 같은 순서)
  const fetchPage = (after: RunRow | undefined, limit: number) => {
    let q = db.from("runs").select(RUN_COLUMNS).gte("at", since).lte("at", until);
    if (after) q = q.or(`at.lt.${quote(after.at)},and(at.eq.${quote(after.at)},id.lt.${quote(after.id)})`);
    return q.order("at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  };
  const rows: RunRow[] = [];
  let last: RunRow | undefined;
  let full = false;
  for (let n = 0; n < MAX_PAGES; n++) {
    const { data, error } = await fetchPage(last, PAGE);
    if (error) throw new Error(`runs 표 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    full = (data?.length ?? 0) === PAGE;
    if (!full) break;
    last = data![data!.length - 1]!;
  }
  let truncated = false;
  if (full) {
    const { data, error } = await fetchPage(last, 1);
    if (error) throw new Error(`runs 표 조회 실패: ${error.message}`);
    truncated = (data?.length ?? 0) > 0;
  }
  return { source: "runs", rows, truncated };
}
