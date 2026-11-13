import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import legacy from "@/src/agent/fixtures/report.v1.sample.json";
import { normalizeReport } from "@/src/agent/normalize";
import { reportSchema, type Evidence } from "@/src/agent/schema";
import { EvidenceRecord, newsDate } from "./ReportEvidence";
import { ReportEvidenceScope } from "./ReportEvidenceScope";
import { ReportView } from "./ReportView";

function news(): Evidence {
  return {
    id: "E4-1", tool: "get_korean_economic_news", label: "합성 기사 · 테스트 언론사",
    values: { title: "테스트용 물가 보도", publisher: "테스트 언론사", publishedAt: "2026-11-10T00:00:00Z", body: "unavailable" },
    source: { name: "테스트 언론사", url: "https://news.google.com/rss/articles/synthetic", asOf: "2026-11-10T00:00:00Z" },
    note: "합성 자료입니다. 제목에서 확인한 정보만 사용합니다.",
  };
}
function renderEntry(entry: Evidence) {
  return load(renderToStaticMarkup(<EvidenceRecord entry={entry} evidence={[entry]} />));
}

describe("뉴스 원본 정보 (정적 렌더링)", () => {
  it("기사별 번호·제목·언론사·날짜와 제목 근거의 한계를 표시한다", () => {
    const $ = renderEntry(news());
    expect($(".evidence-id").text()).toBe("E4-1");
    expect($(".evidence-title").text()).toBe("테스트용 물가 보도");
    expect($(".evidence-meta").text()).toContain("테스트 언론사");
    expect($("time").text()).toBe("2026-11-10");
    expect($("time").attr("datetime")).toBe("2026-11-10T00:00:00Z");
    expect($.text()).toContain("제목만 확인");
    expect($.text()).toContain("본문 내용이나 원인 관계를 확인한 근거는 아닙니다");
    expect($.text()).toContain("공식 데이터로 독립 검증된 사실과 구분");
    expect($(".evidence-note").text()).toBe(news().note);
  });

  it("서버의 날짜 표시에는 실행 시각에 따라 변하는 상대 날짜를 넣지 않는다", () => {
    expect(renderEntry(news()).text()).not.toContain("일 전");
  });

  it("available 상태는 제목만 확인으로 표시하거나 본문 전문을 만들어내지 않는다", () => {
    const entry = news();
    entry.values.body = "available";
    entry.note = undefined;
    const $ = renderEntry(entry);
    expect($.text()).toContain("본문 확보");
    expect($.text()).not.toContain("제목만 확인");
    expect($.text()).toContain("본문 전문이 포함되어 있지 않습니다");
    expect($.text()).not.toContain("unavailable");
  });

  it.each([undefined, "unknown"])("알 수 없는 본문 상태 %s를 확보 성공으로 표시하지 않는다", (body) => {
    const entry = news();
    if (body) entry.values.body = body; else delete entry.values.body;
    expect(renderEntry(entry).text()).toContain("본문 확보 여부 미확인");
    expect(renderEntry(entry).text()).not.toContain("제목만 확인");
  });

  it("본문 미요청은 수집 실패와 구분한다", () => {
    const entry = news();
    entry.values.body = "not_requested";
    expect(renderEntry(entry).text()).toContain("본문 미요청");
  });

  it("Google 중계 링크를 원문으로 부르지 않고 pageUrl을 우선한다", () => {
    const entry = news();
    expect(renderEntry(entry)("a").text()).toBe("Google News 중계 링크");
    entry.source.pageUrl = "https://example.com/synthetic-article";
    const $ = renderEntry(entry);
    expect($("a").attr("href")).toBe(entry.source.pageUrl);
    expect($("a").text()).toBe("기사 보기");
    expect($("a").attr("rel")).toBe("noopener noreferrer");
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/news", "//example.com"])("위험한 pageUrl %s의 링크를 생성하지 않는다", (url) => {
    const entry = news();
    entry.source.pageUrl = url;
    expect(renderEntry(entry)("a")).toHaveLength(0);
    expect(renderEntry(entry).text()).toContain("기사 보기");
  });

  it("정보가 일부 없으면 저장된 label·출처·기준일을 보존한다", () => {
    const entry = news();
    entry.values = {};
    const $ = renderEntry(entry);
    expect($(".evidence-title").text()).toBe(entry.label);
    expect($(".evidence-meta").text()).toContain(entry.source.name);
    expect($("time").text()).toBe("2026-11-10");
    expect($.text()).toContain("본문 확보 여부 미확인");
    entry.source.asOf = "";
    expect(renderEntry(entry).text()).toContain("발행일 미제공");
  });

  it("잘못된 발행일을 기준일로 바꿔 정상 날짜처럼 보이지 않는다", () => {
    const entry = news();
    entry.values.publishedAt = "2026-02-30";
    const $ = renderEntry(entry);
    expect($("time")).toHaveLength(0);
    expect($.text()).toContain("발행일 확인 불가");
  });

  it("note와 제목은 HTML이 아니라 텍스트로만 렌더링한다", () => {
    const entry = news();
    entry.note = "<script>alert(1)</script>";
    entry.values.title = "<img src=x onerror=alert(1)>";
    const $ = renderEntry(entry);
    expect($("script, img")).toHaveLength(0);
    expect($(".evidence-note").text()).toBe(entry.note);
  });
});

describe("뉴스 날짜 경계", () => {
  const now = Date.parse("2026-11-13T00:00:00Z");
  it.each([
    ["2026-11-10T00:00:00Z", "3일 전"],
    ["2026-11-10", "3일 전"],
    ["2026-11-13T00:00:00Z", "0일 전"],
    ["2026-11-14", "미래 발행일"],
    ["2000-01-01", `${Math.floor((now - Date.parse("2000-01-01")) / 86_400_000)}일 전`],
  ])("%s의 나이를 제공된 표시 시각 기준으로 계산한다", (value, relative) => {
    const reference = value.length === 10 ? new Date(2026, 10, 13, 12).getTime() : now;
    expect(newsDate(value, reference).relative).toBe(relative);
  });
  it.each(["not-a-date", "2026-02-30", "2026-13-10", "2026-11-10T25:00:00Z", "2026-11-10T00:00:00"])("%s는 유효한 ISO 발행일로 취급하지 않는다", (value) => {
    expect(newsDate(value, now)).toEqual({ label: "발행일 확인 불가", dateTime: undefined, relative: null });
  });
  it.each([undefined, "", 123])("누락된 날짜 %s를 추정하지 않는다", (value) => {
    expect(newsDate(value, now).label).toBe("발행일 미제공");
  });
  it("날짜 전용 기록은 현지 자정 직후에도 당일을 미래로 표시하지 않는다", () => {
    const localMorning = new Date(2026, 10, 13, 0, 30).getTime();
    expect(newsDate("2026-11-13", localMorning).relative).toBe("0일 전");
    expect(newsDate("2026-11-12", localMorning).relative).toBe("1일 전");
    expect(newsDate("2026-11-14", localMorning).relative).toBe("미래 발행일");
  });
});

describe("계산 입력과 기존 검증 정보 (정적 계약)", () => {
  it("C1의 E3/E2 입력은 실제 ID·자료명과 같은 리포트의 원본을 가리킨다", () => {
    const report = reportSchema.parse(structuredClone(sample.report));
    const $ = load(renderToStaticMarkup(<ReportView report={report} />));
    const calculation = $(".evidence-record").filter((_, el) => $(el).find(".evidence-id").text() === "C1");
    expect(calculation.find(".evidence-inputs a")).toHaveLength(2);
    calculation.find(".evidence-inputs a").each((_, link) => {
      const targetId = decodeURIComponent($(link).attr("href")!.slice(1));
      const target = $(".evidence-record").filter((_, el) => $(el).attr("id") === targetId);
      expect(target).toHaveLength(1);
      expect($(link).text()).toContain(target.find(".evidence-id").text());
    });
    expect(calculation.text()).toContain("차이");
    expect(calculation.text()).toContain("0.88");
  });

  it("존재하지 않는 입력에는 ID와 누락 안내만 남긴다", () => {
    const entry = { ...news(), id: "C1", tool: "calc_metrics", lineage: { op: "spread", inputs: ["E404"] } };
    const $ = load(renderToStaticMarkup(<ReportEvidenceScope><EvidenceRecord entry={entry} evidence={[entry]} /></ReportEvidenceScope>));
    expect($(".evidence-inputs a")).toHaveLength(0);
    expect($(".evidence-inputs").text()).toContain("E404 · 연결된 자료 없음");
    entry.lineage.inputs = [];
    expect(renderEntry(entry).text()).toContain("입력 자료 미제공");
  });

  it("여러 리포트의 계산 입력 링크는 각자의 원본에만 연결된다", () => {
    const report = reportSchema.parse(structuredClone(sample.report));
    const $ = load(renderToStaticMarkup(<><ReportView report={report} /><ReportView report={report} /></>));
    const ids = $(".evidence-record").map((_, el) => $(el).attr("id")).get();
    expect(new Set(ids).size).toBe(ids.length);
    $(".report").each((_, r) => {
      const ownIds = new Set($(r).find(".evidence-record").map((_, e) => $(e).attr("id")).get());
      $(r).find(".evidence-inputs a").each((_, link) => {
        expect(ownIds.has(decodeURIComponent($(link).attr("href")!.slice(1)))).toBe(true);
      });
    });
  });

  it("4종 배지·3종 원인 분류와 보도 숫자의 한계를 유지한다", () => {
    const report = reportSchema.parse(structuredClone(sample.report));
    report.numbers.push({ ...report.numbers[0], check: "unverified" });
    const $ = load(renderToStaticMarkup(<ReportView report={report} />));
    for (const check of ["verified", "derived", "reported", "unverified"]) expect($(`.num .check-${check}`).length).toBeGreaterThan(0);
    for (const basis of ["data", "news", "none"]) expect($(`.basis-${basis}`).length).toBeGreaterThan(0);
    expect($(".verification-detail").text()).toContain("보도일 뿐 공식 데이터로 확인한 것이 아님");
  });

  it("skipped와 v1 기록을 검증 완료로 표시하지 않는다", () => {
    const report = reportSchema.parse(structuredClone(sample.report));
    report.verification.status = "skipped";
    for (const r of [report, normalizeReport(legacy.report)]) {
      const $ = load(renderToStaticMarkup(<ReportView report={r} />));
      expect($(".num .check-unverified")).toHaveLength(r.numbers.length);
      expect($(".num .check-reported, .num .check-derived, .num .check-verified")).toHaveLength(0);
    }
  });
});
