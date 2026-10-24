import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import legacy from "@/src/agent/fixtures/report.v1.sample.json";
import { normalizeReport } from "@/src/agent/normalize";
import { reportSchema, type Report } from "@/src/agent/schema";
import { ReportView } from "./ReportView";
import { SourceLink } from "./ReportEvidence";

function fixture(): Report {
  return reportSchema.parse(structuredClone(sample.report));
}

function render(report: Report) {
  return load(renderToStaticMarkup(<ReportView report={report} />));
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
    expect(panel.find("summary").text()).toBe("원본 보기 · E99");
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
    expect($(".check-verified, .check-derived, .evidence-detail")).toHaveLength(0);
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
