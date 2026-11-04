/**
 * run.ts 가 쓰는 순수 함수 (리더). promptfoo 명령줄 · 환경 변수 만들기와 "이번 실행이 제대로 끝났는가" 판단을 모아 테스트합니다.
 * promptfoo 는 설치 크기(536개 패키지 · 약 680MB) 때문에 package.json 에 넣지 않고 아래 버전으로 pnpm dlx 합니다 (scripts/promptfoo/README.md).
 */
export const PROMPTFOO_VERSION = "0.125.1";
export const CONFIG = "scripts/promptfoo/promptfooconfig.yaml";
export const OUT_DIR = "docs/eval/promptfoo";

export type RunOptions = {
  set?: string;
  depth?: string;
  judge?: boolean;
  concurrency?: string;
  /** 조사 · 작성 모델을 모든 깊이에서 이 값으로 (OPENAI_MODEL · OPENAI_MODEL_DEEP). 모델 비교용 */
  model?: string;
  /** 분류 · 정제 모델 (OPENAI_MODEL_SMALL) */
  smallModel?: string;
};

/** `pnpm --silent dlx promptfoo@<버전> eval …`. --silent 는 dlx 가 설치하며 찍는 peer 의존성 경고를 숨깁니다 (promptfoo 출력은 그대로) */
export function promptfooArgs(outPath: string, opts: RunOptions = {}): string[] {
  const args = ["--silent", "dlx", `promptfoo@${PROMPTFOO_VERSION}`, "eval", "-c", CONFIG, "-o", outPath, "--no-cache", "--no-progress-bar", "--no-share", "--no-table"];
  if (opts.concurrency) args.push("-j", opts.concurrency);
  return args;
}

/**
 * promptfoo 에 넘길 환경 변수. 채점 실패는 exit 0 으로 두고(PROMPTFOO_FAILED_TEST_EXIT_CODE) 기준 판단은 summary 가 합니다.
 * 그래서 exit 가 0 이 아니면 설치 · 설정 · 생성기 오류 같은 진짜 실패입니다.
 */
export type Env = Record<string, string | undefined>;

export function promptfooEnv(base: Env, opts: RunOptions = {}): Env {
  const env: Env = { ...base, PROMPTFOO_DISABLE_TELEMETRY: "1", PROMPTFOO_DISABLE_UPDATE: "1", PROMPTFOO_FAILED_TEST_EXIT_CODE: "0" };
  if (opts.set) env.MUFFIN_EVAL_SET = opts.set;
  if (opts.depth) env.MUFFIN_EVAL_DEPTH = opts.depth;
  if (opts.judge === false) env.MUFFIN_EVAL_NO_JUDGE = "1";
  // 모델 비교: provider 가 돌리는 research 는 models.ts 를 거쳐 이 환경 변수로 모델을 고릅니다
  if (opts.model) {
    env.OPENAI_MODEL = opts.model;
    env.OPENAI_MODEL_DEEP = opts.model;
  }
  if (opts.smallModel) env.OPENAI_MODEL_SMALL = opts.smallModel;
  return env;
}

/**
 * 실험 이름(tag). --tag 가 없어도 깊이 · 모델을 바꾼 실행은 기본 설정과 비교할 수 없으므로 자동으로 이름을 붙입니다.
 * tag 가 있으면 latest.json(주간 비교 기준)을 갱신하지 않고, evals 표에서도 주간 평가로 세지 않습니다.
 */
export function experimentTag(tag: string | undefined, opts: Pick<RunOptions, "depth" | "model" | "smallModel">): string | undefined {
  if (tag) return tag;
  if (opts.depth) return `depth-${opts.depth}`;
  if (opts.model) return `model-${opts.model}`;
  if (opts.smallModel) return `small-${opts.smallModel}`;
  return undefined;
}

export type SpawnOutcome = { status: number | null; signal: NodeJS.Signals | null; error?: Error };

/** 이번 실행이 실패했으면 그 이유, 제대로 끝났으면 null. 결과 파일은 실행 전에 지웠으므로 있으면 이번 것입니다 */
export function runFailure(run: SpawnOutcome, outExists: boolean): string | null {
  if (run.error) return `promptfoo 를 실행하지 못했습니다: ${run.error.message}. pnpm 이 있는지, \`pnpm dlx promptfoo@${PROMPTFOO_VERSION} --version\` 이 되는지 확인하세요`;
  if (run.status !== 0) return `promptfoo 가 실패했습니다 (exit ${run.status ?? run.signal ?? "?"}). 위 출력을 확인하세요 (아무 출력도 없으면 \`pnpm dlx promptfoo@${PROMPTFOO_VERSION} --version\` 으로 설치부터)`;
  if (!outExists) return "promptfoo 는 끝났지만 결과 파일이 없습니다. 위 출력을 확인하세요";
  return null;
}
