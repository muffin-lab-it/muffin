/**
 * 요청 앞단 (Next.js 16 의 proxy, 예전 이름 middleware). 리더 관리.
 * 지금은 /admin 만 봅니다. ADMIN_PASSWORD 가 비어 있으면 404, 비밀번호가 없거나 틀리면 401 로 브라우저 로그인 창을 띄웁니다.
 */
import type { NextRequest } from "next/server";
import { ADMIN_CHALLENGE, adminEnabled, isAdminAuthorized } from "@/src/lib/admin-auth";

export function proxy(request: NextRequest) {
  if (!adminEnabled()) return new Response("Not Found", { status: 404 });
  if (isAdminAuthorized(request.headers.get("authorization"))) return;
  return new Response("관리자 비밀번호가 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": ADMIN_CHALLENGE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
