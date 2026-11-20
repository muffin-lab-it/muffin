import { NextResponse } from "next/server";
import { guard, notFound, recordIdSchema, serverError } from "../shared";
import { deleteReport, findReport } from "../store";

type Ctx = { params: Promise<{ id: string }> };

/** 리포트 한 건. 없거나 다른 브라우저의 기록이면 404 */
export async function GET(req: Request, ctx: Ctx) {
  const checked = guard(req, { origin: false });
  if ("response" in checked) return checked.response;
  const { id } = await ctx.params;
  if (!recordIdSchema.safeParse(id).success) return notFound();

  try {
    const record = await findReport(checked.clientId, id);
    return record ? NextResponse.json({ record }) : notFound(id);
  } catch (err) {
    return serverError("조회", err);
  }
}

/** 삭제. 지웠으면 204, 없거나 다른 브라우저의 기록이면 404 */
export async function DELETE(req: Request, ctx: Ctx) {
  const checked = guard(req, { origin: true });
  if ("response" in checked) return checked.response;
  const { id } = await ctx.params;
  if (!recordIdSchema.safeParse(id).success) return notFound();

  try {
    return (await deleteReport(checked.clientId, id)) ? new NextResponse(null, { status: 204 }) : notFound(id);
  } catch (err) {
    return serverError("삭제", err);
  }
}
