import { describe, expect, it, vi } from "vitest";
import sample from "../../src/agent/fixtures/report.v2.sample.json";
import { reportSchema } from "../../src/agent/schema";
import { aggregate, analyzeAnswer, analyzeReport, baselineInstructions, checkUrls, distinctNumbers, extractDates, isSafeUrl, renderMarkdown, type Row } from "./lib";

const today = "2026-11-05";
const answer = `한입 요약: 2024년 10월 기준 원/달러 환율은 약 1,350원입니다.
오늘의 숫자: 10월 25일 종가 1,342.5원 (전일 대비 -0.4%). 미국 기준금리 4.5%.
왜 그럴까요: 2026.10.30 FOMC 이후 달러가 약세였습니다.
주의점: 실시간 환율은 확인할 수 없습니다. 지금이 살 때입니다.
출처: 한국은행 https://www.bok.or.kr/portal/main/main.do, https://example.invalid/fake-404.`;

describe("Tool 없음 기준선 측정", () => {
  it("글 속 날짜를 ISO 로 뽑는다 (연-월-일 · 연.월.일 · 연년 월월 · 연년 월 · 월 일은 올해, 미래면 작년)", () => {
    expect(extractDates(answer, today)).toEqual(["2024-10-01", "2026-10-25", "2026-10-30"]);
    expect(extractDates("12월 25일 발표", today)).toEqual(["2025-12-25"]);
    expect(extractDates("13월 40일", today)).toEqual([]);
    expect(extractDates("2026-02-31 기준", today)).toEqual([]); // 달력에 없는 날
    expect(extractDates("2024년 10월 기준 https://example.com/2026/11/05/news", today)).toEqual(["2024-10-01"]); // 링크 속 날짜는 제외
    expect(extractDates("2024-02-29 기준", today)).toEqual(["2024-02-29"]);
  });

  it("숫자는 양쪽 다 '글에서 서로 다른 데이터 숫자' 로 셈 (반복 · 링크 속 숫자 제외)", () => {
    expect(distinctNumbers("환율 1,350원 … 다시 1,350원. 금리 4.5%. https://x.test/2024/10/15?p=99")).toBe(2);
    expect(distinctNumbers("")).toBe(0);
  });

  it("안전한 주소만 요청한다", () => {
    expect(isSafeUrl("https://www.bok.or.kr/")).toBe(true);
    expect(isSafeUrl("http://localhost:3000/")).toBe(false);
    expect(isSafeUrl("http://127.0.0.1/")).toBe(false);
    expect(isSafeUrl("http://10.0.0.5/")).toBe(false);
    expect(isSafeUrl("http://192.168.1.1/")).toBe(false);
    expect(isSafeUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeUrl("http://[::1]/")).toBe(false);
    expect(isSafeUrl("ftp://a.test/")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });

  it("기준선 답을 잰다: 숫자 · 링크 · 최근 기준일 · 권유 · 모른다고 밝힌 수", () => {
    const m = analyzeAnswer(answer, { today, ms: 8_000, tokens: { input: 100, output: 300 }, model: "gpt-6-luna" });
    expect(m.numbers).toBe(4); // 1,350원 · 1,342.5원 · -0.4% · 4.5%
    expect(m.verifiable).toBe(0);
    expect(m.cards).toBe(0);
    expect(m.urls).toEqual(["https://www.bok.or.kr/portal/main/main.do", "https://example.invalid/fake-404"]);
    expect(m.latestDate).toBe("2026-10-30");
    expect(m.daysOld).toBe(6);
    expect(m.advice).toBe(1);
    expect(m.admitted).toBe(1);
    expect(m).toMatchObject({ ms: 8_000, tokens: { input: 100, output: 300 }, model: "gpt-6-luna" });
    expect(analyzeAnswer("", { today, ms: 0, tokens: null, model: "x" })).toMatchObject({ numbers: 0, urls: [], latestDate: null, daysOld: null });
  });

  it("Muffin 리포트를 같은 잣대로 잰다", () => {
    const report = reportSchema.parse((sample as { report: unknown }).report);
    const m = analyzeReport(report, { today, ms: 24_000, tokens: { input: 5_000, output: 900 }, model: "gpt-6-luna" });
    expect(m.numbers).toBeGreaterThan(0);
    // 화면에 보이는 상단 안내의 숫자도 셉니다 (샘플에는 움직임 안내가 있음)
    expect(m.numbers).toBeGreaterThanOrEqual(distinctNumbers([report.summary, ...report.numbers.map((n) => n.value)].join("\n")));
    expect(m.cards).toBe(report.numbers.length);
    expect(m.verifiable).toBe(report.verification.numbers.verified + report.verification.numbers.derived);
    expect(m.urls.length).toBe(new Set(report.sources.map((s) => s.url)).size);
    expect(m.latestDate).not.toBeNull();
    expect(m.admitted).toBe(report.dataGaps.length);
  });

  it("링크 접속: 2xx 살아 있음, 404 죽음, 주소 없음 죽음, 403 · 시간 초과는 모름. HEAD 가 막히면 GET 으로 한 번 더. 리디렉션은 안전한 곳만 따라감", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method} ${u}`);
      if (u.includes("redirect-private")) return new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } });
      if (u.includes("redirect-loop")) return new Response("", { status: 302, headers: { location: u } });
      if (u.includes("redirect-ok")) return new Response("", { status: 301, headers: { location: "https://a.test/ok" } });
      if (u.includes("ok")) return new Response("", { status: 200 });
      if (u.includes("gone")) return new Response("", { status: 404 });
      if (u.includes("blocked")) return new Response("", { status: init?.method === "HEAD" ? 405 : 403 });
      if (u.includes("nodns")) throw Object.assign(new TypeError("fetch failed"), { cause: new Error("getaddrinfo ENOTFOUND nodns.invalid") });
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const out = await checkUrls(
      ["https://a.test/ok", "https://a.test/gone", "https://a.test/blocked", "https://nodns.invalid/x", "https://slow.test/x", "https://a.test/redirect-ok", "https://a.test/redirect-private", "http://localhost:3000/", "https://a.test/redirect-loop"],
      fetchImpl as unknown as typeof fetch,
      { timeoutMs: 10 },
    );
    expect(out.map((c) => c.status)).toEqual(["live", "dead", "unknown", "dead", "unknown", "live", "unknown", "unknown", "unknown"]);
    expect(out[8]?.note).toBe("redirect not resolved");
    expect(calls.filter((c) => c.includes("blocked"))).toEqual(["HEAD https://a.test/blocked", "GET https://a.test/blocked"]);
    expect(calls.some((c) => c.includes("169.254.169.254") || c.includes("localhost"))).toBe(false);
    expect(out[6]?.note).toContain("unsafe redirect");
  });

  it("집계와 표: 근거 확인 비율 · 열리는 링크 비율 · 기준일 중앙값 · 권유 합", () => {
    const report = reportSchema.parse((sample as { report: unknown }).report);
    const b = analyzeAnswer(answer, { today, ms: 8_000, tokens: { input: 100, output: 300 }, model: "gpt-6-luna" });
    const m = analyzeReport(report, { today, ms: 24_000, tokens: { input: 5_000, output: 900 }, model: "gpt-6-luna" });
    const row: Row = {
      id: "fx-1",
      question: "환율 왜 올랐어?",
      area: "fx",
      depth: "standard",
      baseline: { ...b, text: answer, urlChecks: [{ url: b.urls[0]!, status: "live", code: 200 }, { url: b.urls[1]!, status: "dead", code: 404 }] },
      muffin: { ...m, urlChecks: m.urls.map((url) => ({ url, status: "live" as const, code: 200 })), toolsOk: 2, toolsFailed: 0, fallbacks: 0 },
    };
    const agg = aggregate([row.baseline]);
    expect(agg).toMatchObject({ questions: 1, verifiableRatio: null, cards: 0, liveRatio: 0.5, urlsUnknown: 0, daysOldMedian: 6, noDate: 0, adviceTotal: 1 });
    expect(aggregate([row.muffin!]).verifiableRatio).toBe(row.muffin!.verifiable / row.muffin!.cards);
    const md = renderMarkdown([row, { ...row, id: "x", muffin: null, error: "Muffin 실패: boom" }], { today, label: "test", muffinModel: "gpt-6-luna", baselineModel: "gpt-6-luna" });
    expect(md).toContain("| 근거 장부로 확인된 숫자 카드 | 0 (장부 없음) |");
    expect(md).toContain("| 실제로 열리는 링크 | 50% |");
    expect(md).toContain("(실패: Muffin 실패: boom)");
    expect(md).toContain("## 기준선 답 전문");
    expect(baselineInstructions("easy")).toContain("투자 권유 표현은 쓰지 않는다");
  });
});
