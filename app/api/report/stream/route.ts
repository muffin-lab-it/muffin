import { z } from "zod";
import type { ToolStep } from "@/src/agent/context";
import type { MuffinEvent } from "@/src/agent/events";
import { isMockMode, mockResearch } from "@/src/agent/mock";
import { research, type ResearchResult } from "@/src/agent/muffin";
import { areas, depths } from "@/src/agent/schema";
import { clip, logRun, newRunId, type RunLog } from "@/src/lib/log";
import { redactSecrets } from "@/src/lib/redact";
import { readClientId } from "@/src/lib/client";
import { checkLimit, hashIp } from "@/src/lib/ratelimit";

export const maxDuration = 60;

// 플랫폼의 강제 종료 전에 클라이언트에 종료 이유를 전달합니다.
const STREAM_TIMEOUT_MS = 55_000;
const bodySchema = z.object({
  question: z.string().trim().min(1).max(500),
  depth: z.enum(depths).default("standard"),
  area: z.enum(areas).optional(),
});
const failureMessage = "조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

function publicStep(step: ToolStep): ToolStep {
  // 외부 서비스 오류에는 URL, 인증 헤더 등이 포함될 수 있습니다.
  return step.error ? { ...step, error: "데이터를 확인하지 못했습니다." } : step;
}

function qualityOf(report: ResearchResult["report"]) {
  return {
    numbers: report.numbers.length,
    why: report.why.length,
    whyUnsupported: report.why.filter((why) => why.basis === "none").length,
    dataGaps: report.dataGaps.length,
    sources: report.sources.length,
  };
}

export async function POST(req: Request) {
  const id = newRunId();
  const started = Date.now();
  const at = new Date(started).toISOString();
  const mock = isMockMode();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": id };

  // v1: in-memory, per-instance rate limiting. Source guard must precede this
  // when the guard PR is integrated, as required by docs/web-spec.md.
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || req.headers.get("x-real-ip") || "unknown";
  const rate = await checkLimit({
    clientId: readClientId(req.headers),
    ipHash: hashIp(ip, process.env.RATE_LIMIT_SALT ?? ""),
  });
  if (!rate.ok) {
    logRun({ id, at, mock, ok: false, stage: "limited", ms: Date.now() - started, error: "rate limit exceeded" });
    return Response.json(
      { error: `요청이 많아요. ${Math.ceil(rate.retryAfterSec / 60)}분 뒤 다시 시도해 주세요.`, id, retryAfterSec: rate.retryAfterSec },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    logRun({ id, at, mock, ok: false, stage: "input", ms: Date.now() - started, error: "invalid body" });
    return Response.json({ error: "question(필수), depth, area 를 확인하세요.", id }, { status: 400, headers });
  }
  const input = { ...parsed.data, question: clip(redactSecrets(parsed.data.question)) };
  if (!mock && !process.env.OPENAI_API_KEY) {
    logRun({ id, at, mock, input, ok: false, stage: "config", ms: Date.now() - started, error: "OPENAI_API_KEY missing" });
    return Response.json({ error: "리포트 서비스 설정을 확인해 주세요.", id }, { status: 503, headers });
  }

  const encoder = new TextEncoder();
  let disconnect = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: MuffinEvent) => {
        if (!closed) controller.enqueue(encoder.encode(redactSecrets(JSON.stringify(event)) + "\n"));
      };
      type Completion = Pick<RunLog, "ok" | "stage"> & Partial<Pick<RunLog, "error" | "model" | "usage" | "steps" | "rewrites" | "quality">>;
      const finish = (completion: Completion, terminal?: MuffinEvent, cancelled = false) => {
        if (closed) return;
        try {
          if (terminal) send(terminal);
        } finally {
          closed = true;
          clearTimeout(timer);
          req.signal.removeEventListener("abort", abort);
          if (!cancelled) controller.close();
          logRun({ id, at, mock, input, ms: Date.now() - started, ...completion });
        }
      };
      const abort = () => finish({ ok: false, stage: "agent", error: "client disconnected" });
      disconnect = () => finish({ ok: false, stage: "agent", error: "client disconnected" }, undefined, true);
      const timer = setTimeout(() => finish(
        { ok: false, stage: "agent", error: "stream deadline exceeded" },
        { type: "error", message: "조사 시간이 초과되었습니다. 질문 범위를 줄여 다시 시도해 주세요.", id },
      ), STREAM_TIMEOUT_MS);
      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) {
        abort();
        return;
      }

      // core에 AbortSignal 계약이 생기기 전까지 연결 종료는 출력만 멈춥니다.
      void (async () => {
        try {
          const run = mock ? mockResearch : research;
          const result = await run(parsed.data, {
            onEvent(event) {
              // terminal 이벤트는 요청 id를 관리하는 라우트만 발행합니다.
              if (event.type === "report" || event.type === "error") return;
              send(event.type === "step" ? { ...event, step: publicStep(event.step) } : event);
            },
          });
          if (closed) return;
          const steps = result.steps.map(publicStep);
          finish(
            { ok: true, stage: "ok", model: result.model, usage: result.usage, steps: result.steps.map((step) => step.error ? { ...step, error: clip(redactSecrets(step.error), 500) } : step), rewrites: result.rewrites, quality: qualityOf(result.report) },
            { type: "report", report: result.report, steps, rewrites: result.rewrites, id },
          );
        } catch (err) {
          const diagnostic = clip(redactSecrets(err instanceof Error ? err.message : String(err)), 500);
          finish({ ok: false, stage: "agent", error: diagnostic }, { type: "error", message: failureMessage, id });
        }
      })();
    },
    cancel() {
      disconnect();
    },
  });

  return new Response(stream, {
    headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" },
  });
}
