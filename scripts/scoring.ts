/**
 * 평가 채점 규칙 (리더). `pnpm eval`(scripts/eval.ts) 과 Promptfoo 채점(scripts/promptfoo/asserts.ts) 이 같은 함수를 쓰므로
 * 점수 기준은 여기 한 곳에만 있습니다. 모델을 부르지 않는 코드 검사만 둡니다. 근거 판정(모델)은 src/agent/judge.ts 입니다.
 */
import { findAdvice } from "../src/agent/guard";
import type { ResearchResult } from "../src/agent/muffin";
import type { Intent, Report } from "../src/agent/schema";

/** 채점에 필요한 질문 정보. 세트 질문(scripts/questions)은 intent · expectTools 가 있고, 임시 질문(--question)은 둘 다 없을 수 있습니다. */
export type ScoredQuestion = { intent?: Intent; expectTools?: string[] };
export type StepLike = { tool: string; status: string };

export type ToolMatch =
  /** expectTools 가 없어 볼 것이 없음 */
  | { kind: "none" }
  /** 범위 밖 질문: tool 을 하나도 부르지 않았으면 ok */
  | { kind: "out_of_scope"; ok: boolean; called: string[] }
  /** 기대한 tool 이 모두 호출됐으면 ok. missing 은 부르지 않은 것 */
  | { kind: "expected"; ok: boolean; missing: string[] };

/** 🔍 조사 Agent 가 질문에 맞는 tool 을 골랐는지 */
export function toolMatch(q: ScoredQuestion, steps: { tool: string }[]): ToolMatch {
  const called = new Set(steps.map((s) => s.tool));
  if (q.intent === "out_of_scope") return { kind: "out_of_scope", ok: called.size === 0, called: [...called] };
  if (!q.expectTools?.length) return { kind: "none" };
  const missing = q.expectTools.filter((t) => !called.has(t));
  return { kind: "expected", ok: missing.length === 0, missing };
}

/** 표에 쓰는 글자: ✅ / ❌ 이유 / - (볼 것 없음) */
export function renderToolMatch(m: ToolMatch): string {
  if (m.kind === "none") return "-";
  if (m.ok) return "✅";
  return m.kind === "out_of_scope" ? `❌ ${m.called.join(",")}` : `❌ ${m.missing.join(",")} 없음`;
}

/** 📋 분류가 질문 세트에 적힌 의도와 같은지. 분류 담당(서영)의 점수입니다. 세트에 intent 가 없으면 null(볼 것 없음). */
export function intentMatch(q: ScoredQuestion, plan: Pick<ResearchResult["plan"], "intent">): boolean | null {
  if (!q.intent) return null;
  return plan.intent === q.intent;
}

export function renderIntentMatch(q: ScoredQuestion, plan: Pick<ResearchResult["plan"], "intent">): string {
  const m = intentMatch(q, plan);
  return m === null ? "-" : m ? "✅" : `❌ ${plan.intent}`;
}

export type Checks = {
  toolsOk: number;
  toolsFailed: number;
  /** 검증을 통과해 남은 숫자: ✓ 장부 일치 */
  verified: number;
  /** 검증을 통과해 남은 숫자: C 계산 */
  derived: number;
  /** 검증 실패로 뺀 숫자 */
  removedNumbers: number;
  status: Report["verification"]["status"];
  whyTotal: number;
  whyBasis: Report["verification"]["why"];
  /** 장부에 없는 id 를 인용한 횟수 (지어낸 id) */
  badRefs: number;
  gaps: number;
  sources: number;
  /** 남은 권유 표현 수 (목표 0) */
  advice: number;
};

/** ✅ 검증 결과와 리포트에서 바로 세는 것들. `pnpm eval` 표의 열이고, Promptfoo 지표(asserts.ts)도 이 값으로 통과 여부를 정합니다. */
export function checks(report: Report, steps: StepLike[]): Checks {
  const ids = new Set(report.evidence.map((e) => e.id));
  const cited = [...report.numbers.map((n) => n.ref).filter((r): r is string => !!r), ...report.why.flatMap((w) => w.refs)];
  return {
    toolsOk: steps.filter((s) => s.status === "ok").length,
    toolsFailed: steps.filter((s) => s.status === "error").length,
    verified: report.verification.numbers.verified,
    derived: report.verification.numbers.derived,
    removedNumbers: report.verification.removed.filter((r) => r.startsWith("숫자 ")).length,
    status: report.verification.status,
    whyTotal: report.why.length,
    whyBasis: report.verification.why,
    badRefs: cited.filter((id) => !ids.has(id)).length,
    gaps: report.dataGaps.length,
    sources: report.sources.length,
    advice: findAdvice(report).length,
  };
}
