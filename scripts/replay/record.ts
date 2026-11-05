/**
 * 리플레이 녹화 (리더). 실제로 한 번 돌려 진행 이벤트와 리포트를 src/replays/<id>.json 으로 남깁니다. 시연 전에 보여 줄 질문마다 한 번씩.
 *
 *   pnpm replay:record --question "KODEX 200 지금 사도 돼?" --area etf --depth standard --id etf-decision
 *   pnpm replay:record --list        # 녹화 목록
 *   pnpm replay:record --check       # 모든 파일 검사 (형식 · id · 권유 표현)
 *   pnpm replay:record --remove <id> # 녹화 삭제 (목록 · index 다시 생성)
 *
 * 실제 OpenAI · tool 호출이라 .env.local 이 필요합니다. 녹화 뒤 `pnpm test` 가 파일을 검사합니다.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { research } from "../../src/agent/muffin";
import { areas, depths, type Area, type Depth } from "../../src/agent/schema";
import { REPLAY_ID, replaySchema, type Replay } from "../../src/lib/replay";
import { buildReplay, defaultId, recordable, renderIndex, renderManifest, type Captured } from "./lib";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 없으면 OPENAI_API_KEY 누락으로 실패
}

export const REPLAYS_DIR = join(process.cwd(), "src", "replays");

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function loadAll(): Replay[] {
  return readdirSync(REPLAYS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .sort()
    .map((f) => {
      const r = replaySchema.parse(JSON.parse(readFileSync(join(REPLAYS_DIR, f), "utf8")));
      if (`${r.id}.json` !== f) throw new Error(`${f}: 파일 이름과 id(${r.id})가 다릅니다`);
      return r;
    });
}

function regenerate(all: Replay[]): void {
  writeFileSync(join(REPLAYS_DIR, "index.ts"), renderIndex(all.map((r) => r.id)));
  writeFileSync(join(REPLAYS_DIR, "manifest.json"), `${JSON.stringify(renderManifest(all), null, 2)}\n`);
}

async function main() {
  if (argv.includes("--list")) {
    for (const r of loadAll()) console.log(`${r.id}  ${r.recordedAt}  ${r.depth}${r.area ? ` · ${r.area}` : ""}  ${(r.ms / 1000).toFixed(1)}초  ${r.question}`);
    return;
  }
  if (argv.includes("--check")) {
    const all = loadAll();
    for (const r of all) {
      const ok = recordable(r);
      if (!ok.ok) throw new Error(`${r.id}: ${ok.reason}`);
    }
    regenerate(all);
    console.log(`녹화 ${all.length}개 이상 없음 · index.ts · manifest.json 다시 생성`);
    return;
  }
  const remove = flag("--remove");
  if (remove) {
    if (!REPLAY_ID.test(remove)) throw new Error(`id 는 소문자 · 숫자 · 하이픈 3~60자: ${remove}`);
    const file = join(REPLAYS_DIR, `${remove}.json`);
    if (!existsSync(file)) throw new Error(`없는 녹화: ${remove}`);
    unlinkSync(file);
    regenerate(loadAll());
    console.log(`삭제: ${remove}`);
    return;
  }

  const question = flag("--question")?.trim();
  if (!question) throw new Error('--question "…" 이 필요합니다 (--list · --check · --remove 도 있음)');
  const depth = (flag("--depth") ?? "standard") as Depth;
  if (!depths.includes(depth)) throw new Error(`depth 는 ${depths.join(" · ")} 중 하나`);
  const area = flag("--area") as Area | undefined;
  if (area && !areas.includes(area)) throw new Error(`area 는 ${areas.join(" · ")} 중 하나`);
  const recordedAt = new Date().toISOString();
  const id = flag("--id") ?? defaultId(area, recordedAt);
  if (!REPLAY_ID.test(id)) throw new Error(`id 는 소문자 · 숫자 · 하이픈 3~60자: ${id}`);
  if (existsSync(join(REPLAYS_DIR, `${id}.json`)) && !argv.includes("--force")) throw new Error(`이미 있는 녹화: ${id} (--force 로 덮어쓰기)`);

  console.log(`▶ 녹화 ${id}: ${question} [${depth}${area ? ` · ${area}` : ""}]`);
  const captured: Captured[] = [];
  const started = Date.now();
  const result = await research({ question, depth, ...(area ? { area } : {}) }, {
    onEvent(event) {
      captured.push({ t: Date.now() - started, event });
      if (event.type === "stage") console.log(`  ${String(Date.now() - started).padStart(6)}ms  ${event.stage} ${event.status}`);
      if (event.type === "step") console.log(`  ${String(Date.now() - started).padStart(6)}ms  ${event.step.status === "ok" ? "✅" : "❌"} ${event.step.tool} ${event.step.ms}ms${event.step.fallbackAgeMs !== undefined ? " (저장 응답)" : ""}`);
    },
  });
  const ms = Date.now() - started;
  const replay = buildReplay(captured, result, { id, question, depth, area, recordedAt, ms });
  const ok = recordable(replay);
  if (!ok.ok && !argv.includes("--force")) throw new Error(ok.reason);

  writeFileSync(join(REPLAYS_DIR, `${id}.json`), `${JSON.stringify(replay, null, 2)}\n`);
  regenerate(loadAll());
  const v = replay.report.verification;
  console.log(`저장: src/replays/${id}.json · ${(ms / 1000).toFixed(1)}초 · 이벤트 ${replay.events.length}개 · 숫자 ${v.numbers.total}개(검증 ${v.numbers.verified}) · 권유 ${v.advice} · 다시 쓰기 ${replay.rewrites}`);
  console.log(`재생: /replay?id=${id}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
