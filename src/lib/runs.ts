/**
 * 실행 로그를 runs 표에 저장 — 리더 임시 구현 (2026-11-05). 명세 4.4 의 저장은 서영 몫입니다.
 * 서영의 구현(호출 제한 v2 와 함께 요청 시작 때 `started` 줄을 넣고 끝나면 갱신)이 오기 전까지, 요청이 끝난 뒤 같은 RunLog 를 한 줄로 넣어
 * /admin 이 실제 기록을 보게 합니다.
 *
 * 갈아 끼우기: 라우트 두 곳(app/api/report/route.ts · stream/route.ts)은 `recordRun(entry, req)` 하나만 부릅니다. 서영의 구현이 들어오면
 * 이 파일의 `recordRun` 안을 그쪽 호출로 바꾸거나, 라우트의 `recordRun` 을 `logRun` 으로 되돌리고 이 파일을 지우면 됩니다. 다른 코드는 손댈 게 없습니다.
 * 동작: `logRun`(콘솔)은 그대로 두고, Supabase 환경 변수가 있으면 응답이 끝난 뒤(`after`) 2초 제한으로 upsert 합니다.
 * 실패는 콘솔에만 남기고 응답에는 영향이 없습니다. client_id 는 요청 헤더의 브라우저 id(uuid)이고 ip_hash 는 호출 제한(서영)이 채울 칸이라 비워 둡니다.
 */
import { after } from "next/server";
import type { Verification } from "../agent/schema";
import { readClientId } from "./client";
import { dbEnabled, getDb } from "./db";
import { logRun, type RunLog } from "./log";

export const SAVE_TIMEOUT_MS = 2_000;
export type RunEntry = Omit<RunLog, "type">;

/** 리포트의 verification 에서 표에 넣는 칸만 (status · numbers · why · advice · revisions) */
export function pickVerification(v: Verification): NonNullable<RunLog["verification"]> {
  return { status: v.status, numbers: v.numbers, why: v.why, advice: v.advice, revisions: v.revisions };
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

/** runs 표에 한 줄 upsert. 환경 변수가 없으면 아무것도 안 하고 false. 실패 · 지연도 false (콘솔 경고) */
export async function saveRun(entry: RunEntry, { clientId, timeoutMs = SAVE_TIMEOUT_MS }: { clientId?: string; timeoutMs?: number } = {}): Promise<boolean> {
  if (!dbEnabled()) return false;
  const row = {
    id: entry.id,
    at: entry.at,
    ok: entry.ok,
    stage: entry.stage,
    mock: entry.mock,
    client_id: clientId ?? null,
    ip_hash: null,
    input: entry.input ?? null,
    ms: entry.ms,
    model: entry.model ?? null,
    usage: entry.usage ?? null,
    steps: entry.steps ?? null,
    rewrites: entry.rewrites ?? null,
    quality: entry.quality ?? null,
    verification: entry.verification ?? null,
    intent: entry.intent ?? null,
    error: entry.error ?? null,
  };
  try {
    const res = await withTimeout(getDb().from("runs").upsert(row, { onConflict: "id" }), timeoutMs);
    if (res.error) throw new Error(res.error.message);
    return true;
  } catch (err) {
    console.warn(`runs 저장 실패 (${entry.id}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * 라우트가 부르는 유일한 함수. 콘솔 로그는 바로, 표 저장은 응답이 끝난 뒤(`after`). `after` 를 쓸 수 없는 곳(테스트 · 스크립트)이면 바로 저장합니다.
 */
export function recordRun(entry: RunEntry, req?: Request): void {
  logRun(entry);
  if (!dbEnabled()) return;
  const clientId = req ? readClientId(req.headers) : undefined;
  const save = () => saveRun(entry, { clientId }).then(() => undefined);
  try {
    after(save);
  } catch {
    void save();
  }
}
