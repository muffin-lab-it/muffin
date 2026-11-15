import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, mockResearch } from "@/src/agent/mock";
import { research, type ResearchResult } from "@/src/agent/muffin";
import { areas, depths } from "@/src/agent/schema";
import { BODY_LIMIT, BODY_TOO_LARGE_MESSAGE, BodyTooLargeError, checkOrigin, ORIGIN_DENIED_MESSAGE, readJsonLimited } from "@/src/lib/guard";
import { clip, newRunId } from "@/src/lib/log";
import { costOf } from "@/src/lib/pricing";
import { pickVerification, recordRun } from "@/src/lib/runs";
import { redactSecrets } from "@/src/lib/redact";

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

  // 출처 검사(docs/web-spec.md 4.6): 허용 목록 밖의 출처는 바디를 읽기 전에 403. 실행 기록에는 남기지 않습니다 (외부에서 몰려와도 DB 에 쓰지 않게)
  if (!checkOrigin(req).ok) {
    console.warn(`report origin denied (${id}): ${clip(req.headers.get("origin") ?? req.headers.get("referer") ?? "(none)", 200)}`);
    return NextResponse.json({ error: ORIGIN_DENIED_MESSAGE, id }, { status: 403 });
  }
  // 바디는 16KB 까지만 읽습니다. 넘으면 413, JSON 이 아니면 null → 아래 입력 검사가 400
  let raw: unknown = null;
  try {
    raw = await readJsonLimited(req, BODY_LIMIT.report);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      recordRun({ id, at, ok: false, stage: "input", mock, ms: ms(), error: "body too large" }, req);
      return NextResponse.json({ error: BODY_TOO_LARGE_MESSAGE, id }, { status: 413 });
    }
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    recordRun({ id, at, ok: false, stage: "input", mock, ms: ms(), error: "invalid body" }, req);
    return NextResponse.json({ error: "question(필수), depth, area 를 확인하세요.", id }, { status: 400 });
  }
  const input = { ...parsed.data, question: clip(redactSecrets(parsed.data.question)) };

  if (!mock && !process.env.OPENAI_API_KEY) {
    recordRun({ id, at, ok: false, stage: "config", mock, input, ms: ms(), error: "OPENAI_API_KEY missing" }, req);
    return NextResponse.json({ error: "리포트 서비스 설정을 확인해 주세요.", id }, { status: 500 });
  }

  try {
    // MUFFIN_MOCK=1 이면 샘플 리포트. 프론트 개발용.
    const result = mock ? await mockResearch(parsed.data) : await research(parsed.data);
    const steps = result.steps.map((step) => step.error ? { ...step, error: "데이터를 확인하지 못했습니다." } : step);
    recordRun({
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
      verification: pickVerification(result.report.verification),
      intent: result.plan.intent,
    }, req);
    const cost = costOf(result.usage);
    return NextResponse.json({ report: result.report, steps, rewrites: result.rewrites, id, ...(result.usage ? { usage: result.usage } : {}), ...(cost ? { cost } : {}) });
  } catch (err) {
    const diagnostic = clip(redactSecrets(err instanceof Error ? err.message : String(err)), 500);
    const message = "조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    recordRun({ id, at, ok: false, stage: "agent", mock, input, ms: ms(), error: diagnostic }, req);
    return NextResponse.json({ error: message, id }, { status: 500 });
  }
}
