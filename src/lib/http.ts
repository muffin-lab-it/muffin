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

export type FetchOptions = {
  headers?: Record<string, string>;
  /** 기본 8초. 넘기면 TimeoutError 로 실패합니다. */
  timeoutMs?: number;
};

async function doFetch(url: string, { headers, timeoutMs = 8_000 }: FetchOptions): Promise<Response> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
  return res;
}

/** JSON 응답을 받아 파싱합니다. 2xx 가 아니면 HttpError. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await doFetch(url, opts);
  return (await res.json()) as T;
}

/** 텍스트(RSS/XML/CSV 등) 응답을 문자열로 받습니다. 파싱은 호출한 쪽에서. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await doFetch(url, opts);
  return res.text();
}
