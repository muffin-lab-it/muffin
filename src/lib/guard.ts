/**
 * API 보호: 출처 검사와 바디 크기 제한 (docs/web-spec.md 4.6). `src/agent/guard.ts`(권유 표현 검사)와 다른 파일입니다.
 *
 *  checkOrigin      POST · DELETE 라우트 맨 앞(호출 제한보다 앞)에서 부릅니다. 허용 목록에 없는 출처면 403.
 *  readJsonLimited  req.json() 대신 씁니다. 한도를 넘으면 BodyTooLargeError → 413. JSON 이 아니면 null (라우트의 입력 검사가 400).
 *
 * 허용 목록은 ALLOWED_ORIGINS(쉼표 구분)이고, 없으면 기본값을 씁니다. 항목은 소문자 · 끝 슬래시 없이 맞춥니다.
 * `*` 는 호스트 이름의 점(.)이 없는 한 부분만 대신합니다 (Vercel 미리보기 주소 `muffin-git-xxx-thdude37-2971s-projects.vercel.app`).
 * Origin · Referer 가 둘 다 없는 요청(curl 등)은 개발 · 테스트 환경에서만 통과합니다. NODE_ENV 가 비었거나 다른 값이면 막습니다.
 */

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://muffin-kappa.vercel.app",
  "https://*-thdude37-2971s-projects.vercel.app",
  "http://localhost:3000",
];

/** 라우트가 응답에 그대로 씁니다: `{ error, id }` */
export const ORIGIN_DENIED_MESSAGE = "허용되지 않은 출처입니다.";
export const BODY_TOO_LARGE_MESSAGE = "요청이 너무 큽니다.";

/** 바디 한도. 리포트 생성 16KB, History POST 512KB */
export const BODY_LIMIT = { report: 16 * 1024, history: 512 * 1024 } as const;

function isDev(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

type Matcher = (origin: string) => boolean;

/** 항목을 출처 모양(소문자, 끝 / 없음)으로 맞춥니다. `https://Muffin.app/` → `https://muffin.app` */
function toMatcher(entry: string): Matcher | undefined {
  const pattern = entry.trim().toLowerCase().replace(/\/+$/, "");
  if (!pattern) return undefined;
  if (!pattern.includes("*")) {
    try {
      const origin = new URL(pattern).origin;
      return (o) => o === origin;
    } catch {
      return undefined;
    }
  }
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
      .join("[a-z0-9-]+")}$`,
  );
  return (o) => re.test(o);
}

// 환경 변수 값이 바뀔 때만 다시 만듭니다 (테스트의 stubEnv 도 그대로 동작).
let cached: { raw: string | undefined; matchers: Matcher[] } | undefined;

function allowed(): Matcher[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (cached && cached.raw === raw) return cached.matchers;
  const fromEnv = (raw ?? "").split(",").map(toMatcher).filter((m): m is Matcher => !!m);
  const matchers = fromEnv.length ? fromEnv : DEFAULT_ALLOWED_ORIGINS.map(toMatcher).filter((m): m is Matcher => !!m);
  cached = { raw, matchers };
  return matchers;
}

/** Origin 이 없으면 Referer 의 출처를 씁니다. Referer 가 주소가 아니면 "null"(허용 안 함)로 봅니다. */
function requestOrigin(headers: Headers): string | undefined {
  const origin = headers.get("origin");
  if (origin) return origin.toLowerCase();
  const referer = headers.get("referer");
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return "null";
  }
}

export function checkOrigin(req: Request): { ok: true } | { ok: false; status: 403 } {
  const origin = requestOrigin(req.headers);
  if (origin === undefined) return isDev() ? { ok: true } : { ok: false, status: 403 };
  return allowed().some((m) => m(origin)) ? { ok: true } : { ok: false, status: 403 };
}

export class BodyTooLargeError extends Error {
  readonly status = 413;
  constructor(readonly maxBytes: number) {
    super(`요청 바디가 ${maxBytes} 바이트를 넘었습니다.`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Content-Length 가 한도를 넘으면 읽지 않고 바로 던집니다. Content-Length 가 없거나 틀릴 수 있어서
 * 실제로 읽은 바이트도 세고, 한도를 넘는 순간 읽기를 멈춥니다.
 */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(await new Blob(chunks).text());
  } catch {
    return null;
  }
}
