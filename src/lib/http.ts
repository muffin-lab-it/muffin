/**
 * 공통 HTTP 헬퍼. 모든 tool 이 같은 방식으로 호출·실패하도록 합니다.
 * 응답을 어떻게 읽고 어떤 값을 뽑을지는 각 tool 이 알아서 합니다.
 */
import { redactSecrets } from "./redact";
/** 쿼리 문자열을 떼어냅니다. 키를 쿼리로 보내는 API 가 많아서 에러 메시지·로그에는 경로까지만 남깁니다. */
export function stripQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

export class HttpError extends Error {
  /** 쿼리를 뗀 URL. 키가 섞여 들어오지 않습니다. */
  public readonly url: string;

  constructor(
    public readonly status: number,
    url: string,
    body?: string,
  ) {
    const safeUrl = stripQuery(url);
    // 쿼리를 떼고, 경로·본문에 섞인 키 값도 지웁니다 (ECOS 는 키가 경로에 있음).
    super(redactSecrets(`HTTP ${status} ${safeUrl}${body ? ` — ${body.slice(0, 200)}` : ""}`));
    this.name = "HttpError";
    this.url = redactSecrets(safeUrl);
  }
}

/**
 * 2xx 인데 본문이 JSON 이 아닐 때. 점검 페이지 · HTML 에러 페이지가 200 으로 오는 경우입니다
 * (예: FRED 점검 중 "Site Maintenance" 페이지). 페이지 제목이 있으면 메시지에 담아 원인을 바로 알 수 있게 합니다.
 */
export class ResponseFormatError extends Error {
  /** 쿼리를 뗀 URL. 키가 섞여 들어오지 않습니다. */
  public readonly url: string;

  constructor(
    url: string,
    public readonly contentType: string | null,
    body: string,
  ) {
    const safeUrl = redactSecrets(stripQuery(url));
    const title = /<title[^>]*>\s*([^<]{1,120}?)\s*<\/title>/i.exec(body)?.[1];
    super(
      redactSecrets(
        `JSON 이 아닌 응답 (${contentType ?? "content-type 없음"}) ${safeUrl}${title ? ` — 페이지 제목: ${title}` : ""}`,
      ),
    );
    this.name = "ResponseFormatError";
    this.url = safeUrl;
  }
}

export type FetchOptions = {
  headers?: Record<string, string>;
  /** 기본 8초. 넘기면 TimeoutError 로 실패합니다. */
  timeoutMs?: number;
  /**
   * 리디렉션 처리. 기본 "follow"(자동으로 따라감).
   * 허용한 주소만 접근해야 하는 요청(예: 뉴스 기사 본문)은 "error" 로 두면,
   * 다른 주소로 넘겨질 때 따라가지 않고 실패합니다.
   */
  redirect?: "follow" | "error";
};

/**
 * 다시 시도할 만한 실패인지. 시간 초과 · 연결 실패 · 5xx 는 잠깐 뒤에 성공할 수 있고, 4xx(키 · 파라미터 문제)와 429(호출 한도)는
 * 바로 다시 해도 같습니다. 여기서는 재시도하지 않고(한 번 부르면 한 번만 요청) defineTool 이 tool 실행 단위로 한 번 더 시도합니다.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status >= 500;
  if (!err || typeof err !== "object") return false;
  const { name, message, cause } = err as { name?: unknown; message?: unknown; cause?: unknown };
  if (name === "TimeoutError" || name === "AbortError") return true;
  if (cause !== undefined && cause !== err && isRetryable(cause)) return true;
  if (typeof message !== "string") return false;
  // tool 이 HttpError 를 "FRED API 요청 실패 (503)" · "HTTP 503 …" 처럼 감싼 경우. 상태 코드가 괄호 안이나 HTTP 뒤에 온 것만 봅니다
  if (/(?:HTTP\s*5\d\d\b|\(\s*5\d\d\s*\))/.test(message)) return true;
  // "ECOS API 요청 실패" 처럼 상태 코드 없이 끝나는 메시지는 tool 이 시간 초과 · 연결 실패를 감싼 것입니다 (HTTP 오류면 코드가 붙음, src/tools/rate)
  if (/요청 실패\s*$/.test(message)) return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|aborted due to timeout/i.test(message);
}

async function doFetch(url: string, { headers, timeoutMs = 8_000, redirect = "follow" }: FetchOptions): Promise<Response> {
  const res = await fetch(url, { headers, redirect, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
  return res;
}

/** JSON 응답을 받아 파싱합니다. 2xx 가 아니면 HttpError, 2xx 인데 JSON 이 아니면 ResponseFormatError. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await doFetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ResponseFormatError(url, res.headers.get("content-type"), text);
  }
}

/** 텍스트(RSS/XML/CSV 등) 응답을 문자열로 받습니다. 파싱은 호출한 쪽에서. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await doFetch(url, opts);
  return res.text();
}
