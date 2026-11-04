/**
 * Promptfoo 평가 실행 (리더). `pnpm eval:promptfoo` 가 부릅니다. promptfoo 를 고정 버전으로 pnpm dlx 해 돌리고,
 * 결과 JSON 을 요약(summary.ts)해 docs/eval/promptfoo/ 에 남깁니다. 기준 아래 지표나 오류가 있으면 exit 1 (GitHub Action 이 실패로 표시).
 *
 *   pnpm eval:promptfoo                        # 모든 세트, 질문마다 적힌 depth 로
 *   pnpm eval:promptfoo --set common,etf       # 세트 고르기
 *   pnpm eval:promptfoo --depth all            # 세 깊이 모두 (easy · standard · deep 하나만도 됨)
 *   pnpm eval:promptfoo --no-judge             # 근거 판정(모델) 없이
 *   pnpm eval:promptfoo --concurrency 1        # 동시에 돌리는 질문 수 (기본은 설정 파일의 2)
 *   pnpm eval:promptfoo --baseline x.json      # 나란히 볼 지난 결과 (기본: docs/eval/promptfoo/latest.json)
 *
 * 모델 비교 (같은 세트를 다른 모델로 돌려 나란히):
 *   pnpm eval:promptfoo --model gpt-6-sol --tag sol --baseline docs/eval/promptfoo/<기본 모델 결과>.json
 *   --model 은 조사 · 작성 모델을 모든 깊이에서 바꾸고(OPENAI_MODEL · OPENAI_MODEL_DEEP), --small-model 은 분류 · 정제(OPENAI_MODEL_SMALL).
 *   --tag 가 있으면 결과 파일 이름에 붙고 latest.json 은 갱신하지 않습니다 (주간 비교 기준을 흐리지 않게).
 *
 * 결과 요약은 Supabase evals 표에도 한 줄 넣어 /admin 품질 평가 패널에 보입니다 (SUPABASE_URL · SUPABASE_SECRET_KEY 가 있을 때, --no-publish 로 끔).
 * 명령줄 · 환경 변수 · 실패 판단은 runner.ts, 표에 넣는 것은 publish.ts (테스트 있음).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { dbEnabled } from "../../src/lib/db";
import { evalContext, evalRow, publishEval } from "./publish";
import { experimentTag, OUT_DIR, PROMPTFOO_VERSION, promptfooArgs, promptfooEnv, runFailure } from "./runner";
import { summarize, type PromptfooOutput } from "./summary";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Action 에서는 secrets 가 환경 변수로 들어옵니다
}

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main(): Promise<number> {
  mkdirSync(OUT_DIR, { recursive: true });
  // 세트 · 깊이는 Action 이 환경 변수로도 넘깁니다 (workflow_dispatch 입력)
  const opts = {
    set: opt("set") || process.env.MUFFIN_EVAL_SET || undefined,
    depth: opt("depth") || process.env.MUFFIN_EVAL_DEPTH || undefined,
    judge: !argv.includes("--no-judge"),
    concurrency: opt("concurrency"),
    model: opt("model"),
    smallModel: opt("small-model"),
  };
  // 깊이 · 모델을 바꾼 실행은 자동으로 실험 이름이 붙어 주간 비교 기준(latest.json)과 주간 평가 줄에 섞이지 않습니다
  const tag = experimentTag(opt("tag"), opts)?.replace(/[^a-z0-9._-]/gi, "");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "") + (tag ? `-${tag}` : "");
  const outPath = `${OUT_DIR}/${stamp}.json`;
  const latest = `${OUT_DIR}/latest.json`;
  // 지난 결과는 기본으로 latest.json (이번 결과가 끝나면 그 자리에 들어감). Action 은 이 파일을 cache 로 주고받습니다.
  const baselinePath = opt("baseline") ?? latest;
  const baseline = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as PromptfooOutput) : undefined;
  const baselineLabel = opt("baseline") ? basename(baselinePath, ".json") : "지난 번";
  // 같은 분(分)에 다시 돌리면 경로가 같으므로, 이전 파일을 지워 이번 실행의 결과만 읽게 합니다
  rmSync(outPath, { force: true });

  const args = promptfooArgs(outPath, opts);
  console.log(`▶ promptfoo ${PROMPTFOO_VERSION}: ${args.slice(4).join(" ")}${opts.model ? `\n  모델: 조사 · 작성 ${opts.model}` : ""}${opts.smallModel ? `\n  모델: 분류 · 정제 ${opts.smallModel}` : ""}${baseline ? `\n  비교: ${baselinePath}` : ""}`);
  const run = spawnSync("pnpm", args, { stdio: "inherit", env: promptfooEnv(process.env, opts) as NodeJS.ProcessEnv });
  const failure = runFailure(run, existsSync(outPath));
  if (failure) {
    console.error(failure);
    return 1;
  }

  const out = JSON.parse(readFileSync(outPath, "utf8")) as PromptfooOutput;
  const summary = summarize(out, { baseline, baselineLabel, title: `리포트 평가 (Promptfoo${tag ? ` · ${tag}` : ""})` });
  const mdPath = `${OUT_DIR}/${stamp}.md`;
  writeFileSync(mdPath, summary.markdown);
  // 이번 실행의 요약은 항상 current.md 에도 둡니다 (Action 이 기준 미달 이슈 본문으로 씀 — 세트 일부 · 실험 실행도 포함)
  writeFileSync(`${OUT_DIR}/current.md`, summary.markdown);
  // 주간 비교 기준은 전체 세트를 기본 설정으로 돌린 결과만. 세트 일부 · 실험은 파일로만 남깁니다
  if (!tag && !opts.set) {
    copyFileSync(outPath, latest);
    copyFileSync(mdPath, `${OUT_DIR}/latest.md`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.markdown}\n`);
  console.log(`\n${summary.markdown}\n저장: ${mdPath} (JSON ${outPath}). 질문별 리포트 전문: pnpm dlx promptfoo@${PROMPTFOO_VERSION} view`);
  // evals 표에 요약 한 줄 (/admin 품질 평가). 넣지 못해도 평가 결과는 그대로입니다.
  if (!argv.includes("--no-publish") && dbEnabled()) {
    const row = evalRow(out, summary, evalContext(process.env, stamp, tag, opts.set, out.evalId));
    const problem = await publishEval(row);
    console.log(problem ? `evals 표에 넣지 못했습니다: ${problem}` : `evals 표에 기록했습니다: ${row.id} (/admin 품질 평가)`);
  }
  return summary.failed.length > 0 || summary.errors > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
