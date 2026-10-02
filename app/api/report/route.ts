import { NextResponse } from "next/server";
import { z } from "zod";
import { research } from "@/src/agent/muffin";
import { areas, depths } from "@/src/agent/schema";

// tool 여러 개를 호출하므로 기본 10초보다 길게 둡니다.
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().min(1).max(500),
  depth: z.enum(depths).default("standard"),
  area: z.enum(areas).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "question(필수), depth, area 를 확인하세요." }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요." }, { status: 500 });
  }

  try {
    const report = await research(parsed.data);
    return NextResponse.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
