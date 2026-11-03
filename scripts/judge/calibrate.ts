/**
 * 근거 판정 보정. 사람이 정답(expected)을 매긴 쌍(scripts/judge/pairs.json)을 모델에 판정시켜 얼마나 맞는지 잽니다.
 * 실제 OpenAI 호출이라 로컬 전용입니다 (키는 .env.local).
 *
 *   pnpm judge                              # pairs.json 전부, 쌍마다 1번
 *   pnpm judge --file docs/eval/x.json      # 다른 파일 (같은 형식, expected 가 있어야 함)
 *   pnpm judge --limit 20                   # 앞 20쌍만
 *   pnpm judge --repeat 3                   # 쌍마다 3번 돌려 흔들림(같은 쌍에 다른 답)도 셉니다
 *
 * 결과: 터미널 표 + docs/eval/judge-<날짜-시각>.md (gitignore). 정확도 · 정답별 재현율 · 혼동표 · 틀린 쌍의 이유.
 * 목표(README 3단계): 한국어 150~200쌍에서 보정한 뒤 실행 중에도 켭니다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createJudgeAgent, judgeVerdicts, judgeWhy, type JudgeVerdict } from "../../src/agent/judge";
import { PAIRS_PATH, loadPairs, type Pair } from "./schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 없으면 OPENAI_API_KEY 누락으로 실패
}

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** failed 는 모델 호출 실패(키 · 네트워크)라 정확도에 넣지 않고 따로 셉니다. missing 은 모델이 답을 빠뜨린 것입니다. */
type Got = JudgeVerdict | "skipped" | "missing" | "failed";
type Row = { pair: Pair; got: Got; reason: string; ms: number };

async function judgePair(pair: Pair, agent: ReturnType<typeof createJudgeAgent>): Promise<Row> {
  const started = Date.now();
  const results = await judgeWhy([{ claim: pair.claim, evidence: pair.evidence, basis: pair.basis, refs: pair.refs }], pair.ledger, agent);
  const first = results?.[0];
  return { pair, got: first ? first.verdict : "failed", reason: first?.reason ?? "모델 실패", ms: Date.now() - started };
}

async function main() {
  const all = loadPairs(opt("file") ?? PAIRS_PATH);
  const limit = Number(opt("limit") ?? all.length);
  const repeat = Math.max(1, Number(opt("repeat") ?? 1));
  const pairs = all.slice(0, limit);
  const agent = createJudgeAgent();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  console.log(`근거 판정 보정: ${pairs.length}쌍 × ${repeat}회 (모델 ${agent.model})\n`);

  const rows: Row[] = [];
  for (const pair of pairs) {
    for (let k = 0; k < repeat; k++) {
      const row = await judgePair(pair, agent);
      // 첫 호출부터 실패하면 키 · 네트워크 문제일 가능성이 커서 바로 멈춥니다 (0% 로 잘못 읽히지 않게).
      if (row.got === "failed" && rows.length === 0) throw new Error(`첫 쌍(${pair.id})부터 모델 호출이 실패했습니다. OPENAI_API_KEY 와 네트워크를 확인하세요`);
      rows.push(row);
      const ok = row.got === pair.expected;
      const mark = row.got === "failed" ? "⚠️" : ok ? "✅" : "❌";
      console.log(`${mark} ${pair.id}${repeat > 1 ? ` #${k + 1}` : ""}: 정답 ${pair.expected} · 판정 ${row.got} (${row.ms}ms)${ok ? "" : ` — ${row.reason}`}`);
    }
  }

  // 정확도(호출 실패 제외) · 정답별 재현율 · 혼동표
  const failed = rows.filter((r) => r.got === "failed").length;
  const scored = rows.filter((r) => r.got !== "failed");
  const correct = scored.filter((r) => r.got === r.pair.expected).length;
  const gots: Got[] = [...judgeVerdicts, "skipped", "missing", "failed"];
  const confusion = judgeVerdicts.map((expected) => {
    // 재현율도 호출 실패를 뺀 것으로 (실패는 모델 판정이 아니라 환경 문제)
    const mine = scored.filter((r) => r.pair.expected === expected);
    return { expected, total: mine.length, counts: gots.map((g) => mine.filter((r) => r.got === g).length) };
  });
  const avgMs = rows.length ? Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length) : 0;
  // 같은 쌍을 여러 번 돌렸을 때 답이 갈린 쌍
  const wobbly = repeat > 1 ? pairs.filter((p) => new Set(rows.filter((r) => r.pair.id === p.id).map((r) => r.got)).size > 1).map((p) => p.id) : [];

  const lines = [
    `# 근거 판정 보정 ${stamp}`,
    "",
    `쌍 ${pairs.length}개 × ${repeat}회 = ${rows.length}번, 모델 ${agent.model}, 평균 ${avgMs}ms${failed ? `, 호출 실패 ${failed}번 (정확도에서 뺌)` : ""}`,
    "",
    `**정확도 ${scored.length ? ((correct / scored.length) * 100).toFixed(1) : "0.0"}% (${correct}/${scored.length})**`,
    "",
    `| 정답 \\ 판정 | ${gots.join(" | ")} | 재현율 |`,
    `|---|${gots.map(() => "---").join("|")}|---|`,
    ...confusion.map((c) => {
      const hit = c.counts[judgeVerdicts.indexOf(c.expected)] ?? 0;
      return `| ${c.expected} (${c.total}) | ${c.counts.join(" | ")} | ${c.total ? ((hit / c.total) * 100).toFixed(0) : "-"}% |`;
    }),
    "",
    ...(repeat > 1 ? [`같은 쌍에 다른 답이 나온 쌍: ${wobbly.length}개${wobbly.length ? ` (${wobbly.join(", ")})` : ""}`, ""] : []),
    "## 틀린 쌍",
    "",
    ...(rows.filter((r) => r.got !== r.pair.expected).map((r) => `- ${r.pair.id}: 정답 ${r.pair.expected} · 판정 ${r.got} — ${r.reason}${r.pair.note ? ` (정답 이유: ${r.pair.note})` : ""}`) || ["- (없음)"]),
    "",
    "## 전체",
    "",
    "| 쌍 | 영역 | 정답 | 판정 | 이유 |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.pair.id} | ${r.pair.area} | ${r.pair.expected} | ${r.got === r.pair.expected ? "✅" : "❌"} ${r.got} | ${r.reason.replace(/\|/g, "/")} |`),
  ];
  mkdirSync("docs/eval", { recursive: true });
  const path = `docs/eval/judge-${stamp}.md`;
  writeFileSync(path, lines.join("\n"));
  console.log(`\n${lines.slice(4, 5 + 3 + judgeVerdicts.length).join("\n")}\n\n저장: ${path}`);
  if (failed) {
    console.error(`\n모델 호출이 ${failed}번 실패해 보정을 다 돌리지 못했습니다.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
