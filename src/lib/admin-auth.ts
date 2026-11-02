/**
 * /admin 비밀번호 확인. 리더 관리.
 *
 * 브라우저 기본 로그인 창(HTTP Basic 인증)으로 받은 비밀번호를 환경 변수 ADMIN_PASSWORD 와 비교합니다. 아이디는 보지 않습니다.
 * ADMIN_PASSWORD 가 비어 있으면 아무도 들어갈 수 없고 /admin 은 404 입니다.
 * proxy.ts 가 /admin 앞에서 먼저 확인하고, 페이지(app/admin/page.tsx)도 한 번 더 확인합니다. proxy 의 matcher 가 바뀌어도 열리지 않게 하려는 것입니다.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** 401 응답에 붙이는 WWW-Authenticate. 이 헤더가 있어야 브라우저가 로그인 창을 띄웁니다. */
export const ADMIN_CHALLENGE = 'Basic realm="Muffin admin", charset="UTF-8"';

export function adminEnabled(password = process.env.ADMIN_PASSWORD): boolean {
  return Boolean(password);
}

/** Authorization 헤더("Basic " + base64("아이디:비밀번호"))의 비밀번호가 ADMIN_PASSWORD 와 같은지 봅니다. */
export function isAdminAuthorized(authorization: string | null | undefined, password = process.env.ADMIN_PASSWORD): boolean {
  if (!password || !authorization?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(authorization.slice("Basic ".length).trim(), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  // 길이가 달라도 비교 시간이 같도록 해시끼리 비교합니다.
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password));
}
