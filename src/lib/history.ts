/**
 * 리포트 History. 프론트는 이 네 함수만 씁니다.
 * 지금은 브라우저 localStorage 에 저장하고, 고도화 기간에 백엔드가 서버 저장으로 바꿔도 함수 모양은 그대로입니다.
 * localStorage 는 없거나 막혀 있을 수 있어서(시크릿 창 등) 모든 접근을 try/catch 로 감쌉니다.
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

const KEY = "muffin.history.v1";
const MAX = 100;
const EMPTY: ReportRecord[] = [];

// 같은 원본 문자열이면 같은 배열을 돌려줍니다. React 의 useSyncExternalStore 가 참조 비교를 하기 때문입니다.
let cache: { raw: string | null; records: ReportRecord[] } = { raw: null, records: EMPTY };
const listeners = new Set<() => void>();

function read(): ReportRecord[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.records;
  let records: ReportRecord[] = EMPTY;
  try {
    records = raw ? normalizeRecords(JSON.parse(raw)) : EMPTY;
  } catch {
    records = EMPTY;
  }
  cache = { raw, records };
  return records;
}

/** 0단계 전에 저장된 v1 리포트도 v2 모양으로 읽습니다. 리포트 모양이 아닌 기록은 건너뜁니다. */
function normalizeRecords(parsed: unknown): ReportRecord[] {
  if (!Array.isArray(parsed)) return EMPTY;
  const out: ReportRecord[] = [];
  for (const r of parsed as ReportRecord[]) {
    try {
      out.push({ ...r, report: normalizeReport(r.report) });
    } catch {
      // 깨진 기록. 화면에서 보이지 않게 합니다
    }
  }
  return out;
}

function write(records: ReportRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records.slice(0, MAX)));
  } catch {
    // 저장 실패는 조용히 무시. 화면은 계속 동작해야 합니다.
  }
  listeners.forEach((l) => l());
}

/** 화면에서 useSyncExternalStore(subscribeHistory, listReports, () => []) 로 씁니다. */
export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function saveReport(input: ReportRecord["input"], report: Report, steps: ToolStep[]): ReportRecord {
  const record: ReportRecord = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    input,
    report,
    steps,
  };
  write([record, ...read()]);
  return record;
}

/** 최신순 */
export function listReports(): ReportRecord[] {
  return read();
}

export function getReport(id: string): ReportRecord | undefined {
  return read().find((r) => r.id === id);
}

export function deleteReport(id: string) {
  write(read().filter((r) => r.id !== id));
}
