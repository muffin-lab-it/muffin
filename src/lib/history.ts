/**
 * 리포트 History. 프론트는 이 네 함수만 씁니다.
 * 서버 저장으로 바꿀 것을 전제로 모두 Promise 를 돌려줍니다. 지금 안쪽은 브라우저 localStorage 이고,
 * 서버로 바꿔도 함수 모양은 그대로라 화면 코드는 다시 고치지 않습니다.
 * 화면은 실패(reject)를 처리해야 합니다. 서버 저장에서는 네트워크 · 서버 오류가 날 수 있기 때문입니다.
 * localStorage 는 없거나 막혀 있을 수 있어서(시크릿 창 등) 모든 접근을 try/catch 로 감쌉니다.
 *
 * 11/21: 기록을 목록 하나(JSON 배열)로 쓰면 탭 두 개가 동시에 저장할 때 늦게 쓴 탭이 먼저 쓴 탭의 기록을 덮어씁니다
 * (20명 시나리오 1번: 결과 화면이 뜬 뒤 "보관함에 없는 리포트" 로 바뀜). 그래서 기록마다 자기 키(`muffin.history.v1:<id>`)에 따로 씁니다.
 * 예전 목록 키(`muffin.history.v1`)는 읽을 때 한 번 기록별 키로 옮깁니다.
 *
 * 11/24: 서버 저장(History API, src/lib/api.ts)을 붙였습니다. 브라우저에 먼저 쓰고 서버에도 올립니다 (로그인 대신 브라우저 익명 id 로 나눔).
 * 서버가 없거나(503) 실패해도 화면은 브라우저 기록으로 그대로 동작하고, 브라우저에만 있는 기록은 보관함을 열 때 몇 개씩 서버로 올립니다.
 * 지운 기록은 서버 목록에서 사라질 때까지 id 를 기억해, 서버 목록으로 되살아나지 않게 합니다.
 */
import type { ToolStep } from "../agent/context";
import { normalizeReport } from "../agent/normalize";
import type { Area, Depth, Report } from "../agent/schema";
import { ApiError, deleteHistory, getHistory, listHistory, saveHistory } from "./api";

export type ReportRecord = {
  id: string;
  createdAt: string; // ISO
  input: { question: string; depth: Depth; area?: Area };
  report: Report;
  steps: ToolStep[];
};

/** 예전 목록 키. 보관함 화면이 storage 이벤트를 듣는 데도 씁니다 */
export const HISTORY_KEY = "muffin.history.v1";
/** 기록별 키 머리. 뒤에 기록 id 가 붙습니다 */
export const HISTORY_RECORD_PREFIX = `${HISTORY_KEY}:`;
const MAX = 100;
/** 서버에서 지운 것이 아직 확인되지 않은 기록 id. 목록 · 조회에서 숨기고 보관함을 열 때 다시 지웁니다 */
const DELETED_KEY = "muffin.history.deleted";
/** 서버가 받지 않는 기록 id (형식 · 크기 · 다른 브라우저의 id). 다시 올리지 않습니다 */
const SKIPPED_KEY = "muffin.history.skipped";
/** 서버의 기록 id 규칙 (app/api/history/shared.ts recordIdSchema) */
const SERVER_ID = /^[a-z0-9-]{1,64}$/;
/** 보관함을 열 때 한 번에 서버로 올리는 브라우저 기록 수 (저장 한도 10분 60회 안에서) */
const SYNC_BATCH = 10;
/** 기억하는 id 수 상한 (지운 기록 · 건너뛴 기록 각각) */
const ID_SET_MAX = 200;

const newestFirst = (a: ReportRecord, b: ReportRecord) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 저장소의 키 목록. 테스트용 가짜 저장소처럼 key() 가 없으면 열거 가능한 키를 씁니다 */
function storageKeys(store: Storage): string[] {
  try {
    if (typeof store.length === "number" && typeof store.key === "function") {
      const keys: string[] = [];
      for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        if (key) keys.push(key);
      }
      return keys;
    }
  } catch {
    // 아래 Object.keys 로 넘어갑니다
  }
  return Object.keys(store);
}

/** 0단계 전에 저장된 v1 리포트도 v2 모양으로 읽습니다. 리포트 모양이 아닌 기록은 건너뜁니다. */
function normalizeRecord(parsed: unknown): ReportRecord | null {
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as ReportRecord;
  try {
    return { ...record, report: normalizeReport(record.report) };
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null): ReportRecord | null {
  if (!raw) return null;
  try {
    return normalizeRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 옮기기는 탭(저장소)마다 한 번만 시도합니다. 실패를 매번 되풀이하면 저장소 변경 이벤트로 다른 탭과 서로 새로고침을 주고받습니다 (Codex 리뷰) */
const migrationAttempted = new WeakSet<object>();

/**
 * 예전 목록 키의 기록을 기록별 키로 옮깁니다. 목록 키를 먼저 지워 공간을 비운 뒤 최신순으로 쓰므로 중복이 남지 않습니다.
 * 용량이 모자라면 못 옮긴 기록을 목록에 되돌리고, 그것도 안 되면 이번에 옮긴 것까지 지우고 원래 목록을 통째로 되돌립니다 (기록이 사라지지 않게).
 */
function migrateLegacy(store: Storage): ReportRecord[] {
  let raw: string | null = null;
  try { raw = store.getItem(HISTORY_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const pairs = parsed.map(original => ({ original, record: normalizeRecord(original) }))
    .filter((pair): pair is { original: unknown; record: ReportRecord } => !!pair.record)
    .sort((a, b) => (a.record.createdAt < b.record.createdAt ? 1 : a.record.createdAt > b.record.createdAt ? -1 : 0));
  const records = pairs.map(pair => pair.record);
  if (migrationAttempted.has(store)) return records; // 이미 시도한 탭에서는 읽기만 합니다
  migrationAttempted.add(store);
  try { store.removeItem(HISTORY_KEY); } catch { return records; }
  let next = 0;
  for (; next < pairs.length; next++) {
    const record = pairs[next].record;
    try {
      if (store.getItem(HISTORY_RECORD_PREFIX + record.id) === null) store.setItem(HISTORY_RECORD_PREFIX + record.id, JSON.stringify(record));
    } catch {
      break; // 용량이 차면 남은(더 오래된) 기록은 이번에 옮기지 못합니다
    }
  }
  if (next === pairs.length) return records;
  // 못 옮긴 기록은 원래 모양 그대로 목록 키에 되돌려 둡니다
  try {
    store.setItem(HISTORY_KEY, JSON.stringify(pairs.slice(next).map(pair => pair.original)));
    return records;
  } catch {
    // 되돌릴 자리도 없으면 이번에 옮긴 기록을 지우고 원래 목록을 통째로 되돌립니다 (원래 있던 만큼이라 들어갑니다)
    for (const pair of pairs.slice(0, next)) {
      try { store.removeItem(HISTORY_RECORD_PREFIX + pair.record.id); } catch { /* 계속 진행 */ }
    }
    try { store.setItem(HISTORY_KEY, raw); } catch { /* 되돌리지 못한 기록은 남지 않습니다 */ }
    return records;
  }
}

function readAll(): ReportRecord[] {
  const store = storage();
  if (!store) return [];
  const byId = new Map<string, ReportRecord>();
  for (const record of migrateLegacy(store)) byId.set(record.id, record);
  for (const key of storageKeys(store)) {
    if (!key.startsWith(HISTORY_RECORD_PREFIX)) continue;
    let raw: string | null = null;
    try { raw = store.getItem(key); } catch { continue; }
    const record = parseRecord(raw);
    if (record) byId.set(record.id, record);
  }
  return [...byId.values()].sort(newestFirst);
}

/** 브라우저에 있는 기록 하나. 없으면 null */
function readLocal(id: string): ReportRecord | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try { raw = store.getItem(HISTORY_RECORD_PREFIX + id); } catch { raw = null; }
  const own = parseRecord(raw);
  if (own) return own;
  // 아직 옮기지 않은 예전 목록에 있을 수 있습니다
  return readAll().find((record) => record.id === id) ?? null;
}

function removeRecord(store: Storage, id: string) {
  try { store.removeItem(HISTORY_RECORD_PREFIX + id); } catch { /* 지우지 못해도 화면은 계속 동작합니다 */ }
  // 옮기지 못해 예전 목록에 남아 있는 기록이면 목록에서도 뺍니다 (Codex 리뷰: 목록에만 있는 기록은 자리를 못 비워 덜어 내기가 멈추지 않았음)
  try {
    const raw = store.getItem(HISTORY_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const rest = parsed.filter((item: { id?: string } | null) => item?.id !== id);
    if (rest.length === parsed.length) return;
    if (rest.length === 0) store.removeItem(HISTORY_KEY);
    else store.setItem(HISTORY_KEY, JSON.stringify(rest));
  } catch {
    // 목록 키를 못 고쳐도 다음 단계가 멈추지 않게 둡니다
  }
}

/**
 * 기록 하나를 자기 키에 씁니다. 브라우저 용량 한도에 걸리면 오래된 기록부터 덜어 내고 다시 씁니다. 성공 여부를 돌려줍니다.
 * 끝내 못 쓰면 덜어 낸 기록을 되돌려 놓습니다 (Codex 리뷰: 실패한 저장이 기존 기록만 지우지 않게).
 */
function writeRecord(record: ReportRecord): boolean {
  const store = storage();
  if (!store) return false;
  const raw = JSON.stringify(record);
  const evicted: ReportRecord[] = [];
  // 저장될 때까지 오래된 기록을 1/4 씩 덜어 냅니다. 매번 최소 하나는 빠지므로 끝납니다 (Codex 리뷰: 횟수 제한 때문에 자리가 났는데도 포기하지 않게)
  for (;;) {
    try {
      store.setItem(HISTORY_RECORD_PREFIX + record.id, raw);
      return true;
    } catch {
      const others = readAll().filter(item => item.id !== record.id);
      if (others.length === 0) break;
      for (const old of others.slice(-Math.max(1, Math.ceil(others.length / 4)))) {
        removeRecord(store, old.id);
        evicted.push(old);
      }
      // 아무것도 비우지 못했으면 멈춥니다 (무한 반복 방지)
      if (readAll().filter(item => item.id !== record.id).length >= others.length) break;
    }
  }
  for (const old of evicted) {
    try { store.setItem(HISTORY_RECORD_PREFIX + old.id, JSON.stringify(old)); } catch { /* 되돌리지 못한 기록은 남지 않습니다 */ }
  }
  return false;
}

/** 기록이 MAX 를 넘으면 오래된 것부터 지웁니다 */
function trim() {
  const store = storage();
  if (!store) return;
  const all = readAll();
  for (const old of all.slice(MAX)) removeRecord(store, old.id);
}

/** 이 탭에서 서버 저장소가 없다(503)고 들으면 더 부르지 않습니다 */
let serverOff = false;

/** 서버 저장을 부를 수 있는지: 브라우저 주소(http · https)에서만. 서버 렌더링이나 location 이 없는 테스트용 window 는 브라우저 기록만 씁니다 */
function serverReady(): boolean {
  if (serverOff || typeof window === "undefined" || typeof fetch !== "function") return false;
  try {
    return /^https?:$/.test(window.location?.protocol ?? "");
  } catch {
    return false;
  }
}

function timeout(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}

/** 저장소 설정이 없다는 응답(503)이면 이 탭에서는 서버를 끕니다. 그 밖의 실패는 다음에 다시 시도합니다 */
function noteFailure(error: unknown) {
  if (error instanceof ApiError && error.status === 503) serverOff = true;
}

function readIds(key: string): Set<string> {
  const store = storage();
  if (!store) return new Set();
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: Set<string>) {
  const store = storage();
  if (!store) return;
  try {
    if (ids.size === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify([...ids].slice(-ID_SET_MAX)));
  } catch {
    // 기억하지 못해도 화면은 계속 동작합니다
  }
}

function addId(key: string, id: string) {
  const ids = readIds(key);
  ids.delete(id);
  ids.add(id);
  writeIds(key, ids);
}

function dropId(key: string, id: string) {
  const ids = readIds(key);
  if (ids.delete(id)) writeIds(key, ids);
}

/** 서버 기록을 브라우저 기록 모양으로. 시각은 Postgres 꼴(+00:00 · 마이크로초)이라 브라우저와 같은 ISO 로 맞춰 정렬이 섞이지 않게 합니다 */
function fromServer(raw: ReportRecord): ReportRecord | null {
  const record = normalizeRecord(raw);
  if (!record) return null;
  const at = Date.parse(record.createdAt);
  return Number.isNaN(at) ? null : { ...record, createdAt: new Date(at).toISOString() };
}

/**
 * 기록 하나를 서버에 올립니다. 서버가 받지 않는 기록(400 · 409 · 413)은 건너뛴 것으로 기억하고,
 * 잠깐의 실패(429 · 네트워크 · 서버 오류)는 "later" 로 돌려 다음에 다시 올립니다.
 */
async function pushRecord(record: ReportRecord): Promise<"saved" | "skipped" | "later"> {
  if (!SERVER_ID.test(record.id)) {
    addId(SKIPPED_KEY, record.id);
    return "skipped";
  }
  try {
    await saveHistory(record, timeout(10_000));
    return "saved";
  } catch (error) {
    noteFailure(error);
    if (error instanceof ApiError && [400, 409, 413].includes(error.status)) {
      addId(SKIPPED_KEY, record.id);
      return "skipped";
    }
    return "later";
  }
}

let syncing: Promise<void> | undefined;

/**
 * 보관함을 열 때 뒤에서: 서버에서 지운 게 확인되지 않은 기록을 다시 지우고, 브라우저에만 있는 기록을 SYNC_BATCH 개씩(최신순) 올립니다.
 * 서버가 이미 MAX 개를 들고 있으면 그보다 오래된 브라우저 기록은 올리지 않습니다 (올려도 서버 정리에 바로 지워져 매번 되풀이되므로).
 */
function syncLater(local: ReportRecord[], remote: ReportRecord[]) {
  if (syncing) return;
  syncing = (async () => {
    const onServer = new Set(remote.map((record) => record.id));
    for (const id of readIds(DELETED_KEY)) {
      if (!onServer.has(id)) {
        dropId(DELETED_KEY, id);
        continue;
      }
      try {
        await deleteHistory(id, timeout(10_000));
      } catch (error) {
        noteFailure(error);
        return; // 다음에 보관함을 열 때 다시 지웁니다
      }
    }
    const oldestKept = remote.length >= MAX ? remote[remote.length - 1]?.createdAt : undefined;
    const skipped = readIds(SKIPPED_KEY);
    const pending = local
      .filter((record) => !onServer.has(record.id) && !skipped.has(record.id) && (!oldestKept || record.createdAt > oldestKept))
      .slice(0, SYNC_BATCH);
    for (const record of pending) {
      if (!serverReady()) return;
      if (readIds(DELETED_KEY).has(record.id)) continue;
      if ((await pushRecord(record)) === "later") return;
    }
  })().finally(() => {
    syncing = undefined;
  });
}

/** 뒤에서 하던 서버 맞추기가 끝날 때까지 기다립니다 (테스트 · 확인용) */
export function waitForHistorySync(): Promise<void> {
  return syncing ?? Promise.resolve();
}

/**
 * id 는 스트림의 요청 id(result.id)를 넘기면 그대로 씁니다. 없으면 새로 만듭니다.
 * 같은 id 가 이미 있으면 덮어쓰지 않고 기존 기록을 돌려줍니다 (다시 시도 · 두 번 눌림에도 한 번만 저장).
 * 브라우저에 썼으면 서버 저장은 기다리지 않고(결과 화면이 바로 뜨게), 못 썼으면 서버가 유일한 사본이라 기다립니다.
 */
export async function saveReport(input: ReportRecord["input"], report: Report, steps: ToolStep[], id?: string): Promise<ReportRecord> {
  // 브라우저 기록만 봅니다 (저장할 때마다 서버 왕복이 늘지 않게. 서버에 같은 id 가 있으면 서버가 기존 기록으로 답합니다)
  const existing = id ? readLocal(id) : null;
  if (existing) return existing;
  // 같은 밀리초에 두 번 저장해도 최신순이 지켜지도록 가장 최근 기록보다 1ms 뒤로 둡니다 (저장소 키 순서는 브라우저마다 달라 믿지 않습니다)
  const latest = readAll()[0]?.createdAt;
  const now = Math.max(Date.now(), latest ? Date.parse(latest) + 1 : 0);
  const record: ReportRecord = {
    id: id || `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(now).toISOString(),
    input,
    report,
    steps,
  };
  dropId(DELETED_KEY, record.id);
  const local = writeRecord(record);
  if (local) trim();
  if (serverReady()) {
    const pushing = pushRecord(record);
    if (!local) await pushing;
  }
  return record;
}

/** 최신순. 서버 목록과 브라우저 기록을 합칩니다 (같은 기록은 브라우저 것). 서버가 안 되면 브라우저 기록만 */
export async function listReports(): Promise<ReportRecord[]> {
  const local = readAll();
  if (!serverReady()) return local;
  let remote: ReportRecord[];
  try {
    remote = (await listHistory(MAX, timeout(5_000))).map(fromServer).filter((record): record is ReportRecord => !!record);
  } catch (error) {
    noteFailure(error);
    return local;
  }
  syncLater(local, remote);
  const deleted = readIds(DELETED_KEY);
  const byId = new Map<string, ReportRecord>();
  for (const record of remote) if (!deleted.has(record.id)) byId.set(record.id, record);
  for (const record of local) byId.set(record.id, record);
  return [...byId.values()].sort(newestFirst).slice(0, MAX);
}

/**
 * 없으면 null. 브라우저에 없으면 서버에서 찾아 브라우저에도 넣어 둡니다.
 * 서버에 닿지 못하면(네트워크 · 서버 오류) throw 해서 화면이 "없음" 대신 "불러오지 못했어요" 를 보이게 합니다.
 */
export async function getReport(id: string): Promise<ReportRecord | null> {
  const own = readLocal(id);
  if (own) return own;
  if (!serverReady() || readIds(DELETED_KEY).has(id)) return null;
  try {
    const found = await getHistory(id, timeout(8_000));
    const record = found ? fromServer(found) : null;
    if (record && writeRecord(record)) trim();
    return record;
  } catch (error) {
    noteFailure(error);
    if (serverOff) return null;
    throw error;
  }
}

/** 브라우저와 서버에서 지웁니다. 서버에서 못 지우면 숨겨 두고 보관함을 열 때 다시 지웁니다 */
export async function deleteReport(id: string): Promise<void> {
  const store = storage();
  if (store) {
    readAll(); // 예전 목록이 남아 있으면 먼저 기록별 키로 옮깁니다
    removeRecord(store, id); // 기록별 키와, 옮기지 못해 목록에 남은 기록 모두
  }
  if (!serverReady()) return;
  // 서버 목록에서 빠진 게 확인될 때까지 기억합니다 (지우는 사이 올리던 저장이 늦게 닿아도 되살아나지 않게)
  addId(DELETED_KEY, id);
  try {
    await deleteHistory(id, timeout(10_000));
  } catch (error) {
    noteFailure(error);
  }
}
