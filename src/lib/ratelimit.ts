import { createHash } from "node:crypto";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;

// v1 limitation: this in-memory Map is local to a single server instance.
// Limits are not shared across Vercel instances and reset when an instance restarts.
const requests = new Map<string, number[]>();
let lastPrunedAt = 0;

const DEFAULTS = {
  client10m: 10,
  clientDay: 60,
  ip10m: 30,
} as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function limitFor(key: keyof typeof DEFAULTS): number {
  const envName = {
    client10m: "RATE_LIMIT_10M",
    clientDay: "RATE_LIMIT_DAY",
    ip10m: "RATE_LIMIT_IP_10M",
  }[key];
  return positiveInteger(process.env[envName], DEFAULTS[key]);
}

function activeTimestamps(key: string, now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  const active = (requests.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (active.length) requests.set(key, active);
  else requests.delete(key);
  return active;
}

/** 키별로 가장 긴 제한 창이 지나간 요청을 제거합니다. 재방문하지 않는 키도 Map에 남지 않게 합니다. */
export function pruneExpiredRateLimitKeys(now = Date.now()): number {
  let removed = 0;
  for (const [key, timestamps] of requests) {
    const windowMs = key.startsWith("client:day:") ? ONE_DAY_MS : TEN_MINUTES_MS;
    if (!timestamps.some((timestamp) => timestamp > now - windowMs)) {
      requests.delete(key);
      removed += 1;
    }
  }
  return removed;
}

function prunePeriodically(now: number): void {
  // 테스트에서 과거 시각으로 되돌아가도 다음 정리가 막히지 않게 합니다.
  if (now < lastPrunedAt || now - lastPrunedAt >= PRUNE_INTERVAL_MS) {
    pruneExpiredRateLimitKeys(now);
    lastPrunedAt = now;
  }
}

type Rule = { key: string; windowMs: number; limit: number };
type LimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export async function checkLimit(keys: {
  clientId?: string;
  ipHash: string;
}): Promise<LimitResult> {
  const now = Date.now();
  prunePeriodically(now);
  return consume([
    ...(keys.clientId
      ? [
          { key: `client:10m:${keys.clientId}`, windowMs: TEN_MINUTES_MS, limit: limitFor("client10m") },
          { key: `client:day:${keys.clientId}`, windowMs: ONE_DAY_MS, limit: limitFor("clientDay") },
        ]
      : []),
    { key: `ip:10m:${keys.ipHash}`, windowMs: TEN_MINUTES_MS, limit: limitFor("ip10m") },
  ], now);
}

/** 보관함 저장(POST /api/history) 한도. OpenAI 를 부르지 않아 리포트 한도와 따로, 넉넉하게 셉니다 (11/24: 화면이 서버 저장을 쓰면서 밖에서 줄을 쌓지 못하게) */
export const HISTORY_LIMITS = { client10m: 60, ip10m: 300 } as const;

export async function checkHistoryLimit(keys: { clientId: string; ipHash: string }): Promise<LimitResult> {
  const now = Date.now();
  prunePeriodically(now);
  return consume([
    { key: `history:client:10m:${keys.clientId}`, windowMs: TEN_MINUTES_MS, limit: HISTORY_LIMITS.client10m },
    { key: `history:ip:10m:${keys.ipHash}`, windowMs: TEN_MINUTES_MS, limit: HISTORY_LIMITS.ip10m },
  ], now);
}

/** 규칙 하나라도 찼으면 가장 늦게 풀리는 시간을 돌려주고, 아니면 모든 규칙에 이번 요청을 셉니다 */
function consume(rules: Rule[], now: number): LimitResult {
  const exceeded = rules
    .map((rule) => ({ ...rule, timestamps: activeTimestamps(rule.key, now, rule.windowMs) }))
    .filter((rule) => rule.timestamps.length >= rule.limit);

  if (exceeded.length) {
    const retryAfterMs = Math.max(
      ...exceeded.map((rule) => rule.timestamps[0] + rule.windowMs - now),
    );
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  for (const rule of rules) {
    const timestamps = activeTimestamps(rule.key, now, rule.windowMs);
    timestamps.push(now);
    requests.set(rule.key, timestamps);
  }

  return { ok: true };
}

/** 1시간 미만은 분, 그 이상은 시간으로 사용자 재시도 안내를 만듭니다. */
export function retryAfterMessage(retryAfterSec: number): string {
  const wait = retryAfterSec >= 60 * 60
    ? `${Math.ceil(retryAfterSec / (60 * 60))}시간`
    : `${Math.ceil(retryAfterSec / 60)}분`;
  return `요청이 많아요. ${wait} 뒤 다시 시도해 주세요.`;
}

/** Hash the first forwarded IP before using it as a rate-limit key. Never log/store the raw IP. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(ip + salt).digest("hex").slice(0, 16);
}
