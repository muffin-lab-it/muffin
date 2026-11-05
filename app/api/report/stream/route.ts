import { z } from "zod";
import type { ToolStep } from "@/src/agent/context";
import type { MuffinEvent } from "@/src/agent/events";
import { isMockMode, mockResearch } from "@/src/agent/mock";
import { research, type ResearchResult } from "@/src/agent/muffin";
import { areas, depths, type Intent, type Report } from "@/src/agent/schema";
import { clip, newRunId, type RunLog } from "@/src/lib/log";
import { pickVerification, recordRun } from "@/src/lib/runs";
import { redactSecrets } from "@/src/lib/redact";
import { fitSpeed, getReplay, playReplay, publicStep, replayedReport, REPLAY_ID, SPEED_MAX, SPEED_MIN } from "@/src/lib/replay";

export const maxDuration = 60;

// 플랫폼의 강제 종료 전에 클라이언트에 종료 이유를 전달합니다.
const STREAM_TIMEOUT_MS = 55_000;
const bodySchema = z.object({
  question: z.string().trim().min(1).max(500),
  depth: z.enum(depths).default("standard"),
  area: z.enum(areas).optional(),
});
const failureMessage = "조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

/** 리플레이 요청: 녹화된 실행을 같은 이벤트로 다시 보냅니다 (src/lib/replay.ts). OpenAI · tool 을 부르지 않습니다 */
const replayBodySchema = z.object({
  replay: z.string().regex(REPLAY_ID),
  speed: z.number().min(SPEED_MIN).max(SPEED_MAX).default(1),
});

function qualityOf(report: ResearchResult["report"]) {
  return {
    numbers: report.numbers.length,
    why: report.why.length,
    whyUnsupported: report.why.filter((why) => why.basis === "none").length,
    dataGaps: report.dataGaps.length,
    sources: report.sources.length,
  };
}

/** 스트림 한 번의 결과. 실제 실행 · Mock · 리플레이가 같은 모양으로 끝납니다 */
type Outcome = {
  report: Report;
  steps: ToolStep[];
  rewrites: number;
  model?: string;
  usage?: ResearchResult["usage"];
  intent?: Intent;
};
type Run = (onEvent: (event: MuffinEvent) => void) => Promise<Outcome>;
type StreamContext = { id: string; started: number; at: string; mock: boolean; input: RunLog["input"]; headers: Record<string, string> };

export async function POST(req: Request) {
  const id = newRunId();
  const started = Date.now();
  const at = new Date(started).toISOString();
  const mock = isMockMode();
  const raw = await req.json().catch(() => null);
  const headers = { "Cache-Control": "no-store", "X-Request-Id": id };

  // 리플레이: { replay: id, speed? }. 녹화된 실행을 다시 보내므로 키가 없어도 되고, 로그에는 mock 으로 남겨 운영 통계에서 뺍니다
  if (raw && typeof raw === "object" && "replay" in raw) {
    const parsedReplay = replayBodySchema.safeParse(raw);
    if (!parsedReplay.success) {
      recordRun({ id, at, mock: true, ok: false, stage: "input", ms: Date.now() - started, error: "invalid replay body" }, req);
      return Response.json({ error: "replay(녹화 id), speed(0.25~10) 를 확인하세요.", id }, { status: 400, headers });
    }
    const replay = getReplay(parsedReplay.data.replay);
    if (!replay) {
      recordRun({ id, at, mock: true, ok: false, stage: "input", ms: Date.now() - started, error: `unknown replay ${parsedReplay.data.replay}` }, req);
      return Response.json({ error: "저장된 실행을 찾을 수 없습니다.", id }, { status: 404, headers });
    }
    const input = { question: replay.question, depth: replay.depth, ...(replay.area ? { area: replay.area } : {}) };
    // 스트림은 55초에 닫히므로, 요청한 속도로 그 안에 못 끝나면 끝날 만큼 빠르게 돌립니다 (report 없이 error 로 끝나지 않게)
    const speed = fitSpeed(replay, parsedReplay.data.speed, STREAM_TIMEOUT_MS - 5_000);
    const run: Run = async (onEvent) => {
      await playReplay(replay, onEvent, { speed, signal: req.signal });
      const planned = replay.events.find((e) => e.type === "plan");
      return { report: replayedReport(replay), steps: replay.steps, rewrites: replay.rewrites, model: `replay:${replay.id}`, ...(planned && planned.type === "plan" ? { intent: planned.intent } : {}) };
    };
    return streamResponse(req, run, { id, started, at, mock: true, input, headers });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    recordRun({ id, at, mock, ok: false, stage: "input", ms: Date.now() - started, error: "invalid body" }, req);
    return Response.json({ error: "question(필수), depth, area 를 확인하세요.", id }, { status: 400, headers });
  }
  const input = { ...parsed.data, question: clip(redactSecrets(parsed.data.question)) };
  if (!mock && !process.env.OPENAI_API_KEY) {
    recordRun({ id, at, mock, input, ok: false, stage: "config", ms: Date.now() - started, error: "OPENAI_API_KEY missing" }, req);
    return Response.json({ error: "리포트 서비스 설정을 확인해 주세요.", id }, { status: 503, headers });
  }
  const run: Run = async (onEvent) => {
    const result = await (mock ? mockResearch : research)(parsed.data, { onEvent });
    return { report: result.report, steps: result.steps, rewrites: result.rewrites, model: result.model, usage: result.usage, intent: result.plan.intent };
  };
  return streamResponse(req, run, { id, started, at, mock, input, headers });
}

/** NDJSON 스트림. 진행 이벤트는 바로 보내고, 끝나면 report(또는 error) 한 번과 로그 한 줄로 닫습니다. 55초를 넘기면 error 로 닫습니다 */
function streamResponse(req: Request, run: Run, { id, started, at, mock, input, headers }: StreamContext): Response {
  const encoder = new TextEncoder();
  let disconnect = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: MuffinEvent) => {
        if (!closed) controller.enqueue(encoder.encode(redactSecrets(JSON.stringify(event)) + "\n"));
      };
      type Completion = Pick<RunLog, "ok" | "stage"> & Partial<Pick<RunLog, "error" | "model" | "usage" | "steps" | "rewrites" | "quality" | "verification" | "intent">>;
      const finish = (completion: Completion, terminal?: MuffinEvent, cancelled = false) => {
        if (closed) return;
        try {
          if (terminal) send(terminal);
        } finally {
          closed = true;
          clearTimeout(timer);
          req.signal.removeEventListener("abort", abort);
          if (!cancelled) controller.close();
          recordRun({ id, at, mock, input, ms: Date.now() - started, ...completion }, req);
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
          const result = await run((event) => {
            // terminal 이벤트는 요청 id를 관리하는 라우트만 발행합니다.
            if (event.type === "report" || event.type === "error") return;
            send(event.type === "step" ? { ...event, step: publicStep(event.step) } : event);
          });
          if (closed) return;
          const steps = result.steps.map(publicStep);
          finish(
            {
              ok: true,
              stage: "ok",
              ...(result.model ? { model: result.model } : {}),
              ...(result.usage ? { usage: result.usage } : {}),
              steps: result.steps.map((step) => (step.error ? { ...step, error: clip(redactSecrets(step.error), 500) } : step)),
              rewrites: result.rewrites,
              quality: qualityOf(result.report),
              verification: pickVerification(result.report.verification),
              ...(result.intent ? { intent: result.intent } : {}),
            },
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
