import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import legacy from "@/src/agent/fixtures/report.v1.sample.json";
import { normalizeReport } from "@/src/agent/normalize";
import type { ToolStep } from "@/src/agent/context";
import { reportSchema, type Report } from "@/src/agent/schema";
import { ReportView } from "./ReportView";
import { SourceLink } from "./ReportEvidence";

function fixture(): Report {
  return reportSchema.parse(structuredClone(sample.report));
}

function render(report: Report, steps?: ToolStep[]) {
  return load(renderToStaticMarkup(<ReportView report={report} steps={steps} />));
}

describe("리포트 증거 표시 계약", () => {
  it("검사 미실행이면 입력 숫자 배지와 집계가 검증 완료를 암시하지 않는다", () => {
    const report = fixture();
    report.verification.status = "skipped";
    const $ = render(report);
    expect($(".status-skipped").text()).toBe("검사 미실행");
    expect($(".check-unverified")).toHaveLength(report.numbers.length);
    expect($(".check-verified, .check-derived")).toHaveLength(0);
    expect($(".report-verification").text()).not.toContain("권유 표현 패턴 감지 0건");
    expect($(".report-verification").text()).not.toContain("값 대조 3개");
  });

  it("부분 검사에서 제외 항목과 검사의 한계를 함께 남긴다", () => {
    const $ = render(fixture());
    expect($(".status-partial").text()).toBe("일부 확인 필요");
    expect($(".report-verification").text()).toContain("제외 항목 1개");
    expect($(".report-verification").text()).toContain("전체의 정확성을 보장하지 않습니다");
    expect($("h2").text()).toContain("검사 후 제외한 항목");
    expect($(".fine").text()).toContain(fixture().verification.removed[0]);
  });

  it("출처 목록의 대표 ID와 달라도 evidence ID로 정확한 원본을 찾는다", () => {
    const report = fixture();
    const original = report.evidence[0];
    report.evidence.push({ ...original, id: "E99", label: "별도 관측값", values: { rate: 1444 } });
    report.numbers = [{ ...report.numbers[0], ref: "E99" }];
    // 같은 URL·기준일의 sources 대표만 남아 있어도 E99 원본을 잃으면 안 된다.
    report.sources = [{ id: "E1", ...original.source }];
    const $ = render(report);
    const panel = $(".num .evidence-detail");
    expect(panel.find("summary").text()).toBe("출처·기준일 보기");
    expect(panel.text()).toContain("근거 번호: E99");
    expect(panel.find(".evidence-title").text()).toBe("별도 관측값");
    expect(panel.find("dd").text()).toBe("1444");
    expect(panel.find("a").attr("href")).toBe(original.source.url);
  });

  it("없는 ref와 null ref는 추측한 원본 링크를 만들지 않는다", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0], ref: "E404" }, { ...report.numbers[1], ref: null }];
    const $ = render(report);
    expect($(".num .evidence-missing").text()).toContain("E404 · 근거를 찾을 수 없음");
    expect($(".num .evidence-missing").text()).toContain("근거 번호 없음");
    expect($(".num details, .num a")).toHaveLength(0);
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/source", "//example.com", "/source"])(
    "웹 주소가 아닌 %s를 활성 링크로 렌더링하지 않는다", (url) => {
      const $ = load(renderToStaticMarkup(<SourceLink url={url} name="출처" />));
      expect($("a")).toHaveLength(0);
      expect($.text()).toContain("연결 가능한 출처 주소 없음");
    },
  );

  it("안전한 외부 링크에는 새 탭 관계 속성이 있고 원본 텍스트는 HTML로 실행되지 않는다", () => {
    const report = fixture();
    report.evidence[0].values = { text: "<script>alert(1)</script>" };
    const $ = render(report);
    expect($("script")).toHaveLength(0);
    expect($(".num dd").first().text()).toBe("<script>alert(1)</script>");
    expect($(".num a").first().attr("rel")).toBe("noopener noreferrer");
  });

  it("v1 저장 기록 정규화 후 미검증과 원본 부재가 표시된다", () => {
    const report = normalizeReport(legacy.report);
    const $ = render(report);
    expect($(".status-skipped").text()).toBe("검사 미실행");
    expect($(".check-verified, .check-derived, .num .evidence-detail, .verification-detail")).toHaveLength(0);
    expect($(".num .evidence-missing")).toHaveLength(report.numbers.length);
  });

  it("빈 원본과 계산 계보의 누락된 입력을 숨기지 않는다", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0], ref: "C1", check: "derived" }];
    report.evidence = [{ ...report.evidence[0], id: "C1", values: {}, lineage: { op: "spread", inputs: ["E404"] } }];
    const $ = render(report);
    expect($(".num").text()).toContain("공개된 원본 값이 없습니다");
    expect($(".evidence-lineage").text()).toContain("E404 (근거를 찾을 수 없음)");
    expect($(".evidence-lineage").text()).toContain("재계산 검증을 보장하지 않습니다");
  });
});

describe("읽기 중심 리포트", () => {
  it("검사 내역과 제외 항목은 기본적으로 접고, 주의점과 자료 부족 원문은 노출한다", () => {
    const report = fixture();
    const $ = render(report);
    const details = $(".report-verification").parent("details");
    expect(details.attr("open")).toBeUndefined();
    expect(details.children("summary").text()).toContain("리포트 상세 정보");
    expect(details.text()).toContain(report.verification.removed[0]);
    const notes = $('[aria-label="읽기 전에 알아둘 점"]');
    expect(notes.parents("details")).toHaveLength(0);
    for (const text of [...report.caveats, ...report.dataGaps]) expect(notes.text()).toContain(text);
    expect($(".report-reading-notice").text()).toContain("일부 확인 필요");
    expect($(".report-reading-notice").parents("details")).toHaveLength(0);
  });

  it("검사 미실행, 서버 안내, AI 고지는 상세를 열지 않아도 확인할 수 있다", () => {
    const report = fixture();
    report.verification.status = "skipped";
    report.notice = "추가 자료가 없어 원인을 단정할 수 없습니다.";
    const $ = render(report);
    expect($(".report-reading-notice").text()).toContain("검사 미실행");
    expect($(".report-notice").text()).toBe(report.notice);
    expect($(".report-disclosure").text()).toBe(report.disclosure);
    expect($(".report-notice, .report-disclosure").parents("details")).toHaveLength(0);
  });

  it("긴 요약과 단위가 포함된 숫자의 원문을 잘라내지 않는다", () => {
    const report = fixture();
    report.summary = "긴 요약도 기준일과 단위를 생략하지 않습니다. ".repeat(20);
    report.numbers[0].value = "1조 2,345억 6,789만 원";
    const $ = render(report);
    expect($(".report").text()).toContain(report.summary);
    expect($(".num b").first().text()).toBe(report.numbers[0].value);
  });
});

describe("사용한 Tool 목록", () => {
  it("저장된 응답으로 나간 tool 은 🟡 와 나이를, 회로가 열려 건너뛴 것은 그 사실을 보여 준다", () => {
    const steps: ToolStep[] = [
      { tool: "get_fx_krw_rate", status: "ok", ms: 820 },
      { tool: "get_etf_kr_price", status: "ok", ms: 3, fallbackAgeMs: 3 * 60 * 60_000, breaker: "open" },
      { tool: "get_rate_data", status: "error", ms: 10_000, error: "10초 안에 끝나지 않음 (timeout)" },
    ];
    const text = render(fixture(), steps).text();
    expect(text).toContain("✅ 환율 확인 · 820ms");
    expect(text).toContain("🟡 국내 ETF 시세 확인 · 3ms · 저장된 응답(3시간 전) · 회로 열림(호출 생략)");
    expect(text).toContain("❌ 금리 확인 · 10000ms · 10초 안에 끝나지 않음 (timeout)");
  });
});

describe("최근 흐름 차트", () => {
  it("charts 가 있으면 선 · 평소 폭 띠 · 뉴스 점과 설명 문장을 그린다", () => {
    const $ = render(fixture());
    expect($("h2").filter((_, el) => $(el).text() === "최근 흐름")).toHaveLength(1);
    expect($("figure.chart svg path.chart-line")).toHaveLength(1);
    expect($("figure.chart .chart-band rect")).toHaveLength(1);
    expect($("figure.chart .chart-event circle")).toHaveLength(1);
    expect($("figure.chart svg").attr("aria-label")).toContain("USD/KRW 최근 30일");
    expect($(".chart-summary").text()).toContain("평소 폭 ±1.57%");
    expect($(".chart-summary").text()).toContain("9/19 1,365 에서 10/19 1,392 (+2.00%)");
    expect($(".chart-events li").text()).toContain("한은 기준금리 동결");
  });

  it("charts 가 없으면 차트 구역이 없다", () => {
    const report = { ...fixture(), charts: undefined };
    const $ = render(report);
    expect($("figure.chart")).toHaveLength(0);
    expect($("h2").filter((_, el) => $(el).text() === "최근 흐름")).toHaveLength(0);
  });
});

describe("검증이 한 일", () => {
  it("숫자마다 어느 장부 값과 어떤 규칙으로 맞았는지, 계산값의 계보, 기사 보도 여부를 풀어 보여 준다", () => {
    const $ = render(fixture());
    const text = $(".verification-detail").text();
    expect($(".verification-detail summary").text()).toBe("검증이 한 일 보기");
    expect(text).toContain("USD/KRW 1,392.40원 → 값 대조 E1 의 rate 값과 정확히 일치");
    expect(text).toContain("한미 금리 차이 0.88%p → 계산값 C1 계산값 (spread ← E3, E2)");
    expect(text).toContain("외국인 주식 순매도 (보도) 1조 2,000억 원 → 기사 보도 E4-2 의 title 와 정확히 일치 (보도일 뿐 공식 데이터로 확인한 것이 아님)");
    expect(text).toContain("다시 쓰기 1회");
  });

  it("검사를 건너뛴 리포트에는 보이지 않는다", () => {
    const report = { ...fixture(), verification: { ...fixture().verification, status: "skipped" as const } };
    expect(render(report)(".verification-detail")).toHaveLength(0);
  });
});
