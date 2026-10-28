/**
 * 리포트 History. 프론트는 이 네 함수만 씁니다.
 * 서버 저장으로 바꿀 것을 전제로 모두 Promise 를 돌려줍니다. 지금 안쪽은 브라우저 localStorage 이고,
 * 서버로 바꿔도 함수 모양은 그대로라 화면 코드는 다시 고치지 않습니다.
 * 화면은 실패(reject)를 처리해야 합니다. 서버 저장에서는 네트워크 · 서버 오류가 날 수 있기 때문입니다.
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

function read(): ReportRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? normalizeRecords(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** 0단계 전에 저장된 v1 리포트도 v2 모양으로 읽습니다. 리포트 모양이 아닌 기록은 건너뜁니다. */
function normalizeRecords(parsed: unknown): ReportRecord[] {
  if (!Array.isArray(parsed)) return [];
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
}

export async function saveReport(input: ReportRecord["input"], report: Report, steps: ToolStep[]): Promise<ReportRecord> {
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
export async function listReports(): Promise<ReportRecord[]> {
  return read();
}

/** 없으면 null */
export async function getReport(id: string): Promise<ReportRecord | null> {
  return read().find((r) => r.id === id) ?? null;
}

export async function deleteReport(id: string): Promise<void> {
  write(read().filter((r) => r.id !== id));
}
