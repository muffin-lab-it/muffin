/**
 * Promptfoo 테스트 생성기 (리더). 고정 질문 세트(scripts/questions/*.json)를 그대로 읽어 질문마다 테스트 하나와 지표(assert)를 만듭니다.
 * 세트 파일 형식은 scripts/questions/README.md, 지표 뜻은 asserts.ts. promptfooconfig.yaml 의 tests 에서 `file://tests.ts` 로 가리킵니다.
 * 레포 루트에서 실행한다고 가정합니다 (pnpm eval:promptfoo).
 *
 *   MUFFIN_EVAL_SET=common,etf   세트 고르기 (없으면 전부)
 *   MUFFIN_EVAL_DEPTH=deep|all   깊이 바꾸기 (없으면 질문에 적힌 depth)
 *   MUFFIN_EVAL_NO_JUDGE=1       근거 판정(모델) 빼기
 */
import { join } from "node:path";
import { TIME_BUDGET_MS } from "../../src/agent/muffin";
import { depths, type Depth } from "../../src/agent/schema";
import { QUESTIONS_DIR, loadAllQuestionSets, loadQuestionSet, type Question, type QuestionSet } from "../questions/schema";
import type { Metric } from "./asserts";

export type PromptfooAssert = { type: "javascript"; value: string; metric: Metric } | { type: "latency"; threshold: number; metric: "latency" };
export type PromptfooTest = { description: string; vars: Record<string, unknown>; metadata: Record<string, unknown>; assert: PromptfooAssert[] };
export type BuildOptions = { depth?: Depth | "all"; judge?: boolean };

const js = (metric: Exclude<Metric, "latency">): PromptfooAssert => ({ type: "javascript", value: `file://asserts.ts:${metric}`, metric });

/**
 * 질문 하나에 붙는 지표. tool 선택은 기대 tool 이 있거나 범위 밖 질문일 때만 (볼 것이 없는 질문이 통과율을 올리지 않게).
 * 범위 밖 질문은 리포트가 비어야 정상이라 숫자 · 원인 · 근거 판정을 재지 않습니다.
 */
export function assertsFor(q: Question, { judge = true }: BuildOptions = {}): PromptfooAssert[] {
  const out: PromptfooAssert[] = [js("intent")];
  if (q.intent === "out_of_scope" || q.expectTools.length > 0) out.push(js("tools"));
  if (q.intent !== "out_of_scope") {
    out.push(js("numbers"), js("why"));
    if (judge) out.push(js("judge"));
  }
  out.push(js("refs"), js("advice"), js("verification"), js("rewrites"), { type: "latency", threshold: TIME_BUDGET_MS, metric: "latency" });
  return out;
}

export function depthsFor(q: Question, depth?: Depth | "all"): Depth[] {
  if (depth === "all") return [...depths];
  if (depth) return [depth];
  return [q.depth];
}

export function buildTests(sets: QuestionSet[], opts: BuildOptions = {}): PromptfooTest[] {
  return sets.flatMap((s) =>
    s.questions.flatMap((q) =>
      depthsFor(q, opts.depth).map((depth) => ({
        description: `${q.id} [${depth}] ${q.question}`,
        // provider 와 asserts 가 읽는 값. expectTools 같은 배열은 promptfooconfig.yaml 의 disableVarExpansion 으로 그대로 넘어갑니다.
        vars: { id: q.id, question: q.question, depth, intent: q.intent, expectTools: q.expectTools, ...(q.area ? { area: q.area } : {}) },
        metadata: { set: s.set, owner: s.owner, area: q.area ?? "none", intent: q.intent, depth, note: q.note ?? "" },
        assert: assertsFor(q, opts),
      })),
    ),
  );
}

/** MUFFIN_EVAL_SET 이 있으면 그 세트만 (쉼표로 여러 개), 없으면 전부 */
export function loadSets(setEnv = process.env.MUFFIN_EVAL_SET): QuestionSet[] {
  const names = (setEnv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return names.length ? names.map((n) => loadQuestionSet(join(QUESTIONS_DIR, `${n}.json`))) : loadAllQuestionSets();
}

export default async function generateTests(): Promise<PromptfooTest[]> {
  const depth = (process.env.MUFFIN_EVAL_DEPTH || undefined) as Depth | "all" | undefined;
  return buildTests(loadSets(), { depth, judge: process.env.MUFFIN_EVAL_NO_JUDGE !== "1" });
}
