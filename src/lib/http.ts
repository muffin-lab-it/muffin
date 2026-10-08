/**
 * 공통 HTTP 헬퍼. 모든 tool 이 같은 방식으로 호출·실패하도록 합니다.
 * 응답을 어떻게 읽고 어떤 값을 뽑을지는 각 tool 이 알아서 합니다.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    body?: string,
  ) {
    super(`HTTP ${status} ${url}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    this.name = "HttpError";
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
