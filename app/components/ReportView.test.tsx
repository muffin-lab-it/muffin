import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import legacy from "@/src/agent/fixtures/report.v1.sample.json";
import { normalizeReport } from "@/src/agent/normalize";
import type { ToolStep } from "@/src/agent/context";
import { reportSchema, type Report } from "@/src/agent/schema";
import { ReportView } from "./ReportView";
import { SourceLink, EvidenceRecord } from "./ReportEvidence";

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
    expect($(".report-reading-notice").text()).toContain("검사 미실행");
    expect($(".check-unverified")).toHaveLength(report.numbers.length);
    expect($(".check-verified, .check-derived")).toHaveLength(0);
    expect($(".report-verification").text()).not.toContain("권유 표현 패턴 감지 0건");
    expect($(".report-verification").text()).not.toContain("값 대조 3개");
  });

  it("부분 검사에서 제외 항목과 검사의 한계를 함께 남긴다", () => {
    const $ = render(fixture());
    expect($(".report-reading-notice").text()).toContain("일부 확인 필요");
    expect($(".report-adjustments").text()).toContain(fixture().verification.removed[0]);
    expect($(".report-verification .report-hint").text()).toContain("원문과 함께 확인");

  });

  it("출처 목록의 대표 ID와 달라도 evidence ID로 정확한 원본을 찾는다", () => {
    const report = fixture();
    const original = report.evidence[0];
    report.evidence.push({ ...original, id: "E99", label: "별도 관측값", values: { rate: 1444 } });
    report.numbers = [{ ...report.numbers[0], ref: "E99" }];
    // 같은 URL·기준일의 sources 대표만 남아 있어도 E99 원본을 잃으면 안 된다.
    report.sources = [{ id: "E1", ...original.source }];
    const $ = render(report);
    const target = decodeURIComponent($(".num .evidence-link").attr("href")!.slice(1));
    const panel = $(".evidence-record").filter((_, el) => $(el).attr("id") === target);
    expect(panel).toHaveLength(1);
    expect(panel.parents("aside")).toHaveLength(1);
    expect($(".num details")).toHaveLength(0);
    expect(panel.find(".evidence-meta").text()).toContain("자료 E99");
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
    expect($(".evidence-record dd").first().text()).toBe("<script>alert(1)</script>");
    expect($(".evidence-record a").first().attr("rel")).toBe("noopener noreferrer");
  });

  it("v1 저장 기록 정규화 후 미검증과 원본 부재가 표시된다", () => {
    const report = normalizeReport(legacy.report);
    const $ = render(report);
    expect($(".report-reading-notice").text()).toContain("검사 미실행");
    expect($(".check-verified, .check-derived, .num .evidence-detail, .verification-detail")).toHaveLength(0);
    expect($(".num .evidence-missing")).toHaveLength(report.numbers.length);
  });

  it("빈 원본과 계산 계보의 누락된 입력을 숨기지 않는다", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0], ref: "C1", check: "derived" }];
    report.evidence = [{ ...report.evidence[0], id: "C1", values: {}, lineage: { op: "spread", inputs: ["E404"] } }];
    const $ = render(report);
    expect($(".evidence-record").text()).toContain("공개된 원본 값이 없습니다");
    expect($(".evidence-inputs").text()).toContain("E404 (자료 없음)");
  });
});

describe("읽기 중심 리포트", () => {
  it("핵심 요약 자리는 안내 문구이고 실제 서버 요약은 별도 본문으로 보존한다", () => {
    const $ = render(fixture());
    expect($("h3").text()).toContain("핵심을 한 문장으로 정리할 자리예요.");
    expect($(".report").text()).toContain(fixture().summary);
    expect($(".report-verification").parents("aside")).toHaveLength(1);
    expect($(".num details, .chart details, .reason-detail")).toHaveLength(0);
  });

  it("여러 리포트의 출처 링크가 각자의 자료 패널에만 연결된다", () => {
    const $ = load(renderToStaticMarkup(<><ReportView report={fixture()} /><ReportView report={fixture()} /></>));
    const ids = $(".evidence-record").map((_, el) => $(el).attr("id")).get();
    expect(new Set(ids).size).toBe(ids.length);
    $(".report").each((_, report) => {
      const targets = new Set($(report).find(".evidence-record, .reason-evidence, .report-section-target").map((_, el) => $(el).attr("id")).get());
      $(report).find(".evidence-link").each((_, link) => {
        expect(targets.has(decodeURIComponent($(link).attr("href")!.slice(1)))).toBe(true);
      });
    });
  });

  it("사용자 질문을 요약 앞의 별도 카드에 원문 그대로 표시한다", () => {
    const question = "미국 금리가 오르면 내 생활에는 어떤 영향이 있나요?";
    const $ = load(renderToStaticMarkup(<ReportView report={fixture()} question={question} />));
    expect($('.report > section').first().attr('aria-label')).toBe('나의 질문');
    expect($('[aria-label="나의 질문"] blockquote').text()).toBe(question);
    expect(render(fixture())('[aria-label="나의 질문"]')).toHaveLength(0);
  });
  it("검사 내역과 제외 항목은 기본적으로 접고, 주의점과 자료 부족 원문은 노출한다", () => {
    const report = fixture();
    const $ = render(report);
    const details = $(".report-verification").parents("details").first();
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

describe("사용자 화면에서 운영 정보 제외", () => {
  it("도구 실행 시간과 내부 오류는 사용자 화면에 표시하지 않는다", () => {
    const steps: ToolStep[] = [
      { tool: "get_fx_krw_rate", status: "ok", ms: 820 },
      { tool: "get_etf_kr_price", status: "ok", ms: 3, fallbackAgeMs: 3 * 60 * 60_000, breaker: "open" },
      { tool: "get_rate_data", status: "error", ms: 10_000, error: "10초 안에 끝나지 않음 (timeout)" },
    ];
    const text = render(fixture(), steps).text();
    expect(text).not.toContain("820ms");
    expect(text).not.toContain("회로 열림");
    expect(text).not.toContain("timeout");
  });
});

describe("최근 흐름 차트", () => {
  it("charts 가 있으면 선 · 평소 폭 띠 · 뉴스 점과 설명 문장을 그린다", () => {
    const $ = render(fixture());
    expect($("h2").filter((_, el) => $(el).text() === "숫자의 변화 추이")).toHaveLength(1);
    expect($("figure.chart svg path.chart-line")).toHaveLength(1);
    expect($("figure.chart .chart-band rect")).toHaveLength(1);
    expect($("figure.chart .chart-event circle")).toHaveLength(1);
    expect($("figure.chart svg").attr("aria-label")).toContain("USD/KRW 최근 30일");
    expect($(".chart-summary").text()).toContain("평소 폭 ±1.57%");
    expect($(".chart-summary").text()).toContain("9/19 → 10/19 · 2.00% 상승");
    expect($(".chart-events li").text()).toContain("한은 기준금리 동결");
  });

  it("charts 가 없으면 차트 구역이 없다", () => {
    const report = { ...fixture(), charts: undefined };
    const $ = render(report);
    expect($("figure.chart")).toHaveLength(0);
    expect($("h2").filter((_, el) => $(el).text() === "숫자의 변화 추이")).toHaveLength(0);
  });
});

describe("간결한 검사 안내", () => {
  it("검사 집계·재작성 횟수는 제거하고 필요한 조정 내역은 보존한다", () => {
    const $ = render(fixture());
    expect($(".verification-detail, .verification-stats")).toHaveLength(0);
    expect($(".report").text()).not.toContain("다시 쓰기");
    expect($(".report").text()).not.toContain("권유 표현 패턴 감지");
    expect($(".report-adjustments").text()).toContain(fixture().verification.removed[0]);
    expect($(".num .check-verified, .num .check-derived")).toHaveLength(0);
    expect($(".num .check-reported").text()).toContain("기사 속 수치");
  });

  it("계산 입력이 자신을 가리켜도 범위 밖 단독 렌더링이 재귀하지 않는다", () => {
    const entry = { ...fixture().evidence[0], id: "C1", lineage: { op: "spread", inputs: ["C1"] } };
    const $ = load(renderToStaticMarkup(<EvidenceRecord entry={entry} evidence={[entry]} />));
    expect($(".evidence-record")).toHaveLength(1);
    expect($(".evidence-inputs").text()).toContain("C1");
  });
});

describe("읽는 목적에 맞는 근거 탐색", () => {
  it.each([
    { removed: ["원인 조정"], advice: 0, included: "제외하거나 조정한 항목이 1개", absent: "권유로 해석될" },
    { removed: [], advice: 2, included: "권유로 해석될 수 있는 표현이 2건", absent: "조정한 항목이" },
    { removed: [], advice: 0, included: "구체적인 사유는 기록에서", absent: "조정한 항목이" },
  ])("부분 확인 사유를 실제 필드로 구분한다: $included", ({ removed, advice, included, absent }) => {
    const report = fixture();
    report.verification = { ...report.verification, status: "partial", removed, advice };
    const $ = render(report);
    const notice = $(".report-reading-notice");
    expect(notice.text()).toContain(included);
    expect(notice.text()).not.toContain(absent);
    expect(notice.find("a")).toHaveLength(2);
  });

  it("자료 부족과 오래된 날짜만으로 부분 확인 경고를 만들지 않는다", () => {
    const report = fixture();
    report.verification = { ...report.verification, status: "pass", removed: [], advice: 0 };
    report.dataGaps = ["일부 자료 없음"];
    report.numbers[0].asOf = "2000-01-01";
    const $ = render(report);
    expect($(".report-reading-notice").text()).not.toContain("일부 확인 필요");
    expect($(".num").first().text()).toContain("2000-01-01 자료");
    expect($(".num").first().text()).not.toContain("최신");
  });

  it("숫자와 설명 자체가 링크이며 반복 CTA 대신 영역별 안내를 제공한다", () => {
    const report = fixture();
    const $ = render(report);
    expect($(".num .metric-value-link b")).toHaveLength(report.numbers.length);
    expect($(".reason-link")).toHaveLength(report.why.length);
    expect($(".reason-link").first().text()).toBe(report.why[0].claim);
    expect($(".num").text()).not.toContain("이 숫자의 출처 보기");
    expect($(".report").text()).toContain("밑줄이 있는 숫자를 누르면");
    expect($("[aria-label='자료 읽는 순서'] a")).toHaveLength(3);
  });

  it("추천 주제를 질문에 담되 자동으로 리포트를 생성하지 않는 홈 링크를 제공한다", () => {
    const $ = load(renderToStaticMarkup(<ReportView report={fixture()} area="fx" />));
    const href = $("a[href^='/?question=']").first().attr("href")!;
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("question")).toBe(fixture().nextTopics[0]);
    expect(params.get("area")).toBe("fx");
  });
});

it("중복 카드 안내 없이 출처·날짜·식별자를 한 영역에 모은다", () => {
  const $ = render(fixture());
  expect($(".evidence-record .report-hint, .evidence-source, .evidence-id")).toHaveLength(0);
  const meta = $(".evidence-meta").first().text();
  expect(meta).toContain(fixture().evidence[0].source.name);
  expect(meta).toContain(fixture().evidence[0].source.asOf + " 자료");
  expect(meta).toContain(fixture().evidence[0].id);
  expect($(".report-reading-notice > .report-notice")).toHaveLength(1);
  expect($(".report-reading-notice > .verification-notice")).toHaveLength(1);
  $(".report-hint").each((_, el) => expect($(el).find('[aria-hidden="true"]').text()).toBe("ⓘ"));
});
