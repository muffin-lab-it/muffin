/**
 * tool 응답 캐시 (리더). 마지막으로 성공한 응답을 "tool 이름 + 입력" 으로 기억해 두었다가, 같은 호출이 실패하면 그 응답을 대신 돌려줍니다.
 * 외부 API 가 느리거나 잠깐 끊겨도 리포트가 빈칸으로 나가지 않게 하려는 것입니다 (시연 대비). 폴백으로 쓴 응답은
 * 장부 note 와 실행 기록(fallbackAgeMs)에 그렇게 표시되고 리포트 "확인하지 못한 것" 에도 코드가 한 줄 넣습니다. 데이터 기준일(asOf)은 원래 응답 그대로입니다.
 *
 * 저장은 이 서버 인스턴스의 메모리 + Supabase tool_cache 표(환경 변수가 있을 때, 실패해도 무시). 표가 있어야 Vercel 인스턴스가
 * 바뀌어도 쓸 수 있고, 로컬에서 `pnpm eval --no-judge` 로 미리 돌린 응답을 배포본이 쓸 수 있습니다 (시연 전 예열).
 * 표 쓰기 · 읽기는 제한 시간 안에만 기다립니다 (느린 DB 가 tool 제한 시간을 잡아먹지 않게). 같은 키에 더 새 응답이 있으면 덮어쓰지 않고,
 * 24시간 지난 줄은 한 시간에 한 번 지웁니다. 계산 tool(kind: calc)은 외부 호출이 없어 캐시하지 않습니다.
 */
import { dbEnabled, getDb, type Db } from "../lib/db";
import type { ToolResult } from "./types";

export { formatAge } from "../lib/age";

/** 이보다 오래된 응답은 폴백으로 쓰지 않습니다. 금융 데이터라 하루를 넘기면 빈칸이 낫습니다 */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
/** 표 쓰기를 기다리는 시간. 왕복 두 번(update → insert)이 보통 0.5초, 첫 연결은 1초 넘기도 합니다 (11/4 실측). 넘기면 메모리에만 남깁니다 */
export const STORE_TIMEOUT_MS = 2_000;
/** 표 읽기를 기다리는 시간. 넘기면 폴백 없이 실패 처리 */
export const RECALL_TIMEOUT_MS = 1_500;
/** 지난 줄 정리는 한 시간에 한 번 */
export const PRUNE_EVERY_MS = 60 * 60_000;

/** TOOL_CACHE=0 이면 끕니다. 테스트(vitest.config.ts)는 꺼 두어 tool 테스트가 실패 동작을 그대로 확인합니다 */
export function cacheEnabled(): boolean {
  return process.env.TOOL_CACHE !== "0";
}

type Entry = { at: number; result: ToolResult };
const memory = new Map<string, Entry>();
let lastPrune = 0;
/** 표 저장 실패는 리포트와 무관하므로 한 번만 알립니다 (표가 아직 없을 때 호출마다 찍히지 않게) */
let warnedStore = false;
function warnStore(tool: string, reason: string) {
  if (warnedStore) return;
  warnedStore = true;
  console.warn(`tool_cache 저장 실패 (${tool}): ${reason} — 캐시는 이 서버 메모리에만 남습니다`);
}

/** 키 순서를 정렬해 같은 입력이면 같은 키가 됩니다 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function cacheKey(tool: string, input: unknown): string {
  return `${tool}:${stable(input)}`;
}

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${ms}ms 안에 끝나지 않음`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 같은 키에 더 새 응답이 있으면 덮어쓰지 않습니다 (두 인스턴스가 동시에 받았을 때 오래된 쪽이 이기지 않게).
 * 있는데 오래됐으면 바꾸고(조건부 update), 없으면 넣습니다(insert, 중복이면 무시). 둘 다 0건이면 그 사이 다른 인스턴스가 넣은 것이라 조건부 update 를 한 번 더.
 */
async function store(db: Db, key: string, tool: string, at: number, result: ToolResult): Promise<void> {
  const row = { key, tool, at: new Date(at).toISOString(), result };
  const update = async () => {
    const r = await db.from("tool_cache").update(row).eq("key", key).lt("at", row.at).select("key");
    if (r.error) throw new Error(r.error.message);
    return (r.data?.length ?? 0) > 0;
  };
  if (await update()) return;
  const inserted = await db.from("tool_cache").upsert(row, { onConflict: "key", ignoreDuplicates: true }).select("key");
  if (inserted.error) throw new Error(inserted.error.message);
  if (!inserted.data?.length) await update();
}

/** 24시간 지난 줄은 폴백에 쓰지 않으므로 지웁니다. 한 시간에 한 번만 */
async function prune(db: Db, now: number): Promise<void> {
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  const { error } = await db.from("tool_cache").delete().lt("at", new Date(now - CACHE_MAX_AGE_MS).toISOString());
  if (error) throw new Error(error.message);
}

/** 성공한 응답을 기억합니다. 메모리는 바로, 표는 timeoutMs 안에서 기다립니다 (실패 · 지연은 무시) */
export async function remember(tool: string, input: unknown, result: ToolResult, { timeoutMs = STORE_TIMEOUT_MS } = {}): Promise<void> {
  if (!cacheEnabled()) return;
  const key = cacheKey(tool, input);
  const at = Date.now();
  memory.set(key, { at, result });
  if (!dbEnabled()) return;
  let db: Db;
  try {
    db = getDb();
    await withTimeout(store(db, key, tool, at, result), timeoutMs);
  } catch (err) {
    warnStore(tool, err instanceof Error ? err.message : String(err));
    return;
  }
  // 지난 줄 정리는 기다리지 않는 best-effort 입니다 (성공 응답을 더 늦추지 않게). 끊겨도 다음 시간에 다시 하고, 오래된 줄은 어차피 recall 이 쓰지 않습니다
  void withTimeout(prune(db, at), timeoutMs).catch(() => {});
}

/**
 * 같은 호출의 마지막 성공 응답. maxAgeMs 보다 오래됐거나 없으면 null.
 * 메모리와 표(timeoutMs 안에) 둘 다 보고 더 새 쪽을 씁니다 — 다른 인스턴스가 더 최근에 받은 응답이 표에 있을 수 있어서. 표가 느리거나 실패하면 메모리 것
 */
export async function recall(
  tool: string,
  input: unknown,
  { maxAgeMs = CACHE_MAX_AGE_MS, timeoutMs = RECALL_TIMEOUT_MS } = {},
): Promise<{ result: ToolResult; ageMs: number } | null> {
  if (!cacheEnabled()) return null;
  const key = cacheKey(tool, input);
  const now = Date.now();
  const hit = memory.get(key);
  const mine = hit && now - hit.at <= maxAgeMs ? { result: hit.result, ageMs: now - hit.at } : null;
  if (!dbEnabled()) return mine;
  try {
    const { data, error } = await withTimeout(getDb().from("tool_cache").select("at, result").eq("key", key).maybeSingle(), timeoutMs);
    if (error || !data) return mine;
    const at = Date.parse(data.at);
    if (!(now - at <= maxAgeMs) || (hit && hit.at >= at)) return mine;
    memory.set(key, { at, result: data.result });
    return { result: data.result, ageMs: now - at };
  } catch {
    return mine;
  }
}

/** 테스트용 */
export function clearToolCache(): void {
  memory.clear();
  lastPrune = 0;
}
