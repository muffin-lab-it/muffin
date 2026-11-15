import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { SECURITY_HEADERS } from "./security-headers";

describe("보안 헤더 (next.config.ts)", () => {
  it("iframe 금지 · 형식 추측 금지 · 리퍼러 축소 · 기기 권한 끄기가 모든 경로에 붙는다", async () => {
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
    // 스크립트를 막는 CSP 지시어는 넣지 않는다 (Next 인라인 스크립트와 충돌)
    expect(byKey["Content-Security-Policy"]).not.toMatch(/script-src|default-src/);

    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/(.*)", headers: SECURITY_HEADERS }]);
  });
});
