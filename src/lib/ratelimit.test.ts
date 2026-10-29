import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkLimit, hashIp } from "./ratelimit";

describe("hashIp", () => {
  it("returns a stable truncated SHA-256 hash and changes with the salt", () => {
    expect(hashIp("203.0.113.5", "secret")).toHaveLength(16);
    expect(hashIp("203.0.113.5", "secret")).toBe(hashIp("203.0.113.5", "secret"));
    expect(hashIp("203.0.113.5", "secret")).not.toBe(hashIp("203.0.113.5", "other"));
    expect(hashIp("203.0.113.5", "secret")).not.toContain("203.0.113.5");
  });
});

describe("checkLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T00:00:00.000Z"));
    vi.stubEnv("RATE_LIMIT_10M", "2");
    vi.stubEnv("RATE_LIMIT_DAY", "3");
    vi.stubEnv("RATE_LIMIT_IP_10M", "3");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("allows requests below the client and IP limits", async () => {
    expect(await checkLimit({ clientId: "client-a", ipHash: "ip-a" })).toEqual({ ok: true });
    expect(await checkLimit({ clientId: "client-a", ipHash: "ip-a" })).toEqual({ ok: true });
  });

  it("limits a client after the configured 10-minute threshold", async () => {
    const keys = { clientId: "client-10m", ipHash: "ip-10m" };
    expect(await checkLimit(keys)).toEqual({ ok: true });
    expect(await checkLimit(keys)).toEqual({ ok: true });
    expect(await checkLimit(keys)).toMatchObject({ ok: false, retryAfterSec: 600 });
  });

  it("counts IP requests even when client IDs differ or are missing", async () => {
    expect(await checkLimit({ clientId: "client-ip-1", ipHash: "shared-ip" })).toEqual({ ok: true });
    expect(await checkLimit({ clientId: "client-ip-2", ipHash: "shared-ip" })).toEqual({ ok: true });
    expect(await checkLimit({ ipHash: "shared-ip" })).toEqual({ ok: true });
    expect(await checkLimit({ ipHash: "shared-ip" })).toMatchObject({ ok: false, retryAfterSec: 600 });
  });

  it("enforces the daily client limit", async () => {
    vi.stubEnv("RATE_LIMIT_10M", "10");
    const keys = { clientId: "client-day", ipHash: "ip-day" };
    expect(await checkLimit(keys)).toEqual({ ok: true });
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(await checkLimit(keys)).toEqual({ ok: true });
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(await checkLimit(keys)).toEqual({ ok: true });
    expect(await checkLimit(keys)).toMatchObject({ ok: false, retryAfterSec: 24 * 60 * 60 - 22 * 60 * 1000 / 1000 });
  });

  it("uses the documented default 10-minute client limit when the variable is empty", async () => {
    vi.stubEnv("RATE_LIMIT_10M", "");
    vi.stubEnv("RATE_LIMIT_DAY", "");
    vi.stubEnv("RATE_LIMIT_IP_10M", "100");
    const keys = { clientId: "client-default", ipHash: "ip-default" };
    for (let i = 0; i < 10; i++) expect(await checkLimit(keys)).toEqual({ ok: true });
    expect(await checkLimit(keys)).toMatchObject({ ok: false, retryAfterSec: 600 });
  });

  it("allows requests after the 10-minute window expires", async () => {
    const keys = { clientId: "client-expiry", ipHash: "ip-expiry" };
    expect(await checkLimit(keys)).toEqual({ ok: true });
    expect(await checkLimit(keys)).toEqual({ ok: true });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(await checkLimit(keys)).toEqual({ ok: true });
  });
});
