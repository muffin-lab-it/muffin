/**
 * 브라우저 익명 id. 로그인 대신 저장함과 호출 제한을 브라우저 단위로 구분합니다 (docs/web-spec.md 3.1 · 4.2). 리더 관리.
 *
 *  getClientId   브라우저: localStorage `muffin.client` 에 uuid v4 를 한 번 만들어 두고 계속 씁니다. 서버 렌더링에서는 빈 문자열.
 *  readClientId  서버: 요청 헤더 `X-Muffin-Client` 가 uuid v4 면 그 값, 없거나 형식이 틀리면 undefined (그때는 IP 로 셈).
 *
 * localStorage 가 막혀 있으면(시크릿 창 등) 이 탭에서만 쓰는 id 를 만듭니다. 그 id 의 저장함은 탭을 닫으면 사라집니다.
 */

export const CLIENT_HEADER = "X-Muffin-Client";

const KEY = "muffin.client";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let tabOnly: string | undefined;

export function isClientId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // 보안 컨텍스트가 아니면(http 로 LAN 주소에 접속하는 등) randomUUID 가 없어서 직접 uuid v4 를 만듭니다.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  try {
    const saved = window.localStorage.getItem(KEY);
    if (isClientId(saved)) return saved;
    const id = newClientId();
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    tabOnly ??= newClientId();
    return tabOnly;
  }
}

export function readClientId(headers: Headers): string | undefined {
  const value = headers.get(CLIENT_HEADER);
  return isClientId(value) ? value : undefined;
}
