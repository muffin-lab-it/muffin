/**
 * Supabase 서버 클라이언트 (docs/web-spec.md 4.3). History API · 실행 로그(runs) · 관리자 화면이 이것으로 표에 닿습니다.
 * 서버 전용입니다. SUPABASE_URL · SUPABASE_SECRET_KEY 는 process.env 로만 읽고, 브라우저 코드에서 import 하지 않습니다.
 * 표는 RLS 를 켜고 정책 없이 secret 키에만 권한을 줘서, 이 클라이언트로만 읽고 씁니다.
 * 아래 Database 타입은 supabase/migrations/*_init.sql 과 같은 모양입니다. 표를 바꾸면 둘을 같이 고칩니다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolStep } from "../agent/context";
import type { Area, Depth, Intent, Report, Verification } from "../agent/schema";

/** reports 한 줄. id 는 리포트 생성 요청 id 를 그대로 씁니다. */
type ReportRow = {
  id: string;
  client_id: string;
  created_at: string; // ISO
  input: { question: string; depth: Depth; area?: Area };
  report: Report;
  steps: ToolStep[];
};

/** runs 한 줄. src/lib/log.ts 의 RunLog 와 같은 필드이고, 칸 이름은 snake_case, 없는 값은 null 입니다. */
type RunRow = {
  id: string;
  at: string; // ISO
  ok: boolean;
  stage: "started" | "input" | "config" | "limited" | "agent" | "ok";
  mock: boolean;
  client_id: string | null;
  /** sha256(ip + RATE_LIMIT_SALT) 앞 16자. 원문 IP 는 저장하지 않습니다 */
  ip_hash: string | null;
  input: { question: string; depth: string; area?: string } | null;
  ms: number;
  model: string | null;
  usage: { requests: number; inputTokens: number; outputTokens: number } | null;
  steps: ToolStep[] | null;
  rewrites: number | null;
  quality: { numbers: number; why: number; whyUnsupported: number; dataGaps: number; sources: number } | null;
  verification: Pick<Verification, "status" | "numbers" | "why" | "advice" | "revisions"> | null;
  intent: Intent | null;
  error: string | null;
};

/** evals 한 줄. 평가(scripts/promptfoo/run.ts) 한 번의 요약입니다. 주간 Action 과 로컬 실행이 넣고 /admin 이 읽습니다. */
type EvalRow = {
  /** Action 은 GitHub run id, 로컬은 날짜-시각(-tag) */
  id: string;
  at: string; // ISO
  source: "ci" | "local";
  /** 모델 비교 같은 실험 이름. 주간 평가는 null */
  tag: string | null;
  /** 돌린 세트 (쉼표로 여러 개). null 이면 전부 */
  set_name: string | null;
  questions: number;
  errors: number;
  avg_ms: number | null;
  /** 작성 단계에 쓴 모델들 */
  models: string[] | null;
  tokens: { prompt: number; completion: number } | null;
  /** 지표마다 통과 수 · 전체 수 · 통과율 (src/lib/eval-metrics.ts 의 Metric 이 키) */
  rates: Record<string, { pass: number; total: number; rate: number | null }>;
  thresholds: Record<string, number>;
  failed: { metric: string; rate: number; threshold: number }[];
  run_url: string | null;
  /** 요약 markdown */
  summary: string | null;
};

/** 넣을 때(Insert)는 기본값이 있거나 null 이 되는 칸(Optional)을 빼도 됩니다. */
type Table<Row, Optional extends keyof Row> = {
  Row: Row;
  Insert: Omit<Row, Optional> & Partial<Pick<Row, Optional>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      reports: Table<ReportRow, "created_at" | "steps">;
      runs: Table<RunRow, Exclude<keyof RunRow, "id" | "at" | "ok" | "stage" | "ms">>;
      evals: Table<EvalRow, "tag" | "set_name" | "avg_ms" | "models" | "tokens" | "run_url" | "summary">;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

type TableName = keyof Database["public"]["Tables"];
/** 표 한 줄의 모양. 예: Tables<"runs"> */
export type Tables<T extends TableName> = Database["public"]["Tables"][T]["Row"];
/** 표에 넣을 한 줄의 모양. 예: TablesInsert<"reports"> */
export type TablesInsert<T extends TableName> = Database["public"]["Tables"][T]["Insert"];

export type Db = SupabaseClient<Database>;

let client: Db | undefined;

/** 두 환경 변수가 다 있으면 true. 없을 때의 동작(503, 콘솔에만 로그 등)을 나눌 때 씁니다. */
export function dbEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/** 서버 인스턴스마다 하나를 만들어 다시 씁니다. 환경 변수가 없으면 throw 합니다 (값은 메시지에 넣지 않습니다). */
export function getDb(): Db {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase 환경 변수가 없습니다: SUPABASE_URL · SUPABASE_SECRET_KEY (.env.local · Vercel)");
  client = createClient<Database>(url, key, {
    // 로그인 없이 secret 키로만 쓰므로 세션을 저장하거나 갱신하지 않습니다.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Next.js 가 조회 결과를 빌드 때 저장해 두지 않게, DB 요청은 매번 새로 보냅니다.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return client;
}
