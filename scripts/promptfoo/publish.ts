/**
 * 평가 요약 한 줄을 Supabase evals 표에 넣습니다 (리더). run.ts 가 Supabase 환경 변수가 있을 때 부르고, /admin 품질 평가 패널이 읽습니다.
 * 넣기에 실패해도 평가 결과(exit 코드)에는 영향을 주지 않습니다 — 평가는 끝났고 파일에 남아 있으므로.
 */
import { getDb, type TablesInsert } from "../../src/lib/db";
import { thresholdsOf, usageOf, type PromptfooOutput, type Summary } from "./summary";

export type EvalContext = {
  /** Action 은 GitHub run id, 로컬은 날짜-시각(-tag) */
  id: string;
  source: "ci" | "local";
  tag: string | null;
  set: string | null;
  runUrl: string | null;
};

/**
 * GitHub Actions 안이면 run id · 실행 페이지 주소를, 아니면 로컬로. 로컬 id 는 promptfoo 의 evalId(실행마다 다름)를 쓰고, 없을 때만 날짜-시각입니다
 * (분 단위 stamp 는 같은 분의 두 실행이 겹칠 수 있어서). 세트는 --set 이 없으면 Action 이 넘기는 MUFFIN_EVAL_SET 을 봅니다.
 */
export function evalContext(env: Record<string, string | undefined>, stamp: string, tag: string | undefined, set: string | undefined, evalId?: string): EvalContext {
  const ci = env.GITHUB_ACTIONS === "true" && !!env.GITHUB_RUN_ID;
  return {
    id: ci ? env.GITHUB_RUN_ID! : (evalId || stamp),
    source: ci ? "ci" : "local",
    tag: tag ?? null,
    set: set || env.MUFFIN_EVAL_SET || null,
    runUrl: ci ? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
  };
}

export function evalRow(out: PromptfooOutput, summary: Summary, ctx: EvalContext): TablesInsert<"evals"> {
  const u = usageOf(out.results.results);
  return {
    id: ctx.id,
    at: out.results.timestamp ?? new Date().toISOString(),
    source: ctx.source,
    tag: ctx.tag,
    set_name: ctx.set,
    questions: summary.questions,
    errors: summary.errors,
    avg_ms: u.avgMs,
    models: u.models,
    tokens: { prompt: u.prompt, completion: u.completion },
    rates: summary.rates,
    thresholds: thresholdsOf(out),
    failed: summary.failed,
    run_url: ctx.runUrl,
    summary: summary.markdown,
  };
}

/** 같은 id 면 덮어씁니다 (같은 실행을 다시 요약해도 한 줄). 실패하면 이유를 돌려주고 throw 하지 않습니다 */
export async function publishEval(row: TablesInsert<"evals">): Promise<string | null> {
  try {
    const { error } = await getDb().from("evals").upsert(row);
    return error ? error.message : null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
