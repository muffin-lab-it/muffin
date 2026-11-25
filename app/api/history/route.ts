import { after, NextResponse } from "next/server";
import { z } from "zod";
import { areas, depths, reportSchema } from "@/src/agent/schema";
import { BODY_LIMIT, BODY_TOO_LARGE_MESSAGE, BodyTooLargeError, readJsonLimited } from "@/src/lib/guard";
import { newRunId } from "@/src/lib/log";
import { checkHistoryLimit, hashIp, retryAfterMessage } from "@/src/lib/ratelimit";
import { redactSecrets } from "@/src/lib/redact";
import { errorJson, guard, recordIdSchema, serverError } from "./shared";
import { insertReport, listReports, trimReports } from "./store";

const stepSchema = z.object({
  tool: z.string().max(100),
  status: z.enum(["ok", "error"]),
  ms: z.number().nonnegative(),
  error: z.string().max(1000).optional(),
  fallbackAgeMs: z.number().nonnegative().optional(),
  breaker: z.enum(["open", "half_open"]).optional(),
});

const bodySchema = z.object({
  id: recordIdSchema.optional(),
  /** 브라우저가 처음 저장한 시각. 예전 기록을 나중에 올려도 순서가 그대로이게 받고, 미래 시각은 지금으로 둡니다 (11/24) */
  createdAt: z.iso.datetime({ offset: true }).optional(),
  input: z.object({
    question: z.string().trim().min(1).max(500),
    depth: z.enum(depths),
    area: z.enum(areas).optional(),
  }),
  report: reportSchema,
  steps: z.array(stepSchema).max(100).default([]),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.iso.datetime({ offset: true }).optional(),
});

/** 저장함 목록. 최신순, `?limit=20&before=<ISO>` */
export async function GET(req: Request) {
  const checked = guard(req, { origin: false });
  if ("response" in checked) return checked.response;

  const params = new URL(req.url).searchParams;
  const query = listSchema.safeParse({ limit: params.get("limit") ?? undefined, before: params.get("before") ?? undefined });
  if (!query.success) return errorJson(400, "limit(1~100), before(ISO 시각)를 확인하세요.");

  try {
    return NextResponse.json({ records: await listReports(checked.clientId, query.data) });
  } catch (err) {
    return serverError("목록", err);
  }
}

/** 리포트 저장. 새로 넣으면 201, 같은 브라우저가 같은 id 를 다시 보내면 200(기존 기록), 다른 브라우저의 id 면 409, 저장 한도를 넘으면 429 */
export async function POST(req: Request) {
  const checked = guard(req, { origin: true });
  if ("response" in checked) return checked.response;

  // 저장 한도는 리포트 한도와 따로 셉니다 (src/lib/ratelimit.ts HISTORY_LIMITS)
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || req.headers.get("x-real-ip") || "unknown";
  const rate = await checkHistoryLimit({ clientId: checked.clientId, ipHash: hashIp(ip, process.env.RATE_LIMIT_SALT ?? "") });
  if (!rate.ok) {
    return NextResponse.json(
      { error: retryAfterMessage(rate.retryAfterSec), id: newRunId(), retryAfterSec: rate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  let raw: unknown;
  try {
    raw = await readJsonLimited(req, BODY_LIMIT.history);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return errorJson(413, BODY_TOO_LARGE_MESSAGE);
    return serverError("바디 읽기", err);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return errorJson(400, "id, input, report, steps 를 확인하세요.");

  const { id = newRunId(), createdAt, input, report, steps } = parsed.data;
  const clientId = checked.clientId;
  const created_at = createdAt && Date.parse(createdAt) <= Date.now() ? new Date(createdAt).toISOString() : undefined;
  try {
    const result = await insertReport({ id, client_id: clientId, ...(created_at ? { created_at } : {}), input, report, steps });
    if (result.status === "conflict") return errorJson(409, "이미 쓰인 리포트 id 예요.", id);
    if (result.status === "existing") return NextResponse.json({ record: result.record });

    // 오래된 기록 정리는 응답 뒤에. 실패해도 저장은 성공입니다.
    const trim = () =>
      trimReports(clientId).then(
        () => undefined,
        (e: unknown) => console.warn(`history 정리 실패 (${id}): ${redactSecrets(e instanceof Error ? e.message : String(e))}`),
      );
    try {
      after(trim);
    } catch {
      void trim();
    }
    return NextResponse.json({ record: result.record }, { status: 201 });
  } catch (err) {
    return serverError("저장", err);
  }
}
