/**
 * 리플레이 목록용 가벼운 모듈 (리더). 화면(app/replay)이 녹화 JSON 전체(src/replays)를 번들에 넣지 않도록 메타 타입과 시각 표기만 둡니다.
 * 녹화 본체와 재생은 src/lib/replay.ts.
 */
import type { Area, Depth } from "../agent/schema";

/** 녹화 한 건의 목록 정보 (src/replays/manifest.json 의 한 줄) */
export type ReplayMeta = { id: string; recordedAt: string; question: string; depth: Depth; area?: Area; model?: string; ms: number };

/** "11/4 21:30" (한국 시간) */
export function recordedLabel(recordedAt: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(recordedAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 55초 스트림 제한 안에 끝나게: 45초 넘는 녹화는 2배속 기본 */
export function defaultSpeed(meta: Pick<ReplayMeta, "ms">): number {
  return meta.ms > 45_000 ? 2 : 1;
}
