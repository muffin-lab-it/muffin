import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, mockResearch } from "@/src/agent/mock";
import { research, type ResearchResult } from "@/src/agent/muffin";
import { areas, depths } from "@/src/agent/schema";
import { clip, logRun, newRunId } from "@/src/lib/log";

// tool 여러 개를 호출하므로 기본 10초보다 길게 둡니다.
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().min(1).max(500),
  depth: z.enum(depths).default("standard"),
  area: z.enum(areas).optional(),
});

/** 리포트에서 품질 신호만 뽑아 로그에 남깁니다. */
function qualityOf(r: ResearchResult["report"]) {
  return {
    numbers: r.numbers.length,
    why: r.why.length,
    whyUnsupported: r.why.filter((w) => /확인되지\s*않/.test(w.evidence)).length,
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

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    logRun({ id, at, ok: false, stage: "input", mock, ms: ms(), error: "invalid body" });
    return NextResponse.json({ error: "question(필수), depth, area 를 확인하세요.", id }, { status: 400 });
  }
  const input = { ...parsed.data, question: clip(parsed.data.question) };

  if (!mock && !process.env.OPENAI_API_KEY) {
    logRun({ id, at, ok: false, stage: "config", mock, input, ms: ms(), error: "OPENAI_API_KEY missing" });
    return NextResponse.json({ error: "OPENAI_API_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요.", id }, { status: 500 });
  }

  try {
    // MUFFIN_MOCK=1 이면 샘플 리포트. 프론트 개발용.
    const result = mock ? await mockResearch(parsed.data) : await research(parsed.data);
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
      steps: result.steps,
      rewrites: result.rewrites,
      quality: qualityOf(result.report),
    });
    return NextResponse.json({ report: result.report, steps: result.steps, rewrites: result.rewrites, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    logRun({ id, at, ok: false, stage: "agent", mock, input, ms: ms(), error: clip(message, 500) });
    return NextResponse.json({ error: message, id }, { status: 500 });
  }
}
