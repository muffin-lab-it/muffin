/**
 * 리플레이 모드 (리더). 실제로 돌린 실행(진행 이벤트 + 리포트)을 녹화해 두었다가, 시연에서 OpenAI · 외부 API 를 부르지 않고
 * 같은 이벤트를 같은 간격으로 다시 보내 줍니다. 발표 당일 API 가 느리거나 끊겨도 다섯 단계를 그대로 보여 주기 위한 것입니다.
 *
 *  - 녹화: scripts/replay/record.ts (`pnpm replay:record --question … --area …`) 가 실제로 돌려 src/replays/<id>.json 으로 남깁니다.
 *  - 재생: POST /api/report/stream 에 `{ replay: id, speed? }` 를 보내면 녹화된 stage · plan · step · verify 이벤트를 원래 간격(÷speed)으로 보내고
 *    마지막에 report 이벤트로 녹화된 리포트를 줍니다. 화면은 /replay (리더) 이고, 홈의 진행 화면에도 같은 이벤트로 붙일 수 있습니다.
 *  - 정직: 리포트 상단 안내(notice)에 "저장된 실행 · N월 N일 HH:MM 에 실제로 만든 리포트" 를 붙이고, 로그에는 mock 으로 남겨 운영 통계에서 뺍니다.
 */
import { z } from "zod";
import type { ToolStep } from "../agent/context";
import type { MuffinEvent } from "../agent/events";
import { areas, depths, intents, reportModes, reportSchema, verificationSchema, type Report } from "../agent/schema";
import { replays } from "../replays";
import { recordedLabel, type ReplayMeta } from "./replay-meta";

/** 녹화 id: 파일 이름이자 주소의 일부 */
export const REPLAY_ID = /^[a-z0-9][a-z0-9-]{2,59}$/;
/** 재생 속도 범위. 55초 스트림 제한 안에 끝나게 화면이 긴 녹화는 2배로 돌립니다 */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 10;
/** 이벤트 사이 간격 상한. 녹화 중 유난히 길었던 구간(다시 쓰기 등)을 시연에서 그대로 기다리지 않게 */
export const MAX_GAP_MS = 15_000;

export const toolStepSchema = z.object({
  tool: z.string(),
  status: z.enum(["ok", "error"]),
  ms: z.number(),
  error: z.string().optional(),
  fallbackAgeMs: z.number().optional(),
  breaker: z.enum(["open", "half_open"]).optional(),
});

const timed = { t: z.number().nonnegative() };
/** 녹화하는 진행 이벤트. report · error 는 라우트가 요청 id 를 붙여 보내므로 녹화하지 않습니다. t 는 시작부터의 ms */
export const timedEventSchema = z.discriminatedUnion("type", [
  z.object({ ...timed, type: z.literal("stage"), stage: z.enum(["plan", "research", "edit", "write", "verify"]), status: z.enum(["start", "done"]) }),
  z.object({ ...timed, type: z.literal("plan"), intent: z.enum(intents), mode: z.enum(reportModes), tools: z.array(z.string()) }),
  z.object({ ...timed, type: z.literal("step"), step: toolStepSchema }),
  z.object({ ...timed, type: z.literal("verify"), verification: verificationSchema }),
]);
export type TimedEvent = z.infer<typeof timedEventSchema>;

export const replaySchema = z.object({
  version: z.literal(1),
  id: z.string().regex(REPLAY_ID),
  /** 녹화한 시각 (ISO) */
  recordedAt: z.string().datetime({ offset: true }),
  question: z.string().trim().min(1).max(500),
  depth: z.enum(depths),
  area: z.enum(areas).optional(),
  model: z.string().optional(),
  /** 실제로 걸린 시간 */
  ms: z.number().int().nonnegative(),
  events: z.array(timedEventSchema),
  report: reportSchema,
  steps: z.array(toolStepSchema),
  rewrites: z.number().int().nonnegative(),
});
export type Replay = z.infer<typeof replaySchema>;
export type { ReplayMeta } from "./replay-meta";
export { recordedLabel } from "./replay-meta";

export function replayMeta(r: Replay): ReplayMeta {
  return { id: r.id, recordedAt: r.recordedAt, question: r.question, depth: r.depth, ...(r.area ? { area: r.area } : {}), ...(r.model ? { model: r.model } : {}), ms: r.ms };
}

const parsed = new Map<string, Replay>();

/** 녹화 하나. 없으면 undefined. 파일 모양이 틀리면 throw (pnpm replay:record --check 와 테스트가 미리 잡습니다) */
export function getReplay(id: string): Replay | undefined {
  if (!REPLAY_ID.test(id)) return undefined;
  const hit = parsed.get(id);
  if (hit) return hit;
  // "constructor" 같은 id 가 프로토타입 속성을 타지 않게 자기 속성만 봅니다
  if (!Object.hasOwn(replays, id)) return undefined;
  const raw = (replays as Record<string, unknown>)[id];
  const r = replaySchema.parse(raw);
  parsed.set(id, r);
  return r;
}

export function listReplays(): ReplayMeta[] {
  return Object.keys(replays)
    .map((id) => getReplay(id))
    .filter((r): r is Replay => r !== undefined)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .map(replayMeta);
}

/** 외부 서비스 오류 문구(주소 · 인증 헤더가 섞일 수 있음)를 지웁니다. 스트림 라우트와 녹화가 같은 규칙을 씁니다 */
export function publicStep(step: ToolStep): ToolStep {
  return step.error ? { ...step, error: "데이터를 확인하지 못했습니다." } : step;
}

/** 리포트 상단 안내. 녹화 시각을 밝혀 "지금 값" 처럼 보이지 않게 */
export function replayNotice(r: Replay): string {
  return `🎞️ 저장된 실행 다시 보기 · ${recordedLabel(r.recordedAt)} 에 실제로 만든 리포트입니다. 지금 데이터가 아닙니다.`;
}

/** 재생용 리포트: 안내를 앞에 붙입니다 (판단 요청 안내가 있으면 그 앞에) */
export function replayedReport(r: Replay): Report {
  const notice = replayNotice(r);
  return { ...r.report, notice: r.report.notice ? `${notice} ${r.report.notice}` : notice };
}

/** 이 속도로 재생하면 걸리는 시간 (간격 상한 적용) */
export function playbackMs(r: Replay, speed = 1, maxGapMs = MAX_GAP_MS): number {
  const rate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  let prev = 0;
  let total = 0;
  for (const e of r.events) {
    total += Math.min(Math.max(0, e.t - prev), maxGapMs);
    prev = e.t;
  }
  return Math.round(total / rate);
}

/**
 * 요청한 속도로 budgetMs 안에 못 끝나면 끝날 만큼 속도를 올립니다 (스트림은 55초에 닫히므로). 요청 속도보다 느려지지는 않습니다.
 * 돌려주는 값은 실제로 쓸 속도 (SPEED_MAX 를 넘지 않음)
 */
export function fitSpeed(r: Replay, requested: number, budgetMs: number, maxGapMs = MAX_GAP_MS): number {
  const base = playbackMs(r, 1, maxGapMs);
  const needed = budgetMs > 0 ? base / budgetMs : SPEED_MAX;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, requested, needed));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export type PlayOptions = {
  speed?: number;
  signal?: AbortSignal;
  maxGapMs?: number;
  /** 테스트용 대기 함수 */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * 녹화된 진행 이벤트를 원래 간격(÷speed, 간격 상한 maxGapMs)으로 onEvent 에 넘깁니다. report 는 호출자가 replayedReport 로 보냅니다.
 * signal 이 중단되면 조용히 멈춥니다.
 */
export async function playReplay(r: Replay, onEvent: (event: MuffinEvent) => void, { speed = 1, signal, maxGapMs = MAX_GAP_MS, wait = sleep }: PlayOptions = {}): Promise<void> {
  const rate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  let prev = 0;
  for (const timedEvent of r.events) {
    if (signal?.aborted) return;
    const { t, ...event } = timedEvent;
    const gap = Math.min(Math.max(0, t - prev), maxGapMs) / rate;
    prev = t;
    if (gap > 0) await wait(gap, signal);
    if (signal?.aborted) return;
    onEvent(event as MuffinEvent);
  }
}
