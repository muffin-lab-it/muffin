/**
 * History API 두 라우트가 같이 쓰는 앞단 검사와 응답 (docs/web-spec.md 4.2 · 4.6).
 * 순서: 출처 검사(POST · DELETE 만) → 브라우저 익명 id → 저장소 설정. 통과하면 clientId 를, 아니면 바로 돌려줄 응답을 줍니다.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readClientId } from "@/src/lib/client";
import { dbEnabled } from "@/src/lib/db";
import { ORIGIN_DENIED_MESSAGE, checkOrigin } from "@/src/lib/guard";
import { newRunId } from "@/src/lib/log";
import { redactSecrets } from "@/src/lib/redact";

/** 리포트 요청 id(newRunId) 모양. 주소에 넣어도 안전한 글자만 */
export const recordIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

export function errorJson(status: number, error: string, id: string = newRunId()) {
  return NextResponse.json({ error, id }, { status });
}

/** id 는 찾던 기록 id. 형식이 틀린 id 는 되돌려 주지 않고 요청 id 를 씁니다 */
export function notFound(id?: string) {
  return errorJson(404, "리포트를 찾을 수 없어요.", id);
}

/** DB 오류는 화면에는 짧은 문장만, 서버 로그에는 비밀값을 지운 원문을 남깁니다 */
export function serverError(action: string, err: unknown) {
  const id = newRunId();
  console.error(`history ${action} 실패 (${id}): ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
  return errorJson(500, "저장함을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", id);
}

export function guard(req: Request, { origin }: { origin: boolean }): { clientId: string } | { response: NextResponse } {
  if (origin && !checkOrigin(req).ok) return { response: errorJson(403, ORIGIN_DENIED_MESSAGE) };
  const clientId = readClientId(req.headers);
  if (!clientId) return { response: errorJson(400, "브라우저 id(X-Muffin-Client)가 없거나 형식이 맞지 않아요.") };
  if (!dbEnabled()) return { response: errorJson(503, "저장소 설정을 확인해 주세요.") };
  return { clientId };
}
