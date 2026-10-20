/**
 * 리포트 품질 평가. 질문 여러 개를 깊이별로 돌려 한 파일에 모읍니다. 실제 OpenAI·tool 호출이라 로컬 전용.
 *
 *   pnpm eval                                  # 기본 질문 5개 × 3 깊이
 *   pnpm eval --depth standard                 # 깊이 하나만
 *   pnpm eval --question "KODEX 200 요즘 어때?" --area etf
 *   pnpm eval --questions scripts/eval-questions.json
 *
 * 결과: docs/eval/<날짜-시각>.md (gitignore). 리포트 전문 + 사용한 tool + 자동 점검 결과.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { findAdvice } from "../src/agent/guard";
import { research } from "../src/agent/muffin";
import { depths, type Area, type Depth, type Report } from "../src/agent/schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 없으면 OPENAI_API_KEY 누락으로 실패
}

type Q = { question: string; area?: Area };

const DEFAULT_QUESTIONS: Q[] = [
  { question: "KODEX 200 요즘 어때?", area: "etf" },
  { question: "오늘 달러 환율 얼마야? 한 달 전이랑 비교하면?", area: "fx" },
  { question: "TIGER 미국S&P500 이 기초지수를 잘 따라가고 있어?", area: "etf" },
  { question: "엔화 환율이 요즘 왜 이래?", area: "fx" },
  { question: "국내 ETF 중에 최근 한 달 수익률이 어떤지 알려줘", area: "etf" },
];

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const questions: Q[] = opt("question")
  ? [{ question: opt("question")!, area: opt("area") as Area | undefined }]
  : opt("questions")
    ? (JSON.parse(readFileSync(opt("questions")!, "utf8")) as Q[])
    : DEFAULT_QUESTIONS;
const depthList: Depth[] = opt("depth") ? [opt("depth") as Depth] : [...depths];

/** 사람이 볼 때 같이 보는 자동 점검. 점수가 아니라 "눈여겨볼 것" 표시입니다. */
function checks(report: Report, steps: { status: string }[]) {
  const ids = new Set(report.evidence.map((e) => e.id));
  const cited = [...report.numbers.map((n) => n.ref).filter((r): r is string => !!r), ...report.why.flatMap((w) => w.refs)];
  return {
    toolsOk: steps.filter((s) => s.status === "ok").length,
    toolsFailed: steps.filter((s) => s.status === "error").length,
    numbers: report.numbers.length,
    /** 증거 번호를 단 숫자 수. 1단계 검증의 전제라 0단계부터 잽니다 */
    numbersRef: report.numbers.filter((n) => n.ref).length,
    whyTotal: report.why.length,
    whyBasis: report.verification.why,
    /** 장부에 없는 id 를 인용한 횟수 (지어낸 id) */
    badRefs: cited.filter((id) => !ids.has(id)).length,
    gaps: report.dataGaps.length,
    sources: report.sources.length,
    advice: findAdvice(report).length,
  };
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
  const out: string[] = [`# 리포트 평가 ${stamp}\n`, `질문 ${questions.length}개 × 깊이 ${depthList.join(", ")}\n`];
  const summary: string[] = [
    "| 질문 | 깊이 | tool ok/실패 | 숫자 (ref) | why 📊/📰/❔ | 지어낸 ref | 빈칸 | 출처 | 권유 | 재작성 | 시간 |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];

  for (const q of questions) {
    for (const depth of depthList) {
      const label = `${q.question} [${depth}]`;
      process.stdout.write(`▶ ${label} … `);
      const started = Date.now();
      try {
        const { report, steps, rewrites } = await research({ question: q.question, depth, area: q.area });
        const c = checks(report, steps);
        const sec = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`${sec}s, tool ${c.toolsOk}/${c.toolsFailed}, 권유 ${c.advice}`);
        summary.push(
          `| ${q.question} | ${depth} | ${c.toolsOk}/${c.toolsFailed} | ${c.numbers} (${c.numbersRef}) | ${c.whyBasis.data}/${c.whyBasis.news}/${c.whyBasis.none} | ${c.badRefs} | ${c.gaps} | ${c.sources} | ${c.advice} | ${rewrites} | ${sec}s |`,
        );
        out.push(
          `\n---\n\n## ${label}\n\n사용한 tool: ${steps.map((s) => `${s.status === "ok" ? "✅" : "❌"} ${s.tool} ${s.ms}ms${s.error ? ` (${s.error})` : ""}`).join(", ") || "(없음)"}\n\n${render(report)}\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`실패: ${msg}`);
        summary.push(`| ${q.question} | ${depth} | 실패 | | | | | | | | |`);
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
