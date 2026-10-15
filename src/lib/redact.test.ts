import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

const env = { ECOS_API_KEY: "ABC123SECRET", DATA_GO_KR_KEY: "a+b/c==d%e", SHORT_KEY: "abc", NOT_SECRET: "ABC123SECRETX" };

describe("redactSecrets", () => {
  it("경로 안의 키를 지운다 (ECOS)", () => {
    const msg = "HTTP 500 https://ecos.bok.or.kr/api/StatisticSearch/ABC123SECRET/json/kr/1/10";
    expect(redactSecrets(msg, env)).toBe("HTTP 500 https://ecos.bok.or.kr/api/StatisticSearch/[REDACTED]/json/kr/1/10");
  });

  it("URL 인코딩·폼 인코딩된 키도 지운다", () => {
    const encoded = encodeURIComponent(env.DATA_GO_KR_KEY);
    const form = new URLSearchParams({ k: env.DATA_GO_KR_KEY }).toString().slice(2);
    expect(redactSecrets(`a=${encoded} b=${form} c=${env.DATA_GO_KR_KEY}`, env)).toBe("a=[REDACTED] b=[REDACTED] c=[REDACTED]");
  });

  it("_KEY 가 아닌 변수와 너무 짧은 값은 건드리지 않는다", () => {
    expect(redactSecrets("abc 문자열", env)).toBe("abc 문자열");
  });
});
