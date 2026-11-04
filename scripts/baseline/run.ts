/**
 * Tool 없음 기준선 (리더). 같은 질문을 같은 모델에게 tool · 증거 장부 · 검증 없이 물어본 답과 Muffin 리포트를 같은 잣대로 잽니다.
 * "tool 과 검증이 무엇을 더하는가" 를 숫자로 보여 주기 위한 것입니다 (발표용). 실제 OpenAI · tool 호출이라 로컬 전용.
 *
 *   pnpm baseline                       # 모든 세트 (범위 밖 질문 제외)
 *   pnpm baseline --set common,etf      # 세트 고르기
 *   pnpm baseline --limit 3 --depth easy
 *   pnpm baseline --no-urls             # 링크 접속 확인 생략
 *
 * 결과: docs/eval/baseline/<날짜-시각>.md (+ .json, latest.md). 요약 표 · 질문별 표 · 기준선 답 전문.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, run, RunContext } from "@openai/agents";
import { modelFor, modelSettingsFor } from "../../src/agent/models";
import { research } from "../../src/agent/muffin";
import { depths, type Depth } from "../../src/agent/schema";
import { QUESTIONS_DIR, loadAllQuestionSets, loadQuestionSet, type Question } from "../questions/schema";
import { analyzeAnswer, analyzeReport, baselineInstructions, checkUrls, renderMarkdown, type Row, type Tokens, type UrlCheck } from "./lib";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 없으면 OPENAI_API_KEY 누락으로 실패
}

const OUT_DIR = "docs/eval/baseline";
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sets = opt("set")
  ? opt("set")!.split(",").map((s) => loadQuestionSet(join(QUESTIONS_DIR, `${s.trim()}.json`)))
  : loadAllQuestionSets();
const depthOpt = opt("depth") as Depth | undefined;
if (depthOpt && !depths.includes(depthOpt)) throw new Error(`depth 는 ${depths.join(" · ")} 중 하나`);
const limit = Number(opt("limit") ?? 0) || undefined;
const concurrency = Number(opt("concurrency") ?? 2) || 2;
const checkLinks = !argv.includes("--no-urls");
// 범위 밖 질문은 둘 다 데이터를 쓰지 않으니 비교 대상이 아닙니다
const questions = sets.flatMap((s) => s.questions).filter((q) => q.intent !== "out_of_scope").slice(0, limit);

/** 한국 시간 오늘 (YYYY-MM-DD) */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function baseline(q: Question, depth: Depth): Promise<{ text: string; ms: number; tokens: Tokens; model: string }> {
  const model = modelFor(depth, "write");
  const agent = new Agent({ name: "Baseline (tool 없음)", model, instructions: baselineInstructions(depth), modelSettings: modelSettingsFor("write", depth) });
  const rc = new RunContext({});
  const t0 = Date.now();
  const result = await run(agent, q.question, { context: rc });
  const text = typeof result.finalOutput === "string" ? result.finalOutput : JSON.stringify(result.finalOutput ?? "");
  return { text, ms: Date.now() - t0, tokens: { input: rc.usage.inputTokens, output: rc.usage.outputTokens }, model };
}

async function muffin(q: Question, depth: Depth): Promise<{ report: Awaited<ReturnType<typeof research>>["report"]; steps: Awaited<ReturnType<typeof research>>["steps"]; ms: number; tokens: Tokens | null; model: string }> {
  const t0 = Date.now();
  const r = await research({ question: q.question, depth, ...(q.area ? { area: q.area } : {}) }, { deadline: Number.POSITIVE_INFINITY });
  return { report: r.report, steps: r.steps, ms: Date.now() - t0, tokens: r.usage ? { input: r.usage.inputTokens, output: r.usage.outputTokens } : null, model: r.model ?? modelFor(depth, "write") };
}

async function measure(q: Question): Promise<Row> {
  const depth = depthOpt ?? q.depth;
  const [b, m] = await Promise.allSettled([baseline(q, depth), muffin(q, depth)]);
  if (b.status === "rejected") {
    const error = b.reason instanceof Error ? b.reason.message : String(b.reason);
    return { id: q.id, question: q.question, ...(q.area ? { area: q.area } : {}), depth, baseline: { ...analyzeAnswer("", { today, ms: 0, tokens: null, model: modelFor(depth, "write") }), text: "", urlChecks: [] }, muffin: null, error: `기준선 실패: ${error}` };
  }
  const bm = analyzeAnswer(b.value.text, { today, ms: b.value.ms, tokens: b.value.tokens, model: b.value.model });
  const noChecks: UrlCheck[] = [];
  if (m.status === "rejected") {
    const error = m.reason instanceof Error ? m.reason.message : String(m.reason);
    return { id: q.id, question: q.question, ...(q.area ? { area: q.area } : {}), depth, baseline: { ...bm, text: b.value.text, urlChecks: noChecks }, muffin: null, error: `Muffin 실패: ${error}` };
  }
  const mm = analyzeReport(m.value.report, { today, ms: m.value.ms, tokens: m.value.tokens, model: m.value.model });
  const [bChecks, mChecks] = checkLinks ? await Promise.all([checkUrls(bm.urls), checkUrls(mm.urls)]) : [noChecks, noChecks];
  return {
    id: q.id,
    question: q.question,
    ...(q.area ? { area: q.area } : {}),
    depth,
    baseline: { ...bm, text: b.value.text, urlChecks: bChecks },
    muffin: {
      ...mm,
      urlChecks: mChecks,
      toolsOk: m.value.steps.filter((s) => s.status === "ok" && s.fallbackAgeMs === undefined).length,
      toolsFailed: m.value.steps.filter((s) => s.status === "error").length,
      fallbacks: m.value.steps.filter((s) => s.fallbackAgeMs !== undefined).length,
    },
  };
}

async function main() {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const label = opt("set") ?? "전체";
  console.log(`Tool 없음 기준선 vs Muffin · 질문 ${questions.length}개 (${label}) · 동시 ${concurrency}`);
  const rows: Row[] = new Array(questions.length);
  let next = 0;
  const worker = async () => {
    while (next < questions.length) {
      const i = next++;
      const q = questions[i]!;
      const t0 = Date.now();
      rows[i] = await measure(q);
      const r = rows[i]!;
      console.log(
        r.muffin
          ? `  ✓ ${q.id}  기준선 숫자 ${r.baseline.numbers} · 링크 ${r.baseline.urls.length} · 권유 ${r.baseline.advice} | Muffin 숫자 ${r.muffin.numbers} (확인 카드 ${r.muffin.verifiable}/${r.muffin.cards}) · 링크 ${r.muffin.urls.length}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`
          : `  ✗ ${q.id}  ${r.error}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, questions.length) }, worker));

  const muffinModel = rows.find((r) => r.muffin)?.muffin?.model ?? modelFor("standard", "write");
  const baselineModel = rows.find((r) => r.baseline.model)?.baseline.model ?? modelFor("standard", "write");
  const markdown = renderMarkdown(rows, { today, label, muffinModel, baselineModel });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${stamp}.md`), markdown);
  writeFileSync(join(OUT_DIR, "latest.md"), markdown);
  writeFileSync(join(OUT_DIR, `${stamp}.json`), `${JSON.stringify({ today, label, rows }, null, 2)}\n`);
  console.log(`\n${markdown.split("\n## 질문별")[0]}\n저장: ${OUT_DIR}/${stamp}.md`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
