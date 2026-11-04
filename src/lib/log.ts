/**
 * 요청 1건 = 로그 1줄 (JSON). Vercel → Logs 에서 "muffin.run" 으로 검색합니다.
 * 2단계에서 백엔드 팀이 같은 RunLog 를 데이터베이스에 저장합니다. 필드를 바꿀 때는 그쪽과 맞춥니다.
 */
import type { ToolStep } from "../agent/context";
import type { Intent, Verification } from "../agent/schema";

export type RunStage = "input" | "config" | "agent" | "ok";

export type RunLog = {
  type: "muffin.run";
  id: string;
  at: string; // ISO
  ok: boolean;
  /** 어디서 끝났나. ok 면 "ok", 실패면 실패한 단계 */
  stage: RunStage;
  mock: boolean;
  input?: { question: string; depth: string; area?: string };
  ms: number;
  model?: string;
  usage?: { requests: number; inputTokens: number; outputTokens: number };
  steps?: ToolStep[];
  rewrites?: number;
  /** 리포트 품질 신호 */
  quality?: { numbers: number; why: number; whyUnsupported: number; dataGaps: number; sources: number };
  /** 리포트 검증 요약 (명세 4.4). /admin 의 검증 통과율 · 다시 쓰기 비율 · 깊이별 비교가 씁니다 */
  verification?: Pick<Verification, "status" | "numbers" | "why" | "advice" | "revisions">;
  /** 분류가 정한 의도 (명세 4.4). /admin 의 의도별 요청 수 */
  intent?: Intent;
  error?: string;
};

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 질문은 길면 자릅니다. 개인 금융정보를 받지 않는 서비스지만 로그를 가볍게 유지하려고. */
export function clip(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function logRun(entry: Omit<RunLog, "type">): void {
  const line: RunLog = { type: "muffin.run", ...entry };
  if (line.ok) console.log(JSON.stringify(line));
  else console.error(JSON.stringify(line));
}
