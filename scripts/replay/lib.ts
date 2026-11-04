/**
 * 리플레이 녹화의 순수 부분 (리더). record.ts 가 CLI 로 감쌉니다.
 */
import type { MuffinEvent } from "../../src/agent/events";
import type { ResearchResult } from "../../src/agent/muffin";
import type { Area, Depth } from "../../src/agent/schema";
import { publicStep, replayMeta, replaySchema, type Replay, type ReplayMeta, type TimedEvent } from "../../src/lib/replay";
import { redactSecrets } from "../../src/lib/redact";

export type Captured = { t: number; event: MuffinEvent };

/** 녹화 id 기본값: 영역-날짜-시각 (한국 시간). 같은 분에 두 번이면 --id 로 구분 */
export function defaultId(area: Area | undefined, recordedAt: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(recordedAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${area ?? "any"}-${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}`;
}

/**
 * 잡아 둔 이벤트와 실행 결과를 녹화 파일 모양으로 만듭니다. report · error 이벤트는 빼고(라우트가 붙임), step 의 외부 오류 문구는 지웁니다.
 * 질문 · 리포트 문자열의 비밀값은 지웁니다 (있을 리 없지만 파일로 남는 것이라).
 */
export function buildReplay(
  captured: Captured[],
  result: ResearchResult,
  meta: { id: string; question: string; depth: Depth; area?: Area; recordedAt: string; ms: number },
): Replay {
  const events: TimedEvent[] = captured.flatMap(({ t, event }): TimedEvent[] => {
    if (event.type === "report" || event.type === "error") return [];
    if (event.type === "step") return [{ t, type: "step", step: publicStep(event.step) }];
    return [{ t, ...event }];
  });
  const replay = {
    version: 1 as const,
    id: meta.id,
    recordedAt: meta.recordedAt,
    question: redactSecrets(meta.question),
    depth: meta.depth,
    ...(meta.area ? { area: meta.area } : {}),
    ...(result.model ? { model: result.model } : {}),
    ms: meta.ms,
    events,
    report: JSON.parse(redactSecrets(JSON.stringify(result.report))),
    steps: result.steps.map(publicStep),
    rewrites: result.rewrites,
  };
  return replaySchema.parse(replay);
}

/** src/replays/index.ts 본문. JSON 을 정적으로 import 해 Next 번들에 들어가게 합니다 */
export function renderIndex(ids: string[]): string {
  const sorted = [...ids].sort();
  const name = (id: string) => `r${sorted.indexOf(id)}`;
  const imports = sorted.map((id) => `import ${name(id)} from "./${id}.json";`).join("\n");
  const entries = sorted.map((id) => `  "${id}": ${name(id)},`).join("\n");
  return [
    "// 생성 파일: scripts/replay/record.ts 가 다시 만듭니다. 손으로 고치지 마세요. 녹화 형식은 src/lib/replay.ts 의 replaySchema.",
    ...(imports ? [imports, ""] : []),
    `export const replays: Record<string, unknown> = {${entries ? `\n${entries}\n` : ""}};`,
    "",
  ].join("\n");
}

/** src/replays/manifest.json 본문 (최신순) */
export function renderManifest(all: Replay[]): ReplayMeta[] {
  return [...all].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(replayMeta);
}

/** 녹화하면 안 되는 것: 권유 표현이 남은 리포트 */
export function recordable(replay: Replay): { ok: true } | { ok: false; reason: string } {
  const advice = replay.report.verification.advice;
  if (advice > 0) return { ok: false, reason: `권유 표현이 ${advice}건 남은 리포트는 녹화하지 않습니다 (--force 로 강제)` };
  return { ok: true };
}
