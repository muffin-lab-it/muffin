/**
 * 리포트 품질 평가. 고정 질문 세트(scripts/questions/*.json)를 돌려 한 파일에 모읍니다. 실제 OpenAI·tool 호출이라 로컬 전용.
 *
 *   pnpm eval                                  # 모든 세트, 질문마다 적힌 depth 로
 *   pnpm eval --set fx                         # 세트 하나
 *   pnpm eval --set common --depth deep        # 깊이 지정 (all 이면 세 깊이 모두)
 *   pnpm eval --question "KODEX 200 요즘 어때?" --area etf
 *   pnpm eval --questions my-questions.json    # 임시 파일. [{ question, area }] 배열
 *
 * 결과: docs/eval/<날짜-시각>.md (gitignore). 리포트 전문 + 사용한 tool + 자동 점검 결과.
 * 질문 세트의 형식과 담당은 scripts/questions/README.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findAdvice } from "../src/agent/guard";
import { research, type ResearchResult, TIME_BUDGET_MS } from "../src/agent/muffin";
import { depths, type Area, type Depth, type Report, type intents } from "../src/agent/schema";
import { QUESTIONS_DIR, loadAllQuestionSets, loadQuestionSet } from "./questions/schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 없으면 OPENAI_API_KEY 누락으로 실패
}

/** 세트 파일의 질문. --question / --questions 로 넘긴 임시 질문은 question 과 area 만 있습니다. */
type Q = {
  question: string;
  area?: Area | null;
  depth?: Depth;
  intent?: (typeof intents)[number];
  expectTools?: string[];
};

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function loadQuestions(): Q[] {
  if (opt("question")) return [{ question: opt("question")!, area: opt("area") as Area | undefined }];
  if (opt("questions")) return JSON.parse(readFileSync(opt("questions")!, "utf8")) as Q[];
  const sets = opt("set") ? [loadQuestionSet(join(QUESTIONS_DIR, `${opt("set")}.json`))] : loadAllQuestionSets();
  return sets.flatMap((s) => s.questions);
}

const questions = loadQuestions();
const depthOpt = opt("depth");
function depthsFor(q: Q): Depth[] {
  if (depthOpt === "all") return [...depths];
  if (depthOpt) return [depthOpt as Depth];
  return [q.depth ?? "standard"];
}

/** 조사 Agent 가 질문에 맞는 tool 을 골랐는지. expectTools 가 모두 호출됐으면 ✅, 범위 밖 질문은 tool 을 안 불렀을 때 ✅. */
function toolMatch(q: Q, steps: { tool: string }[]): string {
  const called = new Set(steps.map((s) => s.tool));
  if (q.intent === "out_of_scope") return called.size === 0 ? "✅" : `❌ ${[...called].join(",")}`;
  if (!q.expectTools?.length) return "-";
  const missing = q.expectTools.filter((t) => !called.has(t));
  return missing.length === 0 ? "✅" : `❌ ${missing.join(",")} 없음`;
}

/** 📋 분류가 질문 세트에 적힌 의도와 같은지. 분류 담당(서영)의 점수입니다. 세트에 intent 가 없으면 -. */
function intentMatch(q: Q, plan: ResearchResult["plan"]): string {
  if (!q.intent) return "-";
  return plan.intent === q.intent ? "✅" : `❌ ${plan.intent}`;
}

/** 사람이 볼 때 같이 보는 자동 점검. 점수가 아니라 "눈여겨볼 것" 표시입니다. */
function checks(report: Report, steps: { status: string }[]) {
  const ids = new Set(report.evidence.map((e) => e.id));
  const cited = [...report.numbers.map((n) => n.ref).filter((r): r is string => !!r), ...report.why.flatMap((w) => w.refs)];
  return {
    toolsOk: steps.filter((s) => s.status === "ok").length,
    toolsFailed: steps.filter((s) => s.status === "error").length,
    /** 검증을 통과해 남은 숫자 (✓ 장부 일치 / C 계산) 와 검증 실패로 뺀 숫자 */
    verified: report.verification.numbers.verified,
    derived: report.verification.numbers.derived,
    removedNumbers: report.verification.removed.filter((r) => r.startsWith("숫자 ")).length,
    status: report.verification.status,
    whyTotal: report.why.length,
    whyBasis: report.verification.why,
    /** 장부에 없는 id 를 인용한 횟수 (지어낸 id) */
    badRefs: cited.filter((id) => !ids.has(id)).length,
    gaps: report.dataGaps.length,
    sources: report.sources.length,
    advice: findAdvice(report).length,
  };
}

/** 📋 분류와 ✂️ 정제가 무엇을 했는지. 리포트에는 없지만 담당자가 자기 단계를 고칠 때 봐야 하는 것입니다. */
function renderStages({ plan, facts }: Pick<ResearchResult, "plan" | "facts">): string {
  const factLines = facts
    ? [
        ...facts.facts.map((f) => `- ${f.ref}: ${f.fact}`),
        ...facts.dropped.map((d) => `- (뺌) ${d.ref}: ${d.reason}`),
        ...facts.unverified.map((u) => `- (확인 못 함) ${u}`),
      ].join("\n") || "- (사실 없음)"
    : "- (정제 실패 · 작성이 장부 전체를 봄)";
  return [
    `**분류**\n- 의도 ${plan.intent} · 모드 ${plan.mode} · tool ${plan.tools.join(", ") || "(없음)"}\n- ${plan.reason}`,
    `**정제**\n${factLines}`,
  ].join("\n\n");
}

function render(report: Report): string {
  const li = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (없음)");
  return [
    `**한입 요약**\n${report.summary}`,
    `**오늘의 숫자**\n${report.numbers.map((n) => `- ${n.label}: ${n.value} ${n.change} (${n.asOf}) [${n.ref ?? "ref 없음"} · ${n.check}]`).join("\n") || "- (없음)"}`,
    `**왜 그럴까요**\n${report.why.map((w) => `- ${w.claim}\n  - 근거(${w.basis}${w.refs.length ? ` ${w.refs.join(",")}` : ""}): ${w.evidence}`).join("\n") || "- (없음)"}`,
    `**나에게 미치는 영향**\n${li(report.impact)}`,
    `**주의점**\n${li(report.caveats)}`,
    `**확인하지 못한 것**\n${li(report.dataGaps)}`,
    `**출처**\n${report.sources.map((s) => `- ${s.id} ${s.name} · ${s.asOf} · ${s.url}`).join("\n") || "- (없음)"}`,
    `**증거 장부**\n${report.evidence.map((e) => `- ${e.id} ${e.label}: ${JSON.stringify(e.values)}`).join("\n") || "- (없음)"}`,
    `**검증**\n${JSON.stringify(report.verification)}`,
    `**더해볼 것**\n${report.nextTopics.join(" · ") || "(없음)"}`,
  ].join("\n\n");
}

async function main() {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const runs = questions.reduce((n, q) => n + depthsFor(q).length, 0);
  const out: string[] = [`# 리포트 평가 ${stamp}\n`, `질문 ${questions.length}개, 실행 ${runs}회${opt("set") ? ` (세트: ${opt("set")})` : ""}\n`];
  const summary: string[] = [
    "| 질문 | 깊이 | 의도 | tool ok/실패 | tool 선택 | 숫자 ✓/C/제거 | why 📊/📰/❔ | 지어낸 ref | 빈칸 | 출처 | 권유 | 수정 | 검증 | 시간 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];

  for (const q of questions) {
    for (const depth of depthsFor(q)) {
      const label = `${q.question} [${depth}]`;
      process.stdout.write(`▶ ${label} … `);
      const started = Date.now();
      try {
        // 평가는 품질을 보려는 것이라 마감 없이 돌립니다 (다시 쓰기를 건너뛰지 않음). 걸린 시간은 아래에 적습니다.
        const result = await research({ question: q.question, depth, area: q.area ?? undefined }, { deadline: Number.POSITIVE_INFINITY });
        const { report, steps, rewrites } = result;
        const c = checks(report, steps);
        const match = toolMatch(q, steps);
        const intent = intentMatch(q, result.plan);
        const sec = ((Date.now() - started) / 1000).toFixed(1);
        console.log(
          `${sec}s${Number(sec) * 1000 > TIME_BUDGET_MS ? " (서비스 마감 55초 초과)" : ""}, 의도 ${result.plan.intent} ${intent}, tool ${c.toolsOk}/${c.toolsFailed} ${match}, 숫자 ✓${c.verified} C${c.derived} 제거${c.removedNumbers}, 검증 ${c.status}, 권유 ${c.advice}`,
        );
        summary.push(
          `| ${q.question} | ${depth} | ${intent} | ${c.toolsOk}/${c.toolsFailed} | ${match} | ${c.verified}/${c.derived}/${c.removedNumbers} | ${c.whyBasis.data}/${c.whyBasis.news}/${c.whyBasis.none} | ${c.badRefs} | ${c.gaps} | ${c.sources} | ${c.advice} | ${rewrites} | ${c.status} | ${sec}s |`,
        );
        out.push(
          `\n---\n\n## ${label}\n\n사용한 tool: ${steps.map((s) => `${s.status === "ok" ? "✅" : "❌"} ${s.tool} ${s.ms}ms${s.error ? ` (${s.error})` : ""}`).join(", ") || "(없음)"}\n\n${renderStages(result)}\n\n${render(report)}\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`실패: ${msg}`);
        summary.push(`| ${q.question} | ${depth} | 실패 | | | | | | | | | | | |`);
        out.push(`\n---\n\n## ${label}\n\n실패: ${msg}\n`);
      }
    }
  }

  mkdirSync("docs/eval", { recursive: true });
  const path = `docs/eval/${stamp}.md`;
  writeFileSync(path, [out[0], out[1], summary.join("\n"), ...out.slice(2)].join("\n"));
  console.log(`\n저장: ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
