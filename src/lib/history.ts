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
 */
import type { ToolStep } from "../agent/context";
import { normalizeReport } from "../agent/normalize";
import type { Area, Depth, Report } from "../agent/schema";

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

/**
 * 예전 목록 키의 기록을 기록별 키로 옮깁니다. 목록 키를 먼저 지워 공간을 비운 뒤 최신순으로 쓰므로 중복이 남지 않고,
 * 용량이 모자라면 오래된 기록부터 옮기지 못합니다 (Codex 리뷰: 목록을 남긴 채 복사하면 공간을 두 배로 쓰다 막혀 저장 자체가 안 됨).
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
  try { store.removeItem(HISTORY_KEY); } catch { return pairs.map(pair => pair.record); }
  const kept: ReportRecord[] = [];
  let next = 0;
  for (; next < pairs.length; next++) {
    const record = pairs[next].record;
    try {
      if (store.getItem(HISTORY_RECORD_PREFIX + record.id) === null) store.setItem(HISTORY_RECORD_PREFIX + record.id, JSON.stringify(record));
      kept.push(record);
    } catch {
      break; // 용량이 차면 남은(더 오래된) 기록은 이번에 옮기지 못합니다
    }
  }
  if (next < pairs.length) {
    // 못 옮긴 기록은 원래 모양 그대로 목록 키에 되돌려 두고 다음 읽기에서 다시 시도합니다 (Codex 리뷰: 옮기다 막혀도 기록이 사라지지 않게)
    const left = pairs.slice(next);
    try {
      store.setItem(HISTORY_KEY, JSON.stringify(left.map(pair => pair.original)));
      kept.push(...left.map(pair => pair.record));
    } catch {
      // 되돌리지 못한 기록은 남지 않습니다
    }
  }
  return kept;
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
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

function removeRecord(store: Storage, id: string) {
  try { store.removeItem(HISTORY_RECORD_PREFIX + id); } catch { /* 지우지 못해도 화면은 계속 동작합니다 */ }
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

/**
 * id 는 스트림의 요청 id(result.id)를 넘기면 그대로 씁니다. 없으면 새로 만듭니다.
 * 같은 id 가 이미 있으면 덮어쓰지 않고 기존 기록을 돌려줍니다 (다시 시도 · 두 번 눌림에도 한 번만 저장).
 */
export async function saveReport(input: ReportRecord["input"], report: Report, steps: ToolStep[], id?: string): Promise<ReportRecord> {
  const existing = id ? await getReport(id) : null;
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
  if (writeRecord(record)) trim();
  return record;
}

/** 최신순 */
export async function listReports(): Promise<ReportRecord[]> {
  return readAll();
}

/** 없으면 null */
export async function getReport(id: string): Promise<ReportRecord | null> {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try { raw = store.getItem(HISTORY_RECORD_PREFIX + id); } catch { raw = null; }
  const own = parseRecord(raw);
  if (own) return own;
  // 아직 옮기지 않은 예전 목록에 있을 수 있습니다
  return readAll().find((record) => record.id === id) ?? null;
}

export async function deleteReport(id: string): Promise<void> {
  const store = storage();
  if (!store) return;
  readAll(); // 예전 목록이 남아 있으면 먼저 기록별 키로 옮깁니다
  removeRecord(store, id);
  // 옮기기에 실패해 목록 키가 남아 있으면 목록에서도 뺍니다
  try {
    const raw = store.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) store.setItem(HISTORY_KEY, JSON.stringify(parsed.filter((record: ReportRecord) => record?.id !== id)));
    }
  } catch {
    // 목록 키를 못 고쳐도 기록별 키는 지워졌습니다
  }
}
