/**
 * tool 응답 캐시 예열 (리더). tool_cache 표에 있는 호출(tool + 입력)을 같은 입력으로 다시 불러 저장 응답을 갓 받은 것으로 바꿉니다.
 * 모델은 부르지 않고 tool 만 부르므로 비용이 없고 몇 초면 끝납니다. GitHub Actions(.github/workflows/warm.yml)가 한 시간마다 돌려,
 * 시연 당일 외부 API 가 끊겨도 "1시간 전 조회 값" 으로 리포트가 나가게 합니다.
 * 표에 없는 입력은 예열할 수 없으니, 시연 질문은 전날 `pnpm eval --no-judge` 로 한 번 돌려 두면 됩니다 (그 호출이 표에 들어감).
 *
 *   pnpm warm                          # 30분 넘게 안 갱신된 줄 중 최대 300줄 (실행마다 다른 줄이 걸리게 섞음)
 *   pnpm warm --older-than 0           # 전부
 *   pnpm warm --max 50 --concurrency 2
 *   pnpm warm --dry                    # 부르지 않고 대상만 보여 줌
 *
 * 필요한 환경 변수: SUPABASE_URL · SUPABASE_SECRET_KEY 와 tool 키(FRED_API_KEY · ECOS_API_KEY · DATA_GO_KR_KEY). OPENAI_API_KEY 는 필요 없습니다.
 * 종료 코드: 표를 못 읽으면 1, 그 밖에는 0 (일부 실패는 정상 — 저장 응답이 그대로 남습니다).
 * 레지스트리에 없는 tool 의 줄은 쓸 데가 없어 지웁니다. "갱신" 은 돌린 뒤 표의 at 이 실제로 바뀐 것만 셉니다.
 */
import { appendFileSync } from "node:fs";
import { RunContext } from "@openai/agents";
import { ResearchContext } from "../../src/agent/context";
import { dbEnabled, getDb } from "../../src/lib/db";
import { muffinTools } from "../../src/tools";
import { confirmPersisted, selectRows, summarize, warmRows, type CacheRow } from "./warm";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Action 에서는 Secrets 로 들어옵니다
}

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
};
const olderThanMs = Number(flag("--older-than", "30")) * 60_000;
const max = Number(flag("--max", "300"));
const concurrency = Number(flag("--concurrency", "3"));
const dry = argv.includes("--dry");

/** 표 전체를 1000줄씩 읽습니다 (PostgREST 는 한 번에 1000줄까지). 최대 5000줄 */
async function loadRows(): Promise<CacheRow[]> {
  const rows: CacheRow[] = [];
  for (let page = 0; page < 5; page++) {
    const { data, error } = await getDb()
      .from("tool_cache")
      .select("key, tool, at")
      .order("at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`tool_cache 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return rows;
}

/**
 * 돌린 뒤 표의 at. 키에 JSON 의 따옴표가 들어 있어 PostgREST 의 in 필터가 맞추지 못하므로(11/4 확인), 표를 다시 읽어 만듭니다 (1000줄에 한 번 조회)
 */
async function latestAt(): Promise<Map<string, string>> {
  return new Map((await loadRows()).map((r) => [r.key, r.at]));
}

async function main() {
  if (!dbEnabled()) {
    console.error("Supabase 환경 변수가 없습니다 (SUPABASE_URL · SUPABASE_SECRET_KEY). 예열할 표가 없습니다.");
    process.exit(1);
  }
  let rows: CacheRow[];
  try {
    rows = await loadRows();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const picked = selectRows(rows, { olderThanMs, max, ...(dry ? {} : { seed: Date.now() }) });
  console.log(`tool_cache ${rows.length}줄 · ${olderThanMs / 60_000}분 넘은 것 ${picked.length}줄${dry ? " (dry)" : ""}`);
  if (dry) {
    for (const r of picked) console.log(`  ${r.tool}  ${r.at}  ${r.key.slice(r.tool.length + 1, r.tool.length + 81)}`);
    return;
  }
  const before = new Map(picked.map((r) => [r.key, r.at]));
  const raw = await warmRows(
    picked,
    async (tool, input) => {
      const t = muffinTools.find((x) => x.name === tool);
      if (!t) return "unknown_tool";
      const ctx = new ResearchContext();
      await t.invoke(new RunContext(ctx), JSON.stringify(input));
      return ctx.steps[0];
    },
    concurrency,
  );
  // "갱신" 은 표의 at 이 실제로 바뀐 것만. 표 쓰기가 늦거나 실패하면 메모리에만 남아 이 프로세스와 함께 사라집니다
  let results = raw;
  try {
    results = confirmPersisted(raw, before, await latestAt());
  } catch (err) {
    console.warn(`저장 확인 실패 (갱신 수는 tool 응답 기준): ${err instanceof Error ? err.message : String(err)}`);
  }
  // 레지스트리에 없는 tool 의 줄은 쓸 데가 없으니 지웁니다 (tool 이름이 바뀌었거나 빠진 경우)
  const unknown = results.filter((r) => r.outcome === "unknown_tool").map((r) => r.key);
  if (unknown.length) {
    // 키 하나씩 eq 로 지웁니다 (in 필터는 따옴표 든 키를 못 맞춤)
    let failed = 0;
    for (const key of unknown) {
      const { error } = await getDb().from("tool_cache").delete().eq("key", key);
      if (error) failed += 1;
    }
    console.log(`모르는 tool 줄 ${unknown.length}개 삭제${failed ? ` (실패 ${failed})` : ""}`);
  }
  const summary = summarize(results, { total: rows.length, picked: picked.length });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

void main();
