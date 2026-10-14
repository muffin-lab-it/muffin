/**
 * 프론트에서 API 를 부르는 단 하나의 창구. 백엔드가 라우트를 바꿔도 프론트는 이 파일만 봅니다.
 */
import type { ToolStep } from "../agent/context";
import type { Area, Depth, Report } from "../agent/schema";

export type ReportRequest = { question: string; depth: Depth; area?: Area };
export type ReportResponse = { report: Report; steps: ToolStep[]; rewrites: number };

export async function createReport(input: ReportRequest): Promise<ReportResponse> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<ReportResponse> & { error?: string };
  if (!res.ok || !json.report) throw new Error(json.error ?? `HTTP ${res.status}`);
  return { report: json.report, steps: json.steps ?? [], rewrites: json.rewrites ?? 0 };
}
