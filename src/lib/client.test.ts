import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_HEADER, getClientId, isClientId, readClientId } from "./client";

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe("getClientId (브라우저)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("서버 렌더링(window 없음)에서는 빈 문자열이다", () => {
    expect(getClientId()).toBe("");
  });

  it("처음 부르면 uuid v4 를 만들어 localStorage 에 두고, 다음부터는 같은 값을 돌려준다", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const id = getClientId();
    expect(isClientId(id)).toBe(true);
    expect(storage.dump()).toEqual({ "muffin.client": id });
    expect(getClientId()).toBe(id);
  });

  it("저장된 값이 uuid v4 가 아니면 새로 만들어 덮어쓴다", () => {
    const storage = fakeStorage({ "muffin.client": "not-a-uuid" });
    vi.stubGlobal("window", { localStorage: storage });
    const id = getClientId();
    expect(isClientId(id)).toBe(true);
    expect(storage.dump()["muffin.client"]).toBe(id);
  });

  it("localStorage 가 막혀 있으면 이 탭에서만 쓰는 id 를 만들고 계속 같은 값을 돌려준다", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked });
    const id = getClientId();
    expect(isClientId(id)).toBe(true);
    expect(getClientId()).toBe(id);
  });

  it("randomUUID 가 없는 환경(보안 컨텍스트 아님)에서도 uuid v4 를 만든다", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(0xab) });
    const id = getClientId();
    expect(id).toBe("abababab-abab-4bab-abab-abababababab");
    expect(isClientId(id)).toBe(true);
  });
});

describe("readClientId (서버)", () => {
  it("헤더가 uuid v4 면 그 값, 없거나 형식이 틀리면 undefined", () => {
    const ok = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
    expect(readClientId(new Headers({ [CLIENT_HEADER]: ok }))).toBe(ok);
    expect(readClientId(new Headers())).toBeUndefined();
    expect(readClientId(new Headers({ [CLIENT_HEADER]: "abc" }))).toBeUndefined();
    // v1 형식(세 번째 묶음이 1 로 시작)은 받지 않는다
    expect(readClientId(new Headers({ [CLIENT_HEADER]: "3f2a9c1e-5b7d-1e8a-9c21-7d4e5f6a8b90" }))).toBeUndefined();
  });
});
