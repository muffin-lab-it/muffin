import { createHash } from "node:crypto";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// v1 limitation: this in-memory Map is local to a single server instance.
// Limits are not shared across Vercel instances and reset when an instance restarts.
const requests = new Map<string, number[]>();

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

type Rule = { key: string; windowMs: number; limit: number };

export async function checkLimit(keys: {
  clientId?: string;
  ipHash: string;
}): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const now = Date.now();
  const rules: Rule[] = [
    ...(keys.clientId
      ? [
          { key: `client:10m:${keys.clientId}`, windowMs: TEN_MINUTES_MS, limit: limitFor("client10m") },
          { key: `client:day:${keys.clientId}`, windowMs: ONE_DAY_MS, limit: limitFor("clientDay") },
        ]
      : []),
    { key: `ip:10m:${keys.ipHash}`, windowMs: TEN_MINUTES_MS, limit: limitFor("ip10m") },
  ];

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

/** Hash the first forwarded IP before using it as a rate-limit key. Never log/store the raw IP. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(ip + salt).digest("hex").slice(0, 16);
}
