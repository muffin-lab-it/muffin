/**
 * 프론트에서 API 를 부르는 단 하나의 창구. 백엔드가 라우트를 바꿔도 프론트는 이 파일만 봅니다.
 *
 *  createReport  POST /api/report        완료 후 JSON 한 번에
 *  streamReport  POST /api/report/stream NDJSON 이벤트 스트림. 진행 화면용
 *
 * 모든 요청에 브라우저 익명 id(X-Muffin-Client)를 붙입니다. 실패하면 ApiError 를 throw 하고, message 는 화면에 그대로 보여 줄 문장입니다.
 */
import type { ToolStep } from "../agent/context";
import type { MuffinEvent } from "../agent/events";
import type { Area, Depth, Report } from "../agent/schema";
import { CLIENT_HEADER, getClientId } from "./client";

export type ReportRequest = { question: string; depth: Depth; area?: Area };
export type ReportResponse = { report: Report; steps: ToolStep[]; rewrites: number; /** 서버 로그의 요청 id */ id?: string };

/** API 실패. 429(호출 제한)면 retryAfterSec 로 다시 시도할 수 있을 때까지 남은 초를 알 수 있습니다. */
export class ApiError extends Error {
  readonly status: number;
  readonly id?: string;
  readonly retryAfterSec?: number;

  constructor(message: string, status: number, id?: string, retryAfterSec?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.id = id;
    this.retryAfterSec = retryAfterSec;
  }
}

type ErrorBody = { error?: string; id?: string; retryAfterSec?: number };

const positive = (n: unknown): number | undefined => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);

/** 서버 문장을 그대로 쓰고 요청 id 를 붙입니다. 429 인데 문장이 없으면 남은 시간으로 만듭니다 (바디의 retryAfterSec, 없으면 Retry-After 헤더). */
function failure(json: ErrorBody, status: number, retryAfterHeader?: string | null): ApiError {
  const retryAfterSec = status === 429 ? (positive(json.retryAfterSec) ?? positive(Number(retryAfterHeader))) : undefined;
  const fallback = status === 429 ? `요청이 많아요. ${Math.max(1, Math.ceil((retryAfterSec ?? 60) / 60))}분 뒤 다시 시도해 주세요.` : `HTTP ${status}`;
  const ref = json.id ? ` (요청 id: ${json.id})` : "";
  return new ApiError(`${json.error ?? fallback}${ref}`, status, json.id, retryAfterSec);
}

/** 브라우저 익명 id 는 서버 렌더링에서는 비어 있어서 그때는 붙이지 않습니다. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const clientId = getClientId();
  return { "Content-Type": "application/json", ...(clientId ? { [CLIENT_HEADER]: clientId } : {}), ...extra };
}

export async function createReport(input: ReportRequest): Promise<ReportResponse> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<ReportResponse> & ErrorBody;
  if (!res.ok || !json.report) throw failure(json, res.status, res.headers.get("Retry-After"));
  return { report: json.report, steps: json.steps ?? [], rewrites: json.rewrites ?? 0, id: json.id };
}

/**
 * 이벤트를 한 줄씩 받으면서 onEvent 를 부르고, report 이벤트가 오면 createReport 와 같은 모양으로 끝납니다.
 * error 이벤트나 HTTP 오류는 throw 합니다. 라우트가 아직 없으면 404 로 실패하니 그때는 createReport 를 쓰면 됩니다.
 */
export async function streamReport(input: ReportRequest, onEvent: (event: MuffinEvent) => void): Promise<ReportResponse> {
  const res = await fetch("/api/report/stream", {
    method: "POST",
    headers: headers({ Accept: "application/x-ndjson" }),
    body: JSON.stringify(input),
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as ErrorBody;
    throw failure(json, res.status, res.headers.get("Retry-After"));
  }

  let final: ReportResponse | undefined;
  const handle = (line: string) => {
    const event = JSON.parse(line) as MuffinEvent;
    onEvent(event);
    if (event.type === "report") {
      final = { report: event.report, steps: event.steps, rewrites: event.rewrites, id: event.id };
    } else if (event.type === "error") {
      throw failure({ error: event.message, id: event.id }, res.status);
    }
  };

  // 청크가 줄 중간에서 끊길 수 있어서 개행이 나올 때까지 모았다가 한 줄씩 처리합니다.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) handle(line);
    }
  }
  if (buffer.trim()) handle(buffer.trim());

  if (!final) throw new Error("스트림이 리포트 없이 끝났습니다.");
  return final;
}
