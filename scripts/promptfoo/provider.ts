/**
 * Promptfoo 용 provider (리더). 질문 하나를 받아 다섯 단계(research)를 끝까지 돌리고 리포트와 단계 결과를 그대로 돌려줍니다.
 * 채점은 asserts.ts 가 합니다. 실제 OpenAI · tool 호출이라 키가 필요합니다 (.env.local, Action 에서는 secrets).
 * 평가는 품질을 보려는 것이라 마감 없이 돌립니다 (`pnpm eval` 과 같음). 걸린 시간은 latency 지표가 따로 봅니다.
 * promptfooconfig.yaml 의 providers 에서 `file://provider.ts` 로 가리킵니다.
 */
import { research, type ResearchResult } from "../../src/agent/muffin";
import type { Area, Depth, Intent } from "../../src/agent/schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 파일이 없으면 환경 변수(Action secrets)를 그대로 씁니다
}

/** 테스트(tests.ts)가 질문마다 넘기는 변수. 질문 세트(scripts/questions) 의 필드 그대로입니다. */
export type EvalVars = {
  id?: string;
  question?: string;
  depth?: Depth;
  area?: Area | "";
  intent?: Intent;
  expectTools?: string[];
};

/** provider 가 돌려주는 output. asserts.ts 와 summary.ts 가 이 모양을 봅니다. */
export type EvalOutput = Pick<ResearchResult, "report" | "plan" | "steps" | "rewrites" | "facts" | "model" | "usage"> & {
  question: string;
  depth: Depth;
  area?: Area;
  /** research 에 걸린 시간. promptfoo 의 latencyMs 와 거의 같습니다 */
  elapsedMs: number;
};

type CallContext = { vars?: EvalVars };

export default class MuffinProvider {
  id(): string {
    return "muffin";
  }

  async callApi(prompt: string, context: CallContext = {}) {
    const vars = context.vars ?? {};
    const question = vars.question || prompt;
    const depth: Depth = vars.depth ?? "standard";
    const area: Area | undefined = vars.area || undefined;
    const started = Date.now();
    try {
      const r = await research({ question, depth, area }, { deadline: Number.POSITIVE_INFINITY });
      const output: EvalOutput = {
        question,
        depth,
        area,
        report: r.report,
        plan: r.plan,
        steps: r.steps,
        rewrites: r.rewrites,
        facts: r.facts,
        model: r.model,
        usage: r.usage,
        elapsedMs: Date.now() - started,
      };
      const tokenUsage = r.usage
        ? { total: r.usage.inputTokens + r.usage.outputTokens, prompt: r.usage.inputTokens, completion: r.usage.outputTokens, numRequests: r.usage.requests }
        : undefined;
      return { output, tokenUsage };
    } catch (err) {
      // 실패는 error 로 돌려야 promptfoo 가 그 질문만 오류로 표시하고 나머지를 계속 돌립니다
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
