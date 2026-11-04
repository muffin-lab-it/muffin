/**
 * tool 회로 차단기 (리더). 같은 tool 이 짧은 시간에 연속으로 일시적 실패(연결 · 5xx · 시간 초과)를 하면 회로를 열어,
 * 한동안은 외부 호출을 건너뛰고 바로 폴백(src/tools/cache.ts)으로 갑니다. 죽은 API 에 매번 10초씩 기다리지 않게 하려는 것입니다 (금융권 관행).
 *
 *  - 닫힘(closed): 평소. 실패를 세기만 합니다
 *  - 열림(open): WINDOW_MS 안에 OPEN_AFTER 번 실패 → COOLDOWN_MS 동안 호출 생략
 *  - 반열림(half_open): 쿨다운이 지나면 한 번만 짧은 제한 시간(PROBE_TIMEOUT_MS)으로 찔러 봄. 성공이면 닫히고, 실패면 다시 엶
 *
 * 상태는 이 서버 인스턴스의 메모리에만 있습니다 (Vercel 은 인스턴스마다 따로 셈). 입력 잘못 같은 4xx 는 세지 않습니다.
 * TOOL_BREAKER=0 이면 끕니다 (테스트 기본값, vitest.config.ts).
 */

/** 이 시간 안에 */
export const WINDOW_MS = 5 * 60_000;
/** 이만큼 일시적 실패가 쌓이면 엽니다 */
export const OPEN_AFTER = 2;
/** 열린 뒤 호출을 건너뛰는 시간 */
export const COOLDOWN_MS = 60_000;
/** 반열림 때 한 번 찔러 보는 제한 시간 */
export const PROBE_TIMEOUT_MS = 3_000;

export type BreakerState = "closed" | "open" | "half_open";

type Circuit = { failures: number[]; openedAt?: number; probing: boolean };
const circuits = new Map<string, Circuit>();

export function breakerEnabled(): boolean {
  return process.env.TOOL_BREAKER !== "0";
}

function circuitOf(tool: string): Circuit {
  let c = circuits.get(tool);
  if (!c) {
    c = { failures: [], probing: false };
    circuits.set(tool, c);
  }
  return c;
}

/** 지금 이 tool 의 상태 */
export function stateOf(tool: string, now = Date.now()): BreakerState {
  const c = circuits.get(tool);
  if (!c || c.openedAt === undefined) return "closed";
  return now - c.openedAt < COOLDOWN_MS ? "open" : "half_open";
}

/**
 * 호출 전에 묻습니다. skip 이면 외부 호출 없이 폴백으로, probe 면 짧은 제한 시간으로 한 번만 (재시도 없이).
 * 반열림에서는 첫 호출만 찔러 보고, 그 결과가 나오기 전의 다른 호출은 건너뜁니다 (동시에 여러 번 찔러 보지 않게).
 */
export function before(tool: string, now = Date.now()): { skip: false; probe: boolean; retryAfterMs?: undefined } | { skip: true; probe: false; retryAfterMs: number } {
  if (!breakerEnabled()) return { skip: false, probe: false };
  const c = circuitOf(tool);
  const state = stateOf(tool, now);
  if (state === "closed") return { skip: false, probe: false };
  if (state === "open") return { skip: true, probe: false, retryAfterMs: COOLDOWN_MS - (now - (c.openedAt ?? now)) };
  if (c.probing) return { skip: true, probe: false, retryAfterMs: PROBE_TIMEOUT_MS };
  c.probing = true;
  return { skip: false, probe: true };
}

/** 호출이 성공했을 때: 회로를 닫고 실패 기록을 지웁니다 */
export function onSuccess(tool: string): void {
  if (!breakerEnabled()) return;
  const c = circuitOf(tool);
  c.failures = [];
  c.openedAt = undefined;
  c.probing = false;
}

/** 일시적 실패가 났을 때: 세고, 기준을 넘으면 엽니다. 열린 상태에서의 실패(반열림 찔러 보기)는 다시 엽니다. 돌려주는 값은 그 뒤의 상태 */
export function onFailure(tool: string, now = Date.now()): BreakerState {
  if (!breakerEnabled()) return "closed";
  const c = circuitOf(tool);
  c.probing = false;
  c.failures = [...c.failures.filter((t) => now - t < WINDOW_MS), now];
  if (c.openedAt !== undefined || c.failures.length >= OPEN_AFTER) c.openedAt = now;
  return stateOf(tool, now);
}

/**
 * 응답은 받았지만 일시적 실패가 아닌 경우(4xx · 응답 형식 오류). API 는 살아 있으므로 실패로 세지 않고,
 * 찔러 보던 중이었으면 그 표시를 풀고 회로를 닫습니다 (풀지 않으면 다음 호출이 계속 건너뛰게 됨)
 */
export function onNonTransient(tool: string): void {
  if (!breakerEnabled()) return;
  const c = circuits.get(tool);
  if (!c) return;
  c.probing = false;
  if (c.openedAt !== undefined) {
    c.openedAt = undefined;
    c.failures = [];
  }
}

/** 테스트용 */
export function resetBreakers(): void {
  circuits.clear();
}
