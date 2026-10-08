/**
 * fixture 기반 테스트. 실제 API 를 호출하지 않으므로 키 없이 CI 에서 돌아갑니다.
 * 자기 tool 로 복사할 때 fixture 와 기대값만 바꾸면 됩니다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixture.json";
import { execute } from "./index";

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("sample fx tool", () => {
  it("정상 응답을 ToolResult 로 변환한다", async () => {
    mockFetch(fixture);
    const result = await execute({ base: "USD", quote: "KRW" });

    expect(result.data).toEqual({ pair: "USD/KRW", rate: 1362.5, asOf: "2026-10-01" });
    expect(result.source).toMatchObject({ name: expect.any(String), url: expect.stringMatching(/^https?:/), asOf: "2026-10-01" });
  });

  it("API 가 실패하면 빈 값이 아니라 에러를 던진다", async () => {
    mockFetch({ message: "not found" }, 404);
    await expect(execute({ base: "USD", quote: "KRW" })).rejects.toThrow("404");
  });
});
