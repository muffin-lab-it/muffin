/**
 * 요청 1건 = 로그 1줄 (JSON). Vercel → Logs 에서 "muffin.run" 으로 검색합니다.
 * 2단계에서 백엔드 팀이 같은 RunLog 를 데이터베이스에 저장합니다. 필드를 바꿀 때는 그쪽과 맞춥니다.
 */
import type { ToolStep } from "../agent/context";
import type { FactsOutput, Intent, Report, Verification } from "../agent/schema";

export type RunStage = "input" | "config" | "limited" | "agent" | "ok";

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
  /** 리포트 품질 신호. edit 는 정제 요약(src/agent/muffin.ts EditSummary): 정제 실패 · 뺀 항목 · 거른 계산 수. runs.quality(jsonb) 안에 같이 들어가 표를 바꾸지 않습니다 */
  quality?: { numbers: number; why: number; whyUnsupported: number; dataGaps: number; sources: number; edit?: { ok: boolean; facts: number; dropped: number; unverified: number; reversed: number; fallback: boolean }; rewriteReasons?: string[] };
  /** 리포트 검증 요약 (명세 4.4). /admin 의 검증 통과율 · 다시 쓰기 비율 · 깊이별 비교가 씁니다 */
  verification?: Pick<Verification, "status" | "numbers" | "why" | "advice" | "revisions">;
  /** 분류가 정한 의도 (명세 4.4). /admin 의 의도별 요청 수 */
  intent?: Intent;
  error?: string;
  /**
   * 리포트 본문과 정제 결과 (11/21). runs 표에만 저장하고 콘솔 로그에는 싣지 않습니다 (한 줄이 수십 KB 가 됨).
   * 베타 테스터가 받은 리포트를 나중에 그대로 다시 보려고 남깁니다.
   */
  report?: Report;
  facts?: FactsOutput | null;
};

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 질문은 길면 자릅니다. 개인 금융정보를 받지 않는 서비스지만 로그를 가볍게 유지하려고. */
export function clip(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function logRun(entry: Omit<RunLog, "type">): void {
  // 본문 · 정제 결과는 표에만 (콘솔 한 줄을 가볍게)
  const { report: _report, facts: _facts, ...rest } = entry;
  void _report;
  void _facts;
  const line: RunLog = { type: "muffin.run", ...rest };
  if (line.ok) console.log(JSON.stringify(line));
  else console.error(JSON.stringify(line));
}
