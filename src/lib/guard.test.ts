import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_LIMIT, BodyTooLargeError, checkOrigin, readJsonLimited } from "./guard";

function req(headers: Record<string, string> = {}, body?: BodyInit) {
  return new Request("https://muffin-kappa.vercel.app/api/history", { method: "POST", headers, body });
}

describe("checkOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("기본 허용 목록: 배포 주소 · 미리보기 주소 · localhost:3000 은 통과, 다른 출처는 403", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkOrigin(req({ origin: "https://muffin-kappa.vercel.app" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ origin: "https://muffin-git-feat-x-thdude37-2971s-projects.vercel.app" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ origin: "http://localhost:3000" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ origin: "https://evil.example.com" }))).toEqual({ ok: false, status: 403 });
    expect(checkOrigin(req({ origin: "null" }))).toEqual({ ok: false, status: 403 });
  });

  it("미리보기 주소의 * 는 점이 없는 한 부분만 대신한다 (다른 도메인을 끼워 넣지 못함)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkOrigin(req({ origin: "https://evil.com.x-thdude37-2971s-projects.vercel.app" }))).toEqual({ ok: false, status: 403 });
    expect(checkOrigin(req({ origin: "https://-thdude37-2971s-projects.vercel.app" }))).toEqual({ ok: false, status: 403 });
    expect(checkOrigin(req({ origin: "https://x-thdude37-2971s-projects.vercel.app.evil.com" }))).toEqual({ ok: false, status: 403 });
  });

  it("ALLOWED_ORIGINS 의 * 는 점이 없는 한 부분만 대신한다 (다른 도메인을 끼워 넣지 못함)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOWED_ORIGINS", "https://*.preview.example.com");
    expect(checkOrigin(req({ origin: "https://pr-1.preview.example.com" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ origin: "https://evil.com.preview.example.com" }))).toEqual({ ok: false, status: 403 });
    expect(checkOrigin(req({ origin: "https://.preview.example.com" }))).toEqual({ ok: false, status: 403 });
    expect(checkOrigin(req({ origin: "https://pr-1.preview.example.com.evil.com" }))).toEqual({ ok: false, status: 403 });
  });

  it("ALLOWED_ORIGINS 항목은 대소문자 · 끝 슬래시와 상관없이 맞춘다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOWED_ORIGINS", "https://Muffin.Example.com/ ,, not a url");
    expect(checkOrigin(req({ origin: "https://muffin.example.com" }))).toEqual({ ok: true });
  });

  it("Origin 이 없으면 Referer 의 출처로 본다", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkOrigin(req({ referer: "https://muffin-kappa.vercel.app/history" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ referer: "https://evil.example.com/muffin-kappa.vercel.app" }))).toEqual({ ok: false, status: 403 });
    expect(checkOrigin(req({ referer: "not a url" }))).toEqual({ ok: false, status: 403 });
  });

  it("Origin · Referer 가 둘 다 없으면 개발 환경에서만 통과한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkOrigin(req())).toEqual({ ok: false, status: 403 });
    vi.stubEnv("NODE_ENV", "development");
    expect(checkOrigin(req())).toEqual({ ok: true });
  });

  it("NODE_ENV 가 비었거나 다른 값이면 운영처럼 막는다", () => {
    vi.stubEnv("NODE_ENV", "");
    expect(checkOrigin(req())).toEqual({ ok: false, status: 403 });
    vi.stubEnv("NODE_ENV", "staging");
    expect(checkOrigin(req())).toEqual({ ok: false, status: 403 });
  });

  it("localhost 는 허용 목록의 3000 번만 통과한다", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(checkOrigin(req({ origin: "http://localhost:3000" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ origin: "http://localhost:3123" }))).toEqual({ ok: false, status: 403 });
  });

  it("ALLOWED_ORIGINS 가 있으면 기본값 대신 그 목록을 쓴다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOWED_ORIGINS", " https://muffin.example.com , https://*.preview.example.com ");
    expect(checkOrigin(req({ origin: "https://muffin.example.com" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ origin: "https://pr-12.preview.example.com" }))).toEqual({ ok: true });
    expect(checkOrigin(req({ origin: "https://muffin-kappa.vercel.app" }))).toEqual({ ok: false, status: 403 });
  });
});

describe("readJsonLimited", () => {
  it("한도 안의 JSON 은 그대로 읽는다 (한글 포함)", async () => {
    const body = JSON.stringify({ question: "KODEX 200 요즘 어때?", depth: "easy" });
    await expect(readJsonLimited(req({}, body), BODY_LIMIT.report)).resolves.toEqual({ question: "KODEX 200 요즘 어때?", depth: "easy" });
  });

  it("실제 바이트가 한도를 넘으면 413 에러 (한글은 글자당 3바이트)", async () => {
    const body = JSON.stringify({ question: "가".repeat(10) }); // 30바이트 + 따옴표 등
    const err: unknown = await readJsonLimited(req({}, body), 20).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BodyTooLargeError);
    expect((err as BodyTooLargeError).status).toBe(413);
  });

  it("Content-Length 가 한도를 넘으면 읽기 전에 거절한다", async () => {
    await expect(readJsonLimited(req({ "content-length": String(BODY_LIMIT.report + 1) }, "{}"), BODY_LIMIT.report)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("Content-Length 가 작게 적혀 있어도 실제로 읽은 바이트로 막는다", async () => {
    const body = JSON.stringify({ x: "a".repeat(100) });
    await expect(readJsonLimited(req({ "content-length": "2" }, body), 50)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("JSON 이 아니거나 바디가 없으면 null (라우트의 입력 검사가 400 으로 처리)", async () => {
    await expect(readJsonLimited(req({}, "not json"), BODY_LIMIT.report)).resolves.toBeNull();
    await expect(readJsonLimited(req(), BODY_LIMIT.report)).resolves.toBeNull();
  });
});
