import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, mockResearch } from "@/src/agent/mock";
import { research, type ResearchResult } from "@/src/agent/muffin";
import { areas, depths } from "@/src/agent/schema";
import { clip, logRun, newRunId } from "@/src/lib/log";
import { redactSecrets } from "@/src/lib/redact";
import { readClientId } from "@/src/lib/client";
import { checkLimit, hashIp } from "@/src/lib/ratelimit";

// tool 여러 개를 호출하므로 기본 10초보다 길게 둡니다.
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().trim().min(1).max(500),
  depth: z.enum(depths).default("standard"),
  area: z.enum(areas).optional(),
});

/** 리포트에서 품질 신호만 뽑아 로그에 남깁니다. */
function qualityOf(r: ResearchResult["report"]) {
  return {
    numbers: r.numbers.length,
    why: r.why.length,
    whyUnsupported: r.why.filter((w) => w.basis === "none").length,
    dataGaps: r.dataGaps.length,
    sources: r.sources.length,
  };
}

export async function POST(req: Request) {
  const id = newRunId();
  const started = Date.now();
  const at = new Date(started).toISOString();
  const mock = isMockMode();
  const ms = () => Date.now() - started;

  // v1: in-memory, per-instance rate limiting. Source guard will run before this
  // when the guard PR is integrated, as required by docs/web-spec.md.
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || req.headers.get("x-real-ip") || "unknown";
  const rate = await checkLimit({
    clientId: readClientId(req.headers),
    ipHash: hashIp(ip, process.env.RATE_LIMIT_SALT ?? ""),
  });
  if (!rate.ok) {
    logRun({ id, at, ok: false, stage: "limited", mock, ms: ms(), error: "rate limit exceeded" });
    return NextResponse.json(
      { error: `요청이 많아요. ${Math.ceil(rate.retryAfterSec / 60)}분 뒤 다시 시도해 주세요.`, id, retryAfterSec: rate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    logRun({ id, at, ok: false, stage: "input", mock, ms: ms(), error: "invalid body" });
    return NextResponse.json({ error: "question(필수), depth, area 를 확인하세요.", id }, { status: 400 });
  }
  const input = { ...parsed.data, question: clip(redactSecrets(parsed.data.question)) };

  if (!mock && !process.env.OPENAI_API_KEY) {
    logRun({ id, at, ok: false, stage: "config", mock, input, ms: ms(), error: "OPENAI_API_KEY missing" });
    return NextResponse.json({ error: "리포트 서비스 설정을 확인해 주세요.", id }, { status: 503 });
  }

  try {
    // MUFFIN_MOCK=1 이면 샘플 리포트. 프론트 개발용.
    const result = mock ? await mockResearch(parsed.data) : await research(parsed.data);
    const steps = result.steps.map((step) => step.error ? { ...step, error: "데이터를 확인하지 못했습니다." } : step);
    logRun({
      id,
      at,
      ok: true,
      stage: "ok",
      mock,
      input,
      ms: ms(),
      model: result.model,
      usage: result.usage,
      steps: result.steps.map((step) => step.error ? { ...step, error: clip(redactSecrets(step.error), 500) } : step),
      rewrites: result.rewrites,
      quality: qualityOf(result.report),
    });
    return NextResponse.json({ report: result.report, steps, rewrites: result.rewrites, id });
  } catch (err) {
    const diagnostic = clip(redactSecrets(err instanceof Error ? err.message : String(err)), 500);
    const message = "조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    logRun({ id, at, ok: false, stage: "agent", mock, input, ms: ms(), error: diagnostic });
    return NextResponse.json({ error: message, id }, { status: 500 });
  }
}
