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
 * 명령줄 · 환경 변수 · 실패 판단은 runner.ts (테스트 있음).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { OUT_DIR, PROMPTFOO_VERSION, promptfooArgs, promptfooEnv, runFailure } from "./runner";
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

function main(): number {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const outPath = `${OUT_DIR}/${stamp}.json`;
  const latest = `${OUT_DIR}/latest.json`;
  // 지난 결과는 기본으로 latest.json (이번 결과가 끝나면 그 자리에 들어감). Action 은 이 파일을 cache 로 주고받습니다.
  const baselinePath = opt("baseline") ?? latest;
  const baseline = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as PromptfooOutput) : undefined;
  // 같은 분(分)에 다시 돌리면 경로가 같으므로, 이전 파일을 지워 이번 실행의 결과만 읽게 합니다
  rmSync(outPath, { force: true });

  const opts = { set: opt("set"), depth: opt("depth"), judge: !argv.includes("--no-judge"), concurrency: opt("concurrency") };
  const args = promptfooArgs(outPath, opts);
  console.log(`▶ promptfoo ${PROMPTFOO_VERSION}: ${args.slice(4).join(" ")}${baseline ? `\n  지난 결과: ${baselinePath}` : ""}`);
  const run = spawnSync("pnpm", args, { stdio: "inherit", env: promptfooEnv(process.env, opts) as NodeJS.ProcessEnv });
  const failure = runFailure(run, existsSync(outPath));
  if (failure) {
    console.error(failure);
    return 1;
  }

  const out = JSON.parse(readFileSync(outPath, "utf8")) as PromptfooOutput;
  const summary = summarize(out, { baseline });
  const mdPath = `${OUT_DIR}/${stamp}.md`;
  writeFileSync(mdPath, summary.markdown);
  copyFileSync(outPath, latest);
  copyFileSync(mdPath, `${OUT_DIR}/latest.md`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.markdown}\n`);
  console.log(`\n${summary.markdown}\n저장: ${mdPath} (JSON ${outPath}). 질문별 리포트 전문: pnpm dlx promptfoo@${PROMPTFOO_VERSION} view`);
  return summary.failed.length > 0 || summary.errors > 0 ? 1 : 0;
}

process.exit(main());
