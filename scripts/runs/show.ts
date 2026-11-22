/**
 * 저장된 실행(runs 표)의 리포트 본문을 꺼내 봅니다 (리더, 11/21). 베타 테스터가 받은 리포트를 그대로 다시 보는 용도입니다.
 *
 *   pnpm tool scripts/runs/show.ts                 최근 20건 목록 (요청 id · 시각 · 질문 · 한 줄 요약)
 *   pnpm tool scripts/runs/show.ts --since 2026-11-21 --limit 50
 *   pnpm tool scripts/runs/show.ts <요청 id>        그 실행의 리포트 · 정제 결과 전문
 *   pnpm tool scripts/runs/show.ts <요청 id> --json  원본 JSON
 *
 * SUPABASE_URL · SUPABASE_SECRET_KEY 가 .env.local 에 있어야 합니다. 본문은 11/21 마이그레이션(20261121090000) 뒤의 실행에만 있습니다.
 */
import { dbEnabled, getDb } from "../../src/lib/db";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 환경 변수가 이미 있으면 그대로 씁니다
}

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const id = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const kst = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const one = (s: string | undefined | null, max = 70) => (s ?? "").replace(/\s+/g, " ").slice(0, max);

async function main() {
  if (!dbEnabled()) throw new Error("SUPABASE_URL · SUPABASE_SECRET_KEY 가 없습니다 (.env.local 확인)");
  const db = getDb();
  if (!id) {
    let q = db.from("runs").select("id, at, ok, stage, intent, ms, rewrites, input, report").eq("mock", false).order("at", { ascending: false }).limit(Number(flag("limit") ?? 20));
    const since = flag("since");
    if (since) q = q.gte("at", new Date(`${since}T00:00:00+09:00`).toISOString());
    const { data, error } = await q;
    if (error) throw new Error(/report/.test(error.message) ? "runs 표에 report 칸이 없습니다. supabase/migrations/20261121090000_runs_report.sql 을 먼저 적용하세요." : error.message);
    for (const r of data ?? []) {
      const head = r.report ? one(r.report.headline ?? r.report.summary, 60) : r.ok ? "(본문 없음)" : `(${r.stage})`;
      console.log(`${r.id}  ${kst(r.at)}  ${String(r.intent ?? "-").padEnd(12)} ${(r.ms / 1000).toFixed(0).padStart(2)}s  ${one(r.input?.question, 34).padEnd(34)}  ${head}`);
    }
    return;
  }
  const { data, error } = await db.from("runs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`요청 id ${id} 인 실행이 없습니다`);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const r = data.report;
  console.log(`# ${data.input?.question ?? ""}`);
  console.log(`${kst(data.at)} · ${data.input?.depth ?? ""}${data.input?.area ? ` · ${data.input.area}` : ""} · 의도 ${data.intent ?? "-"} · ${(data.ms / 1000).toFixed(0)}초 · 다시 쓰기 ${data.rewrites ?? 0}회 · ${data.ok ? "성공" : `실패(${data.stage}: ${data.error ?? ""})`}`);
  for (const reason of data.quality?.rewriteReasons ?? []) console.log(`다시 쓰기 이유: ${reason}`);
  console.log(`tool: ${(data.steps ?? []).map((s) => `${s.tool}${s.status === "ok" ? "" : "(실패)"}`).join(", ") || "-"}`);
  if (!r) {
    console.log("\n(이 실행에는 리포트 본문이 저장되지 않았습니다)");
    return;
  }
  if (r.notice) console.log(`\n안내: ${r.notice}`);
  if (r.headline) console.log(`\n한 줄: ${r.headline}`);
  console.log(`\n${r.summary}`);
  if (r.numbers.length) console.log(`\n오늘의 숫자\n${r.numbers.map((n) => `- ${n.label} | ${n.value} | ${n.change || "-"} | ${n.asOf || "-"} | ${n.check}`).join("\n")}`);
  if (r.why.length) console.log(`\n숫자 너머의 이야기\n${r.why.map((w) => `- [${w.basis}] ${w.claim}`).join("\n")}`);
  if (r.impact.length) console.log(`\n내 생활에 미치는 영향\n${r.impact.map((x) => `- ${x}`).join("\n")}`);
  if (r.caveats.length) console.log(`\n주의점\n${r.caveats.map((x) => `- ${x}`).join("\n")}`);
  if (r.dataGaps.length) console.log(`\n확인하지 못한 것\n${r.dataGaps.map((x) => `- ${x}`).join("\n")}`);
  if (r.charts?.length) console.log(`\n차트: ${r.charts.map((c) => c.title).join(", ")}`);
  const f = data.facts;
  if (f) {
    console.log(`\n--- 정제 결과 ---\n사실 ${f.facts.length}개\n${f.facts.map((x) => `- ${x.ref}: ${x.fact}`).join("\n")}`);
    if (f.dropped.length) console.log(`뺀 자료 ${f.dropped.length}개\n${f.dropped.map((x) => `- ${x.ref}: ${x.reason}`).join("\n")}`);
    if (f.unverified.length) console.log(`확인하지 못한 것 ${f.unverified.length}개\n${f.unverified.map((x) => `- ${x}`).join("\n")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
