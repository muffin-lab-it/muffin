/**
 * Promptfoo 채점 함수 (리더). 지표 하나가 함수 하나입니다. 모두 provider.ts 의 output 을 받아 { pass, score, reason } 을 돌려줍니다.
 * 코드 검사는 scripts/scoring.ts(`pnpm eval` 과 같은 함수), 근거 판정은 src/agent/judge.ts 를 그대로 부르므로 두 평가의 기준이 같습니다.
 * tests.ts 가 질문마다 `file://asserts.ts:<이름>` 으로 고르고, summary.ts 가 metricLabels 순서로 표를 만듭니다.
 */
import { createJudgeAgent, judgeWhy, judgeable, summarizeJudge, verdictMark } from "../../src/agent/judge";
import { metricLabels, type Metric } from "../../src/lib/eval-metrics";
import { checks, intentMatch, toolMatch } from "../scoring";
import type { EvalOutput, EvalVars } from "./provider";

export type Grade = { pass: boolean; score: number; reason: string };
/** promptfoo 가 넘기는 context 중 쓰는 것. vars 는 tests.ts 가 질문마다 넣은 값입니다. */
export type AssertContext = { vars: EvalVars };

/** 지표 이름(metric) 과 한국어 이름은 src/lib/eval-metrics.ts 에 있습니다 (관리자 화면도 같이 씀). latency 는 promptfoo 내장 assertion 입니다. */
export { metricLabels, type Metric };

const grade = (pass: boolean, reason: string, score = pass ? 1 : 0): Grade => ({ pass, score, reason });

/** 📋 분류의 의도가 질문 세트의 정답과 같은가 */
export function intent(output: EvalOutput, context: AssertContext): Grade {
  const m = intentMatch({ intent: context.vars.intent }, output.plan);
  if (m === null) return grade(true, "세트에 intent 가 없어 볼 것 없음");
  return grade(m, `분류 ${output.plan.intent} · 정답 ${context.vars.intent}`);
}

/** 🔍 조사가 기대한 tool 을 모두 불렀는가 (범위 밖 질문은 하나도 부르지 않았는가) */
export function tools(output: EvalOutput, context: AssertContext): Grade {
  const m = toolMatch({ intent: context.vars.intent, expectTools: context.vars.expectTools }, output.steps);
  const called = [...new Set(output.steps.map((s) => s.tool))].join(", ") || "(없음)";
  if (m.kind === "none") return grade(true, `기대한 tool 이 없어 볼 것 없음 · 부른 tool ${called}`);
  if (m.kind === "out_of_scope") return grade(m.ok, m.ok ? "범위 밖 질문에 tool 을 부르지 않음" : `범위 밖 질문인데 ${m.called.join(", ")} 호출`);
  return grade(m.ok, m.ok ? `기대한 tool 모두 호출 (${called})` : `${m.missing.join(", ")} 없음 (부른 tool ${called})`);
}

/**
 * ✅ 숫자 검증: 검증 실패로 뺀 숫자가 없는가. 점수는 남은 숫자(✓ 장부 일치 · C 계산)의 비율.
 * 숫자가 하나도 없는 리포트(뉴스 현황 · 판단 요청 등)는 뺀 것도 없으니 통과이고, reason 에 그렇게 적습니다.
 */
export function numbers(output: EvalOutput): Grade {
  const c = checks(output.report, output.steps);
  const kept = c.verified + c.derived;
  const total = kept + c.removedNumbers;
  return { pass: c.removedNumbers === 0, score: total ? kept / total : 1, reason: `✓${c.verified} C${c.derived} 제거${c.removedNumbers}${total ? "" : " (숫자 없음)"}` };
}

/** 장부에 없는 번호를 인용하지 않았는가 */
export function refs(output: EvalOutput): Grade {
  const c = checks(output.report, output.steps);
  return grade(c.badRefs === 0, c.badRefs ? `장부에 없는 번호 ${c.badRefs}개 인용` : "인용한 번호가 모두 장부에 있음");
}

/** 원인(why)마다 근거가 있는가: basis none 이 0. 점수는 데이터 · 뉴스 근거 비율 */
export function why(output: EvalOutput): Grade {
  const c = checks(output.report, output.steps);
  const b = c.whyBasis;
  return { pass: b.none === 0, score: c.whyTotal ? (b.data + b.news) / c.whyTotal : 1, reason: `📊${b.data} 📰${b.news} ❔${b.none} (원인 ${c.whyTotal}개)` };
}

/** 권유 표현이 남지 않았는가 */
export function advice(output: EvalOutput): Grade {
  const c = checks(output.report, output.steps);
  return grade(c.advice === 0, c.advice ? `권유 표현 ${c.advice}개 남음` : "권유 표현 없음");
}

/** ✅ 검증이 pass 인가 (partial 은 뺀 항목이 있는 것) */
export function verification(output: EvalOutput): Grade {
  const v = output.report.verification;
  return grade(v.status === "pass", `검증 ${v.status}, 뺀 항목 ${v.removed.length}개`);
}

/** 검증 실패로 다시 쓰지 않았는가 */
export function rewrites(output: EvalOutput): Grade {
  return grade(output.rewrites === 0, `다시 쓰기 ${output.rewrites}회`);
}

let judgeAgent: ReturnType<typeof createJudgeAgent> | undefined;

/**
 * 근거 판정 (3단계, 모델). 원인마다 인용한 장부 항목이 주장을 뒷받침하는지 judge.ts 가 봅니다.
 * contradicted(반대) 가 하나라도 있거나 모델이 항목을 빠뜨리면 실패, 점수는 supported 비율입니다. 판정할 원인이 없으면 통과.
 */
export async function judge(output: EvalOutput, _context?: AssertContext, agent = (judgeAgent ??= createJudgeAgent())): Promise<Grade> {
  const { why: items, evidence } = output.report;
  if (judgeable(items, evidence).length === 0) return grade(true, "판정할 원인 없음 (basis none 이거나 장부 인용 없음)");
  const results = await judgeWhy(items, evidence, agent);
  if (!results) return grade(false, "판정 못 함 (모델 호출 실패)");
  const s = summarizeJudge(results);
  const judged = s.supported + s.unsupported + s.contradicted;
  const lines = results
    .filter((r) => r.verdict !== "skipped")
    .map((r) => `${verdictMark[r.verdict]} ${items[r.index]?.claim.slice(0, 40) ?? ""} — ${r.reason}`);
  return {
    pass: s.contradicted === 0 && s.missing === 0,
    score: judged ? s.supported / judged : 0,
    reason: `✓${s.supported} ✗${s.unsupported} ⚡${s.contradicted}${s.missing ? ` ?${s.missing}` : ""}\n${lines.join("\n")}`,
  };
}
