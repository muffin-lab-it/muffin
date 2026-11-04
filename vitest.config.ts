import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "app/**/*.test.{ts,tsx}"],
    // tool 응답 캐시(폴백) · 회로 차단기는 테스트에서 끕니다. tool 테스트는 실패하면 실패로 끝나야 하고, 둘 자체는 cache.test · breaker.test · define.test 가 켜고 확인합니다
    env: { TOOL_CACHE: "0", TOOL_BREAKER: "0" },
  },
});
