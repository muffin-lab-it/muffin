import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOLDOWN_MS, OPEN_AFTER, PROBE_TIMEOUT_MS, WINDOW_MS, before, onFailure, onNonTransient, onSuccess, resetBreakers, stateOf } from "./breaker";

beforeEach(() => vi.stubEnv("TOOL_BREAKER", "1"));
afterEach(() => {
  resetBreakers();
  vi.unstubAllEnvs();
});

describe("회로 차단기", () => {
  it("5분 안에 2번 실패하면 열리고, 1분 동안 호출을 건너뛴다", () => {
    const t0 = 1_000_000;
    expect(before("fx", t0)).toEqual({ skip: false, probe: false });
    expect(onFailure("fx", t0)).toBe("closed");
    expect(before("fx", t0 + 1_000)).toEqual({ skip: false, probe: false });
    expect(onFailure("fx", t0 + 1_000)).toBe("open");
    expect(stateOf("fx", t0 + 1_000)).toBe("open");
    expect(before("fx", t0 + 2_000)).toEqual({ skip: true, probe: false, retryAfterMs: COOLDOWN_MS - 1_000 });
    expect(OPEN_AFTER).toBe(2);
    expect(WINDOW_MS).toBe(5 * 60_000);
    expect(COOLDOWN_MS).toBe(60_000);
  });

  it("오래된 실패는 세지 않는다 (5분 창)", () => {
    const t0 = 1_000_000;
    onFailure("fx", t0);
    expect(onFailure("fx", t0 + WINDOW_MS + 1)).toBe("closed");
  });

  it("쿨다운이 지나면 한 번만 찔러 보고, 그동안 다른 호출은 건너뛴다. 성공이면 닫히고 실패면 다시 열린다", () => {
    const t0 = 1_000_000;
    onFailure("fx", t0);
    onFailure("fx", t0);
    const later = t0 + COOLDOWN_MS;
    expect(stateOf("fx", later)).toBe("half_open");
    expect(before("fx", later)).toEqual({ skip: false, probe: true });
    expect(before("fx", later + 10)).toEqual({ skip: true, probe: false, retryAfterMs: PROBE_TIMEOUT_MS });
    onSuccess("fx");
    expect(stateOf("fx", later + 20)).toBe("closed");
    expect(before("fx", later + 20)).toEqual({ skip: false, probe: false });

    onFailure("fx", later + 30);
    onFailure("fx", later + 30);
    const again = later + 30 + COOLDOWN_MS;
    expect(before("fx", again)).toEqual({ skip: false, probe: true });
    expect(onFailure("fx", again + 100)).toBe("open");
    expect(before("fx", again + 200).skip).toBe(true);
  });

  it("찔러 보다 4xx 처럼 비일시적 실패가 나면 찔러 보기 표시를 풀고 회로를 닫는다. 닫힌 상태의 4xx 는 실패 수를 건드리지 않는다", () => {
    const t0 = 1_000_000;
    onFailure("fx", t0);
    onFailure("fx", t0);
    const later = t0 + COOLDOWN_MS;
    expect(before("fx", later)).toEqual({ skip: false, probe: true });
    onNonTransient("fx");
    expect(stateOf("fx", later + 1)).toBe("closed");
    expect(before("fx", later + 1)).toEqual({ skip: false, probe: false });

    onFailure("etf", t0);
    onNonTransient("etf");
    expect(onFailure("etf", t0 + 1)).toBe("open");
  });

  it("tool 마다 따로 세고, TOOL_BREAKER=0 이면 아무것도 하지 않는다", () => {
    const t0 = 1_000_000;
    onFailure("fx", t0);
    onFailure("fx", t0);
    expect(before("etf", t0).skip).toBe(false);
    vi.stubEnv("TOOL_BREAKER", "0");
    expect(before("fx", t0 + 1).skip).toBe(false);
    expect(onFailure("fx", t0 + 1)).toBe("closed");
  });
});
