/**
 * History API 의 저장소 (docs/web-spec.md 4.2 · 4.3). Supabase `reports` 표를 브라우저 익명 id(client_id)로 나눠 읽고 씁니다.
 * 서버 전용입니다. 라우트(`route.ts` · `[id]/route.ts`)만 import 하고, 브라우저 코드(`src/lib/history.ts`)는 API 를 거칩니다.
 * 모든 조회 · 삭제는 id 와 client_id 를 함께 걸어서, 다른 브라우저의 기록은 "없음" 과 같게 보입니다.
 * DB 오류는 throw 합니다 (라우트가 500 으로 바꿈).
 */
import { getDb, type Tables, type TablesInsert } from "@/src/lib/db";
import type { ReportRecord } from "@/src/lib/history";

/** 브라우저당 남기는 기록 수. 넘으면 오래된 것부터 지웁니다 */
export const MAX_PER_CLIENT = 100;

const COLUMNS = "id, created_at, input, report, steps";
/** Postgres 고유키 위반 (같은 id 가 이미 있음) */
const UNIQUE_VIOLATION = "23505";

type Row = Pick<Tables<"reports">, "id" | "created_at" | "input" | "report" | "steps">;

function toRecord(row: Row): ReportRecord {
  return { id: row.id, createdAt: row.created_at, input: row.input, report: row.report, steps: row.steps };
}

function fail(action: string, error: { message: string }): never {
  throw new Error(`reports ${action} 실패: ${error.message}`);
}

export async function findReport(clientId: string, id: string): Promise<ReportRecord | null> {
  const { data, error } = await getDb().from("reports").select(COLUMNS).eq("id", id).eq("client_id", clientId).maybeSingle();
  if (error) fail("조회", error);
  return data ? toRecord(data) : null;
}

/** 최신순. before 를 주면 그 시각보다 앞의 것만 (다음 페이지) */
export async function listReports(clientId: string, { limit, before }: { limit: number; before?: string }): Promise<ReportRecord[]> {
  let query = getDb().from("reports").select(COLUMNS).eq("client_id", clientId);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) fail("목록", error);
  return (data ?? []).map(toRecord);
}

export type InsertResult = { status: "created" | "existing"; record: ReportRecord } | { status: "conflict" };

/**
 * 넣어 보고 같은 id 가 이미 있으면 그 기록을 봅니다. 같은 브라우저의 것이면 existing(기존 기록), 다른 브라우저의 것이면 conflict.
 * 먼저 찾고 넣지 않아서, 두 번 눌림처럼 같은 요청이 동시에 와도 한 번만 저장됩니다.
 */
export async function insertReport(row: TablesInsert<"reports">): Promise<InsertResult> {
  const db = getDb();
  const { data, error } = await db.from("reports").insert(row).select(COLUMNS).single();
  if (!error) return { status: "created", record: toRecord(data) };
  if (error.code !== UNIQUE_VIOLATION) fail("저장", error);

  const { data: existing, error: findError } = await db.from("reports").select(`${COLUMNS}, client_id`).eq("id", row.id).maybeSingle();
  if (findError) fail("조회", findError);
  if (!existing) fail("저장", { message: "같은 id 가 있다고 했지만 찾지 못했습니다" });
  if (existing.client_id !== row.client_id) return { status: "conflict" };
  return { status: "existing", record: toRecord(existing) };
}

/** 지운 기록이 있으면 true */
export async function deleteReport(clientId: string, id: string): Promise<boolean> {
  const { data, error } = await getDb().from("reports").delete().eq("id", id).eq("client_id", clientId).select("id");
  if (error) fail("삭제", error);
  return (data ?? []).length > 0;
}

/** 이 브라우저의 기록 중 최신 MAX_PER_CLIENT 개를 남기고 지웁니다. 지운 개수를 돌려줍니다 */
export async function trimReports(clientId: string, keep = MAX_PER_CLIENT): Promise<number> {
  const db = getDb();
  const { data, error } = await db
    .from("reports")
    .select("id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .range(keep, keep + 999);
  if (error) fail("정리 조회", error);
  const ids = (data ?? []).map((r) => r.id);
  if (!ids.length) return 0;
  const { error: deleteError } = await db.from("reports").delete().eq("client_id", clientId).in("id", ids);
  if (deleteError) fail("정리 삭제", deleteError);
  return ids.length;
}
