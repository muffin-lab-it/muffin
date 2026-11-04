/**
 * tool 응답 캐시 예열의 순수 부분 (리더). run.ts 가 CLI 로 감쌉니다.
 * tool_cache 표의 줄(tool + 입력)을 같은 입력으로 다시 불러, 저장 응답을 갓 받은 것으로 바꿉니다. 모델은 부르지 않습니다.
 */
import type { ToolStep } from "../../src/agent/context";
import { formatAge } from "../../src/lib/age";

export type CacheRow = { key: string; tool: string; at: string };
/** refreshed 갓 받음 · fallback 조회 실패(저장 응답 유지) · skipped 회로 열림으로 건너뜀 · failed 실패(저장 응답도 없음) · unknown_tool 레지스트리에 없음 */
export type WarmOutcome = "refreshed" | "not_persisted" | "fallback" | "skipped" | "failed" | "unknown_tool";
export type WarmResult = { key: string; tool: string; input: unknown; outcome: WarmOutcome; ms: number; detail?: string };
export const outcomeLabels: Record<WarmOutcome, string> = {
  refreshed: "갱신",
  not_persisted: "받았지만 표 저장 안 됨",
  fallback: "실패 · 저장 응답 유지",
  skipped: "건너뜀 · 회로 열림",
  failed: "실패 · 저장 응답 없음",
  unknown_tool: "모르는 tool",
};

/** 키("tool:{입력 JSON}")에서 입력을 되살립니다. tool 이름에는 콜론이 없습니다 (src/tools/cache.ts 의 cacheKey) */
export function parseKey(row: CacheRow): unknown {
  const prefix = `${row.tool}:`;
  if (!row.key.startsWith(prefix)) throw new Error(`키 모양이 다릅니다: ${row.key.slice(0, 80)}`);
  return JSON.parse(row.key.slice(prefix.length));
}

/** 같은 seed 면 같은 순서인 간단한 난수 (mulberry32) */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 갱신할 줄: olderThanMs 보다 오래된 것만 max 개. 순서는 seed 로 섞습니다 — 오래된 순으로 고르면 계속 실패하는 줄(at 이 안 바뀜)이
 * 매번 앞을 차지해 뒤의 줄이 영영 갱신되지 않으므로, 실행마다 다른 줄이 걸리게 합니다. seed 를 안 주면 오래된 순 (테스트 · dry 용)
 */
export function selectRows(rows: CacheRow[], { olderThanMs, max, now = Date.now(), seed }: { olderThanMs: number; max: number; now?: number; seed?: number }): CacheRow[] {
  const eligible = rows.filter((r) => now - Date.parse(r.at) >= olderThanMs).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (seed === undefined || eligible.length <= max) return eligible.slice(0, max);
  const rnd = random(seed);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
  }
  return eligible.slice(0, max);
}

/**
 * "갱신" 으로 끝난 줄이 정말 표에 저장됐는지 확인합니다. tool 은 성공했는데 표 쓰기가 2초를 넘기거나 실패하면 remember 가 조용히 넘기므로,
 * 돌리기 전의 at 과 돌린 뒤의 at 을 비교해 안 바뀐 줄은 not_persisted 로 바꿉니다 (메모리에만 남아 이 프로세스가 끝나면 사라짐)
 */
export function confirmPersisted(results: WarmResult[], before: Map<string, string>, after: Map<string, string>): WarmResult[] {
  return results.map((r) => {
    if (r.outcome !== "refreshed") return r;
    const was = before.get(r.key);
    const now = after.get(r.key);
    return now !== undefined && (was === undefined || Date.parse(now) > Date.parse(was)) ? r : { ...r, outcome: "not_persisted", detail: "표의 at 이 그대로" };
  });
}

/** 실행 기록(step) 하나를 결과로 읽습니다 */
export function outcomeOf(step: ToolStep | undefined): { outcome: WarmOutcome; detail?: string } {
  if (!step) return { outcome: "failed", detail: "실행 기록 없음" };
  if (step.breaker === "open") return { outcome: "skipped", detail: step.error ?? "회로 열림" };
  if (step.status === "ok" && step.fallbackAgeMs === undefined) return { outcome: "refreshed" };
  if (step.fallbackAgeMs !== undefined) return { outcome: "fallback", detail: `${formatAge(step.fallbackAgeMs)} 전 응답 유지` };
  return { outcome: "failed", ...(step.error ? { detail: step.error } : {}) };
}

/** 줄들을 concurrency 개씩 동시에 돌립니다. invoke 는 tool 을 부르고 실행 기록(step)을, 레지스트리에 없으면 "unknown_tool" 을 돌려줍니다 */
export async function warmRows(rows: CacheRow[], invoke: (tool: string, input: unknown) => Promise<ToolStep | undefined | "unknown_tool">, concurrency = 3): Promise<WarmResult[]> {
  const results: WarmResult[] = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      const row = rows[i]!;
      const t0 = Date.now();
      let input: unknown;
      try {
        input = parseKey(row);
      } catch (err) {
        results[i] = { key: row.key, tool: row.tool, input: row.key, outcome: "failed", ms: 0, detail: err instanceof Error ? err.message : String(err) };
        continue;
      }
      try {
        const step = await invoke(row.tool, input);
        if (step === "unknown_tool") {
          results[i] = { key: row.key, tool: row.tool, input, outcome: "unknown_tool", ms: Date.now() - t0 };
        } else {
          const { outcome, detail } = outcomeOf(step);
          results[i] = { key: row.key, tool: row.tool, input, outcome, ms: Date.now() - t0, ...(detail ? { detail } : {}) };
        }
      } catch (err) {
        results[i] = { key: row.key, tool: row.tool, input, outcome: "failed", ms: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, rows.length)) }, worker));
  return results;
}

/** 결과 요약 (터미널 · GitHub Step Summary 공용 마크다운) */
export function summarize(results: WarmResult[], { total, picked }: { total: number; picked: number }): string {
  const counts = Object.fromEntries((Object.keys(outcomeLabels) as WarmOutcome[]).map((k) => [k, results.filter((r) => r.outcome === k).length])) as Record<WarmOutcome, number>;
  const lines = [
    `## tool 캐시 예열`,
    ``,
    `표 ${total}줄 중 ${picked}줄 시도 → 갱신 ${counts.refreshed} · 받았지만 표 저장 안 됨 ${counts.not_persisted} · 실패(저장 응답 유지) ${counts.fallback} · 건너뜀(회로 열림) ${counts.skipped} · 실패(저장 응답 없음) ${counts.failed} · 모르는 tool ${counts.unknown_tool}`,
  ];
  const bad = results.filter((r) => r.outcome !== "refreshed");
  if (bad.length) {
    lines.push(``, `| tool | 입력 | 결과 | 비고 |`, `| --- | --- | --- | --- |`);
    for (const r of bad) lines.push(`| ${r.tool} | \`${JSON.stringify(r.input).slice(0, 60)}\` | ${outcomeLabels[r.outcome]} | ${(r.detail ?? "").replace(/\|/g, "/").slice(0, 80)} |`);
  }
  return lines.join("\n");
}
