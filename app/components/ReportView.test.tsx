import { supportedReportTopics } from "@/src/lib/report-topics";
import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sample from "@/src/agent/fixtures/report.v2.sample.json";
import legacy from "@/src/agent/fixtures/report.v1.sample.json";
import { normalizeReport } from "@/src/agent/normalize";
import type { ToolStep } from "@/src/agent/context";
import { reportSchema, type Report } from "@/src/agent/schema";
import { ReportView, groupNumbers } from "./ReportView";
import { formatDateKo } from "./format";
import { SourceLink, EvidenceRecord, formatEvidenceValue } from "./ReportEvidence";

function fixture(): Report {
  return reportSchema.parse(structuredClone(sample.report));
}

function render(report: Report, steps?: ToolStep[]) {
  return load(renderToStaticMarkup(<ReportView report={report} steps={steps} />));
}

describe("리포트 증거 표시 계약", () => {
  it("제외 항목 링크는 같은 리포트의 접힌 상세 항목을 가리킨다", () => {
    const report = fixture();
    report.verification.removed = ["권유 표현 제외"];
    const $ = render(report);
    const link = $(".verification-detail a").filter((_, el) => $(el).text().includes("검사 후 제외"));
    expect(link).toHaveLength(1);
    const id = decodeURIComponent(link.attr("href")!.slice(1));
    const target = $(".report-section-target").filter((_, el) => $(el).attr("id") === id);
    expect(target.text()).toContain("권유 표현 제외");
    expect(target.parents("details.reference-toggle")).toHaveLength(1);
    expect(target.parents("details").attr("open")).toBeDefined() // 11/20: 주의점은 항상 펼침;
  });

  it("검사 미실행이면 입력 숫자 배지와 집계가 검증 완료를 암시하지 않는다", () => {
    const report = fixture();
    report.verification.status = "skipped";
    const $ = render(report);
    expect($(".check-unverified").text()).toContain("원문 미대조");
    expect($(".check-unverified")).toHaveLength(report.numbers.length);
    expect($(".check-verified, .check-derived")).toHaveLength(0);
    expect($(".report-verification").text()).not.toContain("권유 표현 패턴 감지 0건");
    expect($(".report-verification").text()).not.toContain("값 대조 3개");
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
    expect(panel.parents(".source-library")).toHaveLength(1);
    expect($(".num details")).toHaveLength(0);
    expect(panel.find(".evidence-meta").text()).not.toContain("자료 E99");
    expect(panel.find(".evidence-title").text()).toBe("별도 관측값");
    expect(panel.find("dd").text()).toBe("1,444"); // 원본 값 표는 큰 정수를 천 단위 쉼표로 보여 준다 (11/19);
    expect(panel.find("a")).toHaveLength(1);
    expect(panel.text()).toContain(original.source.name);
  });

  it("없는 ref와 null ref는 추측한 원본 링크를 만들지 않는다", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0], ref: "E404" }, { ...report.numbers[1], ref: null }];
    const $ = render(report);
    expect($(".num .evidence-missing").text()).toContain("연결된 원본 자료를 찾을 수 없어요.");
    expect($(".num .evidence-missing").text()).toContain("연결된 원본 자료가 없어요.");
    expect($(".num details, .num a")).toHaveLength(0);
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/source", "//example.com", "/source"])(
    "웹 주소가 아닌 %s를 활성 링크로 렌더링하지 않는다", (url) => {
      const $ = load(renderToStaticMarkup(<SourceLink url={url} name="출처" />));
      expect($("a")).toHaveLength(0);
      expect($.text()).toContain("출처");
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
    expect($(".report-verification").first().text()).toContain("검사 미실행"); // 11/24: 카드 배지 대신 검증 상자가 알림
    expect($(".check-verified, .check-derived, .num .evidence-detail, .verification-detail")).toHaveLength(0);
    expect($(".num .evidence-missing")).toHaveLength(report.numbers.length);
  });

  it("빈 원본과 계산 계보의 누락된 입력을 숨기지 않는다", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0], ref: "C1", check: "derived" }];
    report.evidence = [{ ...report.evidence[0], id: "C1", values: {}, lineage: { op: "spread", inputs: ["E404"] } }];
    const $ = render(report);
    expect($(".evidence-record").text()).toContain("공개된 원본 값이 없어요");
    expect($(".evidence-inputs").text()).toContain("연결된 자료 없음");
  });
});

describe("읽기 중심 리포트", () => {
  it("구현 안내 문구 없이 실제 서버 요약을 보존한다", () => {
    const $ = render(fixture());
    expect($(".report").text()).not.toContain("핵심을 한 문장으로 정리할 자리예요.");
    expect($(".report").text()).toContain(fixture().summary);
    expect($(".source-library").parents("aside")).toHaveLength(0);
    expect($(".num details, .chart details:not(.chart-news), .reason-detail")).toHaveLength(0);
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
  it("주의점과 부족한 자료는 하단 참고 토글에 원문 그대로 표시한다", () => {
    const report = fixture();
    const $ = render(report);
    const notes = $('[aria-label="자료 범위"]');
    expect(notes.parents(".reference-toggle")).toHaveLength(1);
    expect($(".reference-toggle").attr("open")).toBeDefined() // 11/20: 주의점은 항상 펼침;
    for (const text of [...report.caveats, ...report.dataGaps]) expect(notes.text()).toContain(text);
    expect($(".report-disclosure").text()).toBe(report.disclosure);
    expect($(".report-details")).toHaveLength(0);
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

describe("리포트 하단 도구 실행 내역", () => {
  it("저장된 응답과 회로 열림 및 실패 내역을 하단에 보존한다", () => {
    const steps: ToolStep[] = [
      { tool: "get_fx_krw_rate", status: "ok", ms: 820 },
      { tool: "get_etf_kr_price", status: "ok", ms: 3, fallbackAgeMs: 3 * 60 * 60_000, breaker: "open" },
      { tool: "get_rate_data", status: "error", ms: 10_000, error: "10초 안에 끝나지 않음 (timeout)" },
    ];
    const $ = render(fixture(), steps);
    const text = $(".report-tools").text();
    // 11/21: 도구 표 대신 저장본 · 호출 생략 · 실패만 주의점 옆 메모로 (QA 7 · 하니 5). 정상 완료한 도구와 ms 는 적지 않는다
    expect($(".report-tools").parents(".reference-toggle")).toHaveLength(1);
    expect($(".tool-table")).toHaveLength(0);
    expect($(".report-details")).toHaveLength(0);
    expect(text).toContain("자료 확인 메모");
    expect(text).toContain("잠시 호출을 쉬고 있어");
    expect(text).toContain("응답 시간 초과"); // 11/23: 원래 오류 문구 대신 사용자 말로
    expect(text).not.toContain("820");
    expect(text).not.toContain("ms");
  });
});

describe("최근 흐름 차트", () => {
  it("표시 구간보다 짧은 변화율 비교 기간을 별도로 안내한다", () => {
    const report = fixture();
    const chart = report.charts![0];
    chart.series[0].points = [
      { t: "2026-09-19", v: 100 },
      { t: "2026-10-12", v: 110 },
      { t: "2026-10-19", v: 121 },
    ];
    chart.band!.from = "2026-10-12";
    const $ = render(report);
    expect($(".chart-summary strong").first().text()).toContain("10.00%");
    expect($(".chart-period").text()).toContain("변화율 비교 기간: 10월 12일부터 10월 19일까지 (7일)");
    expect($(".chart-period").text()).toContain("9월 19일부터 10월 19일까지 30일간");
  });

  it("charts 가 있으면 선 · 평소 폭 띠 · 뉴스 점과 설명 문장을 그린다", () => {
    const $ = render(fixture());
    expect($("h2").filter((_, el) => $(el).text() === "숫자의 변화 추이")).toHaveLength(1);
    expect($("figure.chart svg path.chart-line")).toHaveLength(1);
    expect($("figure.chart .chart-band rect")).toHaveLength(1);
    expect($("figure.chart .chart-event circle")).toHaveLength(1);
    expect($("figure.chart svg").attr("aria-label")).toContain("USD/KRW 최근 30일");
    expect($(".chart-summary").text()).toContain("평소 폭 ±1.57%");
    expect($(".chart-summary").text()).toContain("환율이 1,365에서 1,392로 2.00% 올랐어요");
    // 11/24: 차트 아래 기사는 접힌 목록에 기사 원본의 전체 제목으로 (차트 데이터의 잘린 제목 대신)
    expect($(".chart-news > summary").text()).toContain("이 기간 관련 기사 1건");
    expect($(".chart-events li").text()).toContain("한은, 기준금리 3.00%로 동결");
    expect($(".chart-events li").text()).not.toContain("관련 보도가 나온 시점이에요");
  });

  it("charts 가 없으면 차트 구역이 없다", () => {
    const report = { ...fixture(), charts: undefined };
    const $ = render(report);
    expect($("figure.chart")).toHaveLength(0);
    expect($("h2").filter((_, el) => $(el).text() === "숫자의 변화 추이")).toHaveLength(0);
  });
});

describe("간결한 검사 안내", () => {
  it("검증 패널은 숫자 카드 뒤에 있고 대조 내역과 도구는 하나의 토글 안에 표시한다", () => {
    const report = fixture();
    report.numbers[0].match = { key: "rate", policy: "rounded" };
    const $ = render(report);
    expect($(".report-details")).toHaveLength(0);
    expect($(".verification-detail").parents(".report-verification")).toHaveLength(1);
    expect($(".report-verification").first().prevAll("section").find(".numbers")).toHaveLength(1);
    expect($(".report-verification").parents("details")).toHaveLength(0);
    expect($(".verification-toggle").attr("open")).toBeUndefined(); // 11/21: 기본은 접힘 (서영 2-2 · 외부 E1)
    expect($(".verification-toggle > summary").first().text()).toContain("자세히 보기");
    expect($(".verification-detail").parents(".verification-toggle")).toHaveLength(1);
    expect($(".verification-toggle details")).toHaveLength(0);
    expect($(".verification-detail").text()).toContain('"값" 항목과 표기 반올림과 일치');
    expect($(".verification-detail").text()).toContain("다시 쓰기");
    expect($(".num .report-badge")).toHaveLength(0); // 11/24: 검사 배지는 출처 카드로
    expect($(".source-library [class*='check-']").length).toBeGreaterThan(0);
  });

  it("계산 입력이 자신을 가리켜도 범위 밖 단독 렌더링이 재귀하지 않는다", () => {
    const entry = { ...fixture().evidence[0], id: "C1", lineage: { op: "spread", inputs: ["C1"] } };
    const $ = load(renderToStaticMarkup(<EvidenceRecord entry={entry} evidence={[entry]} />));
    expect($(".evidence-record")).toHaveLength(1);
    expect($(".evidence-inputs").text()).toContain(entry.label);
    expect($(".evidence-inputs a")).toHaveLength(0);
  });
});

describe("읽는 목적에 맞는 근거 탐색", () => {
  it("자료 부족과 오래된 날짜만으로 부분 확인 경고를 만들지 않는다", () => {
    const report = fixture();
    report.verification = { ...report.verification, status: "pass", removed: [], advice: 0 };
    report.dataGaps = ["일부 자료 없음"];
    report.numbers[0].asOf = "2000-01-01";
    const $ = render(report);
    expect($(".report-reading-notice").text()).not.toContain("일부 확인 필요");
    expect($(".num").first().text()).toContain("기준일 2000. 1. 1.");
    expect($(".num").first().text()).not.toContain("최신");
  });

  it("숫자와 설명 자체가 링크이며 반복 CTA 대신 영역별 안내를 제공한다", () => {
    const report = fixture();
    const $ = render(report);
    expect($(".num .metric-value-link b")).toHaveLength(report.numbers.length);
    expect($(".reason-evidence")).toHaveLength(report.why.length);
    expect($(".reason-evidence h3").first().text()).toBe(report.why[0].claim);
    expect($(".num").text()).not.toContain("이 숫자의 출처 보기");
    expect($(".report-help-dialog").text()).toContain("숫자의 '근거 보기' 나 '출처로 이동' 을 누르면");
    expect($(".section-guide")).toHaveLength(0); // 11/24: 영역마다 붙던 안내 문장은 읽는 법으로
    expect($(".source-chips button").length).toBeGreaterThan(0);
  });

  it("추천 주제를 질문에 담되 자동으로 리포트를 생성하지 않는 홈 링크를 제공한다", () => {
    const $ = load(renderToStaticMarkup(<ReportView report={fixture()} area="fx" />));
    const href = $("a[href^='/?question=']").first().attr("href")!;
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("question")).toBe(supportedReportTopics(fixture().nextTopics, "fx")[0].question);
    expect(params.get("area")).toBe(supportedReportTopics(fixture().nextTopics, "fx")[0].area);
  });
});

it("중복 카드 안내 없이 출처·날짜·식별자를 한 영역에 모은다", () => {
  const $ = render(fixture());
  expect($(".evidence-record .report-hint, .evidence-source")).toHaveLength(0);
  const meta = $(".evidence-meta").first().text();
  expect(meta).toContain(fixture().evidence[0].source.name);
  expect(meta).toContain("기준일 " + formatDateKo(fixture().evidence[0].source.asOf)); // 11/21 외부 F13: 점 표기
  expect(meta).not.toContain(fixture().evidence[0].id);
  expect($(".report-hint, .report-reading-notice")).toHaveLength(0);
});


it("자료와 해설은 같은 주제에 한 번만 표시하고 기본 선택은 하나다", () => {
  const report = fixture();
  const $ = render(report);
  expect($(".source-chips button[aria-pressed='true']")).toHaveLength(1);
  expect($(".source-panel:not([hidden])")).toHaveLength(1);
  expect($(".source-panel").map((_, el) => $(el).attr("data-source-group")).get()).toContain("금리");
  expect($(".evidence-record")).toHaveLength(report.evidence.length);
  expect($(".reason-evidence")).toHaveLength(report.why.length);
  expect($(".source-library .reason-evidence")).toHaveLength(0);
});

it("원본 데이터에 없는 출처도 별도 참고 문서로 보존한다", () => {
  const report = fixture();
  report.sources.push({ id: "S99", name: "별도 문서", url: "https://example.org/extra", asOf: "2026-11-01" });
  const $ = render(report);
  expect($("[data-source-group='참고 문서']").text()).toContain("별도 문서");
  expect($("a[href='https://example.org/extra']")).toHaveLength(1);
});


it("자료 영역의 계산 입력 링크는 존재하는 원본으로 연결하고 외부 출처도 유지한다", () => {
  const $ = render(fixture());
  const links = $(".source-library a[href^='#']");
  expect(links.length).toBeGreaterThan(0);
  links.each((_, link) => {
    expect($(link).closest(".evidence-inputs")).toHaveLength(1);
    const target = decodeURIComponent($(link).attr("href")!.slice(1));
    const record = $(link).closest(".report").find(".source-library .evidence-record").filter((_, el) => $(el).attr("id") === target);
    expect(record).toHaveLength(1);
    expect($(link).text().split(" · ")[0]).toBe(record.attr("data-evidence-id"));
  });
  expect($(".source-library a[target='_blank']").length).toBeGreaterThan(0);
});


it("자료 없는 해석을 중복 탭이나 끊어진 링크로 만들지 않는다", () => {
  const $ = render(fixture());
  expect($(".source-chips").text()).not.toContain("AI 해설");
  expect($(".source-count")).toHaveLength(0);
  for (const el of $(".reason-link").toArray()) {
    const id = decodeURIComponent($(el).attr("href")!.slice(1));
    expect($("[id]").filter((_, target) => $(target).attr("id") === id)).toHaveLength(1);
  }
  expect($("svg .chart-axis-guide").text()).toContain("날짜");
  expect($(".chart-subtitle, .chart-band-key")).toHaveLength(0);
});

it("범위 안내가 없으면 빈 안내 막대를 만들지 않는다", () => {
  const report = fixture();
  report.caveats = [];
  report.dataGaps = [];
  expect(render(report)(".metric-notes")).toHaveLength(0);
});

it("단일 원본 값은 위에 같은 수치가 표시된 경우에만 중복을 없앤다", () => {
  const entry = { ...fixture().evidence[0], values: { value: 3 } };
  const same = load(renderToStaticMarkup(<EvidenceRecord entry={entry} evidence={[entry]} displayedValue="3.00%" />));
  expect(same(".evidence-values")).toHaveLength(0);
  expect(same(".evidence-meta").text()).toContain(entry.source.name);
  const different = load(renderToStaticMarkup(<EvidenceRecord entry={entry} evidence={[entry]} displayedValue="4.00%" />));
  expect(different("dd").text()).toBe("3");
  const noSummary = load(renderToStaticMarkup(<EvidenceRecord entry={entry} evidence={[entry]} />));
  expect(noSummary("dd").text()).toBe("3");
});

describe("새 리포트 필드와 이전 기록 호환", () => {
  it("서버의 제목과 이유를 각 본문 순서에 맞춰 연결한다", () => {
    const report = fixture();
    report.headline = "질문에 대한 핵심 답";
    report.impactTitles = report.impact.map((_, i) => `영향 제목 ${i}`);
    report.topicReasons = report.nextTopics.map((_, i) => `연결 이유 ${i}`);
    const $ = render(report);
    expect($(".report h3").text()).toContain(report.headline);
    report.impact.forEach((text, i) => {
      expect($(".impact-card").eq(i).find("h3").text()).toContain(`영향 제목 ${i}`);
      expect($(".impact-card").eq(i).find("p").text()).toBe(text);
    });
    supportedReportTopics(report.nextTopics).forEach((topic, i) => expect($('a[href^="/?question="]').eq(i).find("small").text()).toBe(topic.reason));
  });
  it("새 필드가 없거나 빈 문자열이면 빈 제목과 이유를 만들지 않는다", () => {
    const report = fixture();
    delete report.headline; delete report.impactTitles; delete report.topicReasons;
    report.numbers.forEach(number => { delete number.changeDetail; });
    const $ = render(report);
    expect($(".impact-card h3, .metric-period")).toHaveLength(0);
    expect($(".impact-card p")).toHaveLength(report.impact.length);
    report.impactTitles = report.impact.map(() => "");
    expect(render(report)(".impact-card h3")).toHaveLength(0);
  });
  it("공식 페이지를 우선하고 없는 출처는 원본 주소로 연결한다", () => {
    const report = fixture();
    report.evidence[0].source.pageUrl = "https://example.com/official";
    report.sources.push({ id: "extra", name: "추가 자료", url: "https://example.com/original", asOf: "2026-11-10" });
    const $ = render(report);
    expect($('.evidence-record a[href="https://example.com/official"]')).toHaveLength(1);
    expect($('.source-library a[href="https://example.com/original"]')).toHaveLength(1);
  });
  it("서버 고지를 한 번 표시하고 검증 결과와 별도로 안내한다", () => {
    const report = fixture(); report.notice = "판단 요청 안내";
    const $ = render(report);
    expect($(".report-disclosure")).toHaveLength(1);
    expect($(".report-disclosure").text()).toBe(report.disclosure);
    expect($(".report-disclosure").parents("details")).toHaveLength(0);
    expect($(".report-ai-intro")).toHaveLength(0);
    expect($(".report-notice").text()).toContain(report.notice);
  });
});

it("검증 제목 옆에 상태를 두고 대조 규칙과 도구 기록은 같은 접힌 상세에 보존한다", () => {
  const report = fixture();
  report.numbers[0].match = { key: "rate", policy: "exact" };
  const $ = render(report, [{ tool: "get_fx_krw_rate", status: "ok", ms: 12, fallbackAgeMs: 3600000, breaker: "open" }]);
  const panel = $('details[aria-label="리포트 상세 정보"]');
  expect(panel).toHaveLength(1);
  expect(panel.attr("open")).toBeUndefined();
  expect(panel.find("summary .verification-summary-copy strong .status-partial")).toHaveLength(1);
  expect(panel.find(".verification-detail").text()).toContain('"값" 항목과 정확히 일치');
  expect($(".reference-toggle .report-tools").text()).toContain("잠시 호출을 쉬고 있어");
  expect($(".reference-toggle .report-tools").text()).not.toContain("🟡");
  expect($(".report-disclosure").text()).toBe(report.disclosure);
});

it("검증의 근거 번호와 원인별 원본 보기 링크가 실제 원본을 가리킨다", () => {
  const report = fixture();
  const $ = render(report);
  const links = $(".verification-ref, .reason-originals .evidence-link");
  expect(links.length).toBeGreaterThan(0);
  links.each((_, el) => {
    const target = decodeURIComponent($(el).attr("href")!.slice(1));
    expect($(".evidence-record").filter((_, record) => $(record).attr("id") === target)).toHaveLength(1);
  });
  expect($(".reason-originals").text()).toContain("출처로 이동 ↓ · E2");
  expect($(".reason-originals").text()).toContain("출처로 이동 ↓ · E3");
  expect($(".reason-originals").text()).toContain("출처로 이동 ↓ · C1");
});

it("원본 자료마다 실제 근거 번호를 표시한다", () => {
  const report = fixture();
  const $ = render(report);
  // 11/21 QA 4: 쓴 자료가 앞, 안 쓴 자료는 뒤에 접히므로 순서 대신 전부 있는지 봅니다
  expect($(".evidence-record").map((_, el) => $(el).attr("data-evidence-id")).get().sort()).toEqual(report.evidence.map(entry => entry.id).sort());
});

it("검증은 항상 ON이며 토글 없이 필수 고지·원본 탐색을 제공한다", () => {
  const report = fixture();
  const $ = render(report);
  expect($(".report").attr("data-verification")).toBe("on");
  expect($(".report-mode-toggle")).toHaveLength(0);
  expect($(".report-disclosure").text()).toContain("생성형 AI");
  expect($(".reference-toggle").text()).toContain(report.caveats[0]);
  expect($(".num .metric-value-link").length).toBeGreaterThan(0);
});

it("도구 기록은 표가 아니라 실패 · 저장본만 메모로 남긴다 (11/21 QA 7)", () => {
  const $ = render(fixture(), [{ tool: "get_fx_krw_rate", status: "ok", ms: 912 }, { tool: "get_rate_data", status: "error", ms: 20, error: "조회 실패" }]);
  expect($(".tool-table")).toHaveLength(0);
  const notes = $(".report-tools li").map((_, el) => $(el).text()).get();
  expect(notes).toHaveLength(1);
  expect(notes[0]).toBe("금리 확인: 자료를 받지 못했어요"); // 11/23: 내부 오류 문구는 붙이지 않음
});

describe("원인 칸 · 영향 칸 · 비교 기간 (11/19 페르소나 테스트 반영)", () => {
  it("원인이 없고 움직임이 평소 범위면 원인을 따로 찾지 않았다고 설명한다", () => {
    const report = fixture();
    report.why = [];
    report.movement = { ref: report.evidence[0]!.id, zScore: 0.2, window: 90, level: "normal" };
    const text = render(report).text();
    expect(text).toContain("평소 범위 안이라 원인을 따로 찾지 않았어요");
    expect(text).not.toContain("데이터가 아직 없습니다");
  });
  it("원인이 없고 움직임이 크면 후보를 봤지만 근거가 부족했다고 설명한다", () => {
    const report = fixture();
    report.why = [];
    report.movement = { ref: report.evidence[0]!.id, zScore: 2.4, window: 90, level: "extreme" };
    expect(render(report).text()).toContain("원인 후보(금리 차이 · 뉴스 · 다른 통화)를 확인했지만");
  });
  it("원인이 없고 게이트 결과도 없으면 자료를 확보하지 못했다고 설명한다", () => {
    const report = fixture();
    report.why = [];
    delete report.movement;
    expect(render(report).text()).toContain("원인을 뒷받침할 자료를 확보하지 못했어요");
  });
  it("영향 카드가 없으면 영향 칸 제목을 그리지 않는다", () => {
    const report = fixture();
    report.impact = [];
    delete report.impactTitles;
    const $ = render(report);
    expect($.text()).not.toContain("내 생활에 미치는 영향");
    expect($("h2").filter((_, el) => $(el).text() === "숫자 너머의 이야기")).toHaveLength(1);
  });
  it("비교 시작일이 없으면 '시작일 미제공' 대신 비교 기간 줄을 생략한다", () => {
    const report = fixture();
    report.numbers[0]!.changeDetail = { key: "latest.change", value: -300, unit: "원", to: "2026-11-18", basis: "전일과 비교" };
    const $ = render(report);
    expect($.text()).not.toContain("시작일 미제공");
    expect($(".metric-period").filter((_, el) => $(el).text().includes("2026-11-18"))).toHaveLength(0);
  });
});


describe("답과 숫자 우선 배치", () => {
  it("질문·답·숫자 순서를 유지하고 출처와 추천을 기본 표시한다", () => {
    const report = fixture();
    const $ = load(renderToStaticMarkup(<ReportView report={report} question="비교 질문" createdAt="2026-11-19T01:00:00Z" />));
    const text = $(".report").text();
    expect(text.indexOf("비교 질문")).toBeLessThan(text.indexOf(report.headline!));
    expect(text.indexOf(report.headline!)).toBeLessThan(text.indexOf(report.numbers[0].value));
    // 11/25 가독성: 원인이 있으면 요약 문단은 한입 요약 안 '자세한 요약' 에 접혀 한 번만 나온다
    expect($(".hero-more").attr("open")).toBeUndefined();
    expect($(".hero-more").text()).toContain(report.summary);
    expect(text.split(report.summary)).toHaveLength(2);
    expect($(".numbers").parent().find(".report-help-button").text()).toContain("리포트 읽는 법");
    expect($(".report-mode-toggle")).toHaveLength(0);
    // 11/24 가독성: 출처와 원본 데이터는 PC 에서도 접어 두고 한 줄 요약을 보인다
    expect($(".source-library > details.responsive-details").attr("open")).toBeUndefined();
    expect($(".source-library > details > summary").text()).toContain("자료");
    expect($(".source-library .evidence-record").length).toBeGreaterThan(0);
    expect($("a[href^='/?question=']").first().parents("details").attr("open")).toBeDefined();
    expect($(".report-created-at").text()).toContain("작성일");
    expect($(".num").first().text()).toContain(report.evidence[0].source.name);
    expect($(".num").first().text()).toContain("근거 보기");
  });
  it("한 문장 답이 없는 과거 리포트는 요약을 한 번만 보존한다", () => {
    const report = fixture();
    delete report.headline;
    const $ = render(report);
    expect($(".report").text().split(report.summary)).toHaveLength(2);
    expect($(".report > section").first().text()).toContain(report.summary);
  });
});

it("원인 근거는 숫자 다음에 한 번만 표시하고 안내와 검증은 뒤에 둔다", () => {
  const report = fixture();
  const $ = render(report);
  const text = $(".report").text();
  expect(text.indexOf(report.numbers[0].value)).toBeLessThan(text.indexOf(report.why[0].claim));
  expect(text.indexOf(report.why[0].claim)).toBeLessThan(text.indexOf("내 생활에 미치는 영향"));
  expect($(".reason-evidence").first().text()).toContain(report.why[0].evidence);
  expect(text.split(report.why[0].claim)).toHaveLength(2);
  for (const guide of $(".section-guide").toArray()) {
    expect($(guide).nextAll().not("[class*='reportToolbar']")).toHaveLength(0);
  }
  // 11/21 외부 E2: 추천은 맨 끝, 주의점은 그 앞
  expect($(".report > section").last().text()).toMatch(/이어서 알아볼까요\?|주의점과 확인하지 못한 것/);
  if (text.includes("이어서 알아볼까요?")) expect(text.indexOf("주의점과 확인하지 못한 것")).toBeLessThan(text.indexOf("이어서 알아볼까요?"));
});

describe("머리 줄 · 주의점 · 보관 버튼 (11/20 하니 리뷰)", () => {
  it("배지와 작성일은 질문 카드 안 한 줄에 있고 맨 아래에는 없다", () => {
    const report = fixture();
    const $ = load(renderToStaticMarkup(<ReportView report={report} question="요즘 환율 왜 이래?" createdAt="2026-11-20T03:00:00Z" header={<div className="report-head"><div className="chips"><span className="depth-chip">Easy</span></div></div>} />));
    const line = $("section[aria-label='나의 질문'] .report-meta-line");
    expect(line).toHaveLength(1);
    expect(line.find(".depth-chip").text()).toBe("Easy");
    expect(line.find(".report-created-at").text()).toContain("작성일");
    expect($(".report-bottom-controls")).toHaveLength(0);
    expect($("p.report-created-at")).toHaveLength(0);
  });
  it("주의점과 확인하지 못한 것은 접히지 않고 열려 있으며 '상세 보기' 토글이 없다", () => {
    const report = fixture();
    report.caveats = ["환율은 일별 기준값입니다."];
    const $ = render(report);
    const details = $("details.reference-toggle");
    expect(details).toHaveLength(1);
    expect(details.attr("open")).toBeDefined();
    expect(details.find("summary").text()).not.toContain("상세 보기");
    expect(details.text()).toContain("환율은 일별 기준값입니다.");
  });
});

describe("11/21 QA 1묶음", () => {
  const article = (id: string, url: string): Report["evidence"][number] => ({ id, tool: "get_economic_news", label: "기사", values: { title: id, publisher: "연합뉴스", publishedAt: "2026-11-20", body: "available" }, source: { name: "연합뉴스", url, asOf: "2026-11-20" } });
  it("여러 영역 머리말은 질문에서 떼고 배지로 보여 준다 (외부 G1)", () => {
    const $ = load(renderToStaticMarkup(<ReportView report={fixture()} question={"관심 영역: 환율, ETF\n\n요즘 환율 왜 올라?"} />));
    expect($("section[aria-label='나의 질문'] blockquote").text()).toBe("요즘 환율 왜 올라?");
    expect($(".report-area-chips .category-chip").map((_, el) => $(el).text()).get()).toEqual(["환율", "ETF"]);
  });
  it("검증이 한 일은 접힌 한 줄로 시작하고 영문 키 대신 한글 라벨을 쓴다 (서영 2-2 · 3)", () => {
    const report = fixture();
    report.numbers[0].match = { key: "comparison.rate", policy: "exact" };
    const $ = render(report);
    const panel = $('details[aria-label="리포트 상세 정보"]');
    expect(panel.attr("open")).toBeUndefined();
    expect(panel.find("summary").text()).toContain("자세히 보기");
    expect(panel.find("summary").text()).toMatch(/숫자 \d+개 중 값 대조 \d+개/);
    expect(panel.find(".verification-detail").text()).toContain('"비교 값" 항목과 정확히 일치');
    expect(panel.find(".verification-detail").text()).not.toContain("comparison.rate");
  });
  it("기사 근거는 기사로 바로 가는 링크, 데이터 근거는 출처로 이동 (QA 3)", () => {
    const report = fixture();
    report.evidence.push(article("E9-1", "https://www.yna.co.kr/view/1"));
    report.why[0].refs = [report.evidence[0]!.id, "E9-1"];
    const $ = render(report);
    const links = $(".reason-originals").first();
    expect(links.find("a.reason-article").attr("href")).toBe("https://www.yna.co.kr/view/1");
    expect(links.find("a.reason-article").attr("target")).toBe("_blank");
    expect(links.find("a.reason-article").text()).toBe("연합뉴스 기사 보기 ↗");
    expect(links.text()).toContain(`출처로 이동 ↓ · ${report.evidence[0]!.id}`);
    expect(links.text()).not.toContain("원본 보기");
  });
  it("기사가 둘 이상이면 한 줄로 접는다 (QA 3)", () => {
    const report = fixture();
    const ids = ["E9-1", "E9-2", "E9-3"];
    for (const id of ids) report.evidence.push(article(id, `https://www.yna.co.kr/view/${id}`));
    report.why[0].refs = ids;
    const $ = render(report);
    expect($(".reason-originals").first().find("details.reason-news summary").text()).toBe("기사 3건 보기");
    expect($(".reason-originals").first().find("a.reason-article")).toHaveLength(3);
  });
  it("숫자가 없으면 숫자 칸을 숨기고, 기사만 있으면 기사 건수를 보여 준다 (QA 11 · 12)", () => {
    const report = fixture();
    report.numbers = []; report.evidence = []; report.sources = [];
    const empty = render(report);
    expect(empty.text()).not.toContain("표시할 숫자를 확보하지 못했습니다");
    expect(empty.text()).not.toContain("오늘의 숫자");
    expect(empty.text()).not.toContain("연결된 자료가 없습니다");
    expect(empty(".report-help-button")).toHaveLength(1);
    const news = fixture();
    news.numbers = [];
    news.evidence = [article("E1-1", "https://www.yna.co.kr/view/1")];
    const $ = render(news);
    expect($(".news-count").text()).toBe("기사 1건 · 2026. 11. 20. · 연합뉴스");
    expect($.text()).toContain("확인한 기사");
  });
  it("환율 카드 아래 고시 기준 한 줄, 변화율 본값은 색, 날짜는 점 표기 (서영 1-1 · 외부 F10 · F13)", () => {
    const report = fixture();
    const $ = render(report);
    expect($(".source-library .evidence-basis").first().text()).toContain("유럽중앙은행 고시 기준"); // 11/24: 카드에서 출처 카드로
    expect($(".num").first().text()).toMatch(/기준일 \d{4}\. \d{1,2}\. \d{1,2}\./);
    report.numbers[0].value = "+2.82%";
    expect(render(report)(".num").first().find("b").attr("class")).toContain("tone-up");
  });
  it("자료 부족은 요약 아래 한 줄로 알리고 아래 목록으로 이어진다 (하니 5)", () => {
    const report = fixture();
    report.dataGaps = ["기준금리 변경일을 확인하지 못함"];
    const $ = render(report);
    expect($(".hero-gaps").text()).toContain("확인하지 못한 자료 1개");
    expect($(".hero-gaps a").attr("href")).toMatch(/section-gaps$/);
    expect($(".report-section-target").filter((_, el) => $(el).text().includes("확인하지 못한 것"))).toHaveLength(1);
  });
  it("기사 출처 카드에는 반복 안내 문단이 없고 상태 배지만 있다 (QA 13)", () => {
    const report = fixture();
    report.evidence.push(article("E9-1", "https://www.yna.co.kr/view/1"));
    const text = render(report).text();
    expect(text).not.toContain("본문을 확보한 기사입니다");
    expect(text).toContain("본문 확보");
  });
});

describe("11/21 QA 2묶음 A", () => {
  it("같은 장부의 비교값 · 변화량 · 수익률은 본값 카드 안으로 묶인다 (하니 4)", () => {
    const report = fixture();
    const ref = report.evidence[0]!.id;
    const base = report.numbers[0]!;
    report.numbers = [
      { ...base, label: "KODEX 200 종가", value: "80,630원", ref },
      { ...base, label: "30일 가격 수익률", value: "−7.06%", ref },
      { ...base, label: "코스피 200 수익률", value: "−6.89%", ref },
    ];
    const $ = render(report);
    expect($(".num")).toHaveLength(1);
    expect($(".numbers").attr("data-count")).toBe("1");
    expect($(".num .num-subs li")).toHaveLength(2);
    expect($(".num .num-subs").text()).toContain("30일 가격 수익률");
    expect($(".num .num-subs b").first().attr("class")).toContain("tone-down");
  });
  it("묶인 딸린 숫자의 비교 기간과 다른 기준일은 그대로 남는다 (Codex 리뷰)", () => {
    const report = fixture();
    const ref = report.evidence[0]!.id;
    const base = report.numbers[0]!;
    report.numbers = [
      { ...base, label: "KODEX 200 종가", value: "80,630원", ref, asOf: "2026-11-16", change: "" },
      { ...base, label: "30일 가격 수익률", value: "−7.06%", ref, asOf: "2026-11-16", change: "2026-10-19~2026-11-16", changeDetail: { key: "period.returnPct", value: -7.06, unit: "%", basis: "30일 전과 비교", from: "2026-10-19", to: "2026-11-16" } },
      { ...base, label: "비교 기준일 종가", value: "86,755원", ref, asOf: "2026-10-18", change: "" },
    ];
    const rows = render(report)(".num .num-subs li");
    expect(rows).toHaveLength(2);
    expect(rows.first().text()).toContain("비교 기간 2026. 10. 19. → 2026. 11. 16.");
    expect(rows.last().text()).toContain("기준일 2026. 10. 18.");
  });
  it("본값이 없는 장부의 딸린 숫자와 다른 장부의 숫자는 따로 둔다", () => {
    const report = fixture();
    const base = report.numbers[0]!;
    const cards = groupNumbers([
      { ...base, label: "미국 − 한국 금리 차이", value: "0.88%p", ref: "C1" },
      { ...base, label: "한국 기준금리", value: "3.00%", ref: "E1" },
      { ...base, label: "기준금리 비교값", value: "3.00%", ref: "E1" },
      { ...base, label: "미국 금리", value: "3.88%", ref: "E2" },
    ]);
    expect(cards.map(card => [card.main.label, card.subs.length])).toEqual([["미국 − 한국 금리 차이", 0], ["한국 기준금리", 1], ["미국 금리", 0]]);
  });
  it("근거 보기 링크는 대조한 값 키와 돌아올 자리를 들고 간다 (QA 2 · 외부 F8)", () => {
    const report = fixture();
    report.numbers[0]!.match = { key: "rate", policy: "exact" };
    const $ = render(report);
    const link = $(".num").first().find("a.metric-value-link");
    expect(link.attr("data-value-key")).toBe("rate");
    expect(link.attr("data-origin")).toMatch(/number-0$/);
    expect($(".num").first().attr("id")).toBe(link.attr("data-origin"));
    expect($(".evidence-values > div[data-key='rate']").length).toBeGreaterThan(0);
    expect($(".evidence-return")).toHaveLength(0); // 아직 내려가기 전이라 돌아가기 버튼 없음
  });
  it("출처 탭은 리포트가 쓴 자료부터, 안 쓴 자료는 뒤에 접힌다 (QA 4)", () => {
    const report = fixture();
    const rate = (id: string): Report["evidence"][number] => ({ id, tool: "get_rate_data", label: "금리 확인", values: { rate: 3, unit: "%" }, source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr/", asOf: "2026-11-19" } });
    const fx: Report["evidence"][number] = { id: "E3", tool: "get_fx_krw_rate", label: "환율 확인", values: { rate: 1392.4, change: 27.3, changePct: 2, comparisonRate: 1365.1, comparisonAsOf: "2026-09-19", asOf: "2026-10-19", pair: "USD/KRW" }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-10-19" } };
    report.evidence = [rate("E1"), rate("E2"), fx];
    report.numbers = [{ ...report.numbers[0]!, label: "USD/KRW", value: "1,392.40원", ref: "E3", match: { key: "rate", policy: "exact" } }];
    report.why = []; report.charts = []; report.sources = [];
    const $ = render(report);
    expect($(".source-chips")).toHaveLength(0);
    expect($(".source-panel").map((_, el) => $(el).attr("data-source-group")).get()).toEqual(["환율"]);
    expect($(".source-unused > summary").text()).toContain("조회했지만 리포트에 쓰지 않은 자료 2개");
    expect($(".source-unused .evidence-record")).toHaveLength(2);
    expect($(".source-unused").attr("open")).toBeUndefined();
    const card = $(".source-panel[data-source-group='환율'] .evidence-record");
    expect(card.find(".evidence-values").first().find("dt").first().attr("title")).toBe("rate");
    expect(card.find(".evidence-values").first().find("dt")).toHaveLength(4);
    expect(card.find(".evidence-more > summary").text()).toBe("원본 값 전체 보기 (7개)");
    expect(card.find(".evidence-more").attr("open")).toBeUndefined();
  });
  it("계산 장부는 note 첫 문장을 계산식으로 보여 준다 (QA 4)", () => {
    const report = fixture();
    const calc = report.evidence.find(entry => entry.lineage);
    expect(calc).toBeDefined();
    calc!.note = "E3.rate 3.88 − E2.rate 3.00 = 0.88%p. 장부 값으로 계산한 결과이며 출처 링크는 없습니다";
    const $ = render(report);
    const record = $(`.evidence-record[data-evidence-id='${calc!.id}']`);
    expect(record.find(".evidence-formula").text()).toContain("= 0.88%p");
    expect(record.find(".evidence-note").text()).toBe("장부 값으로 계산한 결과이며 출처 링크는 없습니다");
  });
  it("거래대금 같은 큰 원화 금액은 조 · 억으로 (QA 4)", () => {
    expect(formatEvidenceValue("latest.tradeValue", 1532179713324)).toBe("1조 5,322억 원");
    expect(formatEvidenceValue("latest.netAssets", 250000000000)).toBe("2,500억 원");
    expect(formatEvidenceValue("latest.close", 80630)).toBe("80,630");
    expect(formatEvidenceValue("changePp", -0.2169840746809312)).toBe("-0.217");
  });
});

describe("11/21 QA 최종리포트 화면 항목", () => {
  it("추천이 비어도 영역에 맞는 기본 질문과 이어서 질문하기가 있다 (QA-06)", () => {
    const report = fixture();
    report.nextTopics = []; report.topicReasons = [];
    const $ = load(renderToStaticMarkup(<ReportView report={report} area="macro" />));
    expect($(".topicLink, [class*='topicLink']").length).toBeGreaterThan(0);
    expect($.text()).toContain("이어서 알아볼까요?");
    expect($(".report-continue a").attr("href")).toBe("/?area=macro");
    // ETF 기본 질문을 보고 있어 영역 추천이 비어도 공통 질문과 링크는 남는다 (Codex 리뷰)
    const etf = fixture();
    etf.nextTopics = []; etf.topicReasons = [];
    const only = load(renderToStaticMarkup(<ReportView report={etf} area="etf" question="최근 30일 KODEX 200의 가격과 기초지수 수익률은 얼마나 차이 나나요?" />));
    expect(only.text()).toContain("이어서 알아볼까요?");
    expect(only(".report-continue a").attr("href")).toBe("/?area=etf");
    const bare = fixture();
    bare.nextTopics = []; bare.topicReasons = [];
    expect(load(renderToStaticMarkup(<ReportView report={bare} />))(".report-continue a").attr("href")).toBe("/");
  });
  it("고른 영역과 쓴 자료의 주제가 다르면 안내 한 줄, 같으면 없음 (QA-08)", () => {
    const report = fixture();
    const macro = render(report);
    expect(macro(".report-area-note")).toHaveLength(0);
    const fx = report.evidence.find(entry => /fx/i.test(entry.tool));
    expect(fx).toBeDefined();
    const mismatched = fixture();
    mismatched.evidence = [{ ...fx!, id: "E1", tool: "get_macro_indicators", label: "물가 확인" }];
    mismatched.numbers = [{ ...mismatched.numbers[0]!, ref: "E1" }];
    mismatched.why = [];
    const $ = load(renderToStaticMarkup(<ReportView report={mismatched} area="etf" question="한국 물가상승률이 내려갔다는 게 무슨 뜻이야?" createdAt="2026-11-21T01:00:00Z" />));
    expect($(".report-area-note").text()).toBe("질문에 맞춰 물가를 중심으로 설명했어요");
  });
  it("ETF 카드 아래에 기초지수 한 줄 (QA-02)", () => {
    const report = fixture();
    const base = report.evidence[0]!;
    report.evidence = [{ ...base, id: "E1", tool: "get_etf_kr_price", label: "국내 ETF 시세 확인", values: { name: "KODEX 200", baseIndex: "코스피 200", "latest.close": 80630 } }];
    report.numbers = [{ ...report.numbers[0]!, label: "KODEX 200 종가", value: "80,630원", ref: "E1" }];
    report.why = [];
    expect(render(report)(".source-library .evidence-basis").text()).toBe("코스피 200 지수를 따라가는 국내 상장 ETF"); // 11/24: 카드에서 출처 카드로
  });
});

describe("백엔드 1차 반영 뒤 화면 (11/22)", () => {
  it("기사는 번호로 참조되지 않아도 접히지 않고, 계산 묶음은 맨 뒤", () => {
    const report = fixture();
    const article = (id: string): Report["evidence"][number] => ({ id, tool: "get_economic_news", label: "기사", values: { title: id, publisher: "연합뉴스", publishedAt: "2026-11-21", body: "unavailable" }, source: { name: "연합뉴스", url: `https://www.yna.co.kr/${id}`, asOf: "2026-11-21" } });
    report.evidence.push(article("E9-1"), article("E9-2"), article("E9-3"));
    const $ = render(report);
    expect($(".source-unused .evidence-record[data-evidence-id^='E9-']")).toHaveLength(0);
    expect($(".source-panel[data-source-group='뉴스'] .evidence-record[data-evidence-id^='E9-']")).toHaveLength(3);
    const chips = $(".source-chips button").map((_, el) => $(el).text()).get();
    if (chips.includes("계산")) expect(chips[chips.length - 1]).toBe("계산");
  });
  it("접힌 자료 목록은 다섯 개까지만 적는다", () => {
    const report = fixture();
    for (let i = 0; i < 7; i++) report.evidence.push({ ...report.evidence[0]!, id: `E8-${i}`, tool: "get_rate_data", label: `금리 확인 ${i}` });
    expect(render(report)(".source-unused > summary").text()).toMatch(/외 \d+개$/);
  });
});

describe("백엔드 #135 뒤 운영 확인 (11/22)", () => {
  it("판단 요청 고지는 브랜드 제목 위가 아니라 질문 카드 안에 있다", () => {
    const report = fixture(); report.notice = "투자 판단을 대신하지 않아요."; report.mode = "judgement" as Report["mode"];
    const $ = load(renderToStaticMarkup(<ReportView report={report} question="KODEX 200 지금 사도 돼?" />));
    expect($("section[aria-label='나의 질문'] .report-question-notice").text()).toContain("투자 판단을 대신하지 않아요.");
    expect($(".report-brand-header").prevAll(".report-notice")).toHaveLength(0);
  });
  it("딸린 숫자 줄은 라벨과 같은 말을 빼고, 모두 같은 기간이면 한 번만 적는다", () => {
    const report = fixture();
    const ref = report.evidence[0]!.id;
    const base = report.numbers[0]!;
    report.numbers = [
      { ...base, label: "KODEX 200 종가", value: "80,630원", ref, change: "" },
      { ...base, label: "KODEX 200 가격 수익률", value: "−7.06%", ref, change: "최근 30일(2026-10-20~2026-11-19)", changeDetail: undefined },
      { ...base, label: "코스피 200 기초지수 수익률", value: "−6.89%", ref, change: "최근 30일(2026-10-20~2026-11-19)", changeDetail: undefined },
    ];
    const $ = render(report);
    expect($(".num-subs .num-sub-detail")).toHaveLength(0);
    expect($(".num-subs-shared").text()).toBe("최근 30일(2026년 10월 20일~11월 19일)"); // 11/22: 문장 속 날짜도 한국어로
    const cpi = fixture();
    cpi.numbers = [
      { ...base, label: "한국 소비자물가지수", value: "120.73", ref, change: "" },
      { ...base, label: "한국 소비자물가지수 전월 대비", value: "0.25%", ref, change: "전월 대비", changeDetail: undefined },
      { ...base, label: "한국 소비자물가지수 전년 동월 대비", value: "2.82%", ref, change: "전년 동월 대비", changeDetail: undefined },
    ];
    const $c = render(cpi);
    expect($c(".num-subs").text()).not.toMatch(/대비전월 대비|대비전년 동월 대비/);
    expect($c(".num-subs-shared")).toHaveLength(0);
  });
  it("출처 카드는 같은 장부의 첫 숫자만 크게, 나머지는 작은 줄", () => {
    const report = fixture();
    const ref = report.evidence[0]!.id;
    const base = report.numbers[0]!;
    report.numbers = [
      { ...base, label: "기준금리", value: "3%", ref, change: "" },
      { ...base, label: "기준금리 1년 변화", value: "+0.50%p", ref, change: "" },
    ];
    const $ = render(report);
    const item = $(`.source-data-item:has(.evidence-record[data-evidence-id='${ref}'])`);
    expect(item.find(".source-number")).toHaveLength(1);
    expect(item.find(".source-number-subs li")).toHaveLength(1);
    expect(item.find(".source-number-subs li").text()).toContain("+0.50%p");
  });
});

describe("문장 속 날짜 표기 (11/22)", () => {
  it("요약 · 본문 · 카드 라벨의 날짜는 한국어로, 원본 데이터 표는 그대로", () => {
    const report = fixture();
    report.headline = "한국의 계절조정 실업률은 2026-10월 2.5%예요.";
    report.summary = "2026-11-20 기준 3%로, 2025-11-20보다 0.50%p 높아요.";
    report.caveats = ["CPI 는 2026-10 관측값이에요."];
    report.numbers[0]!.label = "물가 상승률 (2026-10, 전년 같은 달 대비)";
    report.evidence[0]!.values = { ...report.evidence[0]!.values, asOf: "2026-11-20" };
    const $ = render(report);
    expect($("section[class*=hero] h3").text()).toBe("한국의 계절조정 실업률은 2026년 10월 2.5%예요.");
    expect($.text()).toContain("2026년 11월 20일 기준 3%로, 2025년 11월 20일보다");
    expect($.text()).toContain("CPI 는 2026년 10월 관측값이에요.");
    expect($(".num .metric-label").first().text()).toBe("물가 상승률 (2026년 10월, 전년 같은 달 대비)");
    expect($(".evidence-values dd").map((_, el) => $(el).text()).get()).toContain("2026-11-20");
  });
});

describe("#141 뒤 운영 확인 (11/23)", () => {
  it("평소 하루 움직임 카드에 '직전 거래일과 비교해 상승' 을 그리지 않는다", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0]!, label: "하루 평균 움직임 (최근 30일)", value: "0.17%", change: "평소(직전 90일 0.23%)의 0.74배", changeDetail: { key: "baselineDailyAvgMovePct", value: 0.23, unit: "%", to: "2026-11-06", days: 30, basis: "직전 거래일과 비교" } }];
    const $ = render(report);
    expect($(".num i").text()).toBe("평소(직전 90일 0.23%)의 0.74배");
    expect($(".num i").attr("class")).toBe("flat");
    expect($(".num").text()).not.toContain("직전 거래일과 비교");
  });
  it("카드 값이 곧 변화량이면 변화 줄을 다시 쓰지 않고 비교 기간만", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0]!, label: "USD/KRW 30일 변화", value: "+0.87%", change: "30일 +0.87%", changeDetail: { key: "changePct", value: 0.87, unit: "%", from: "2026-10-23", to: "2026-11-22", days: 30, basis: "30일 전과 비교" } }];
    const $ = render(report);
    expect($(".num i")).toHaveLength(0);
    expect($(".num .metric-period").text()).toContain("비교 기간 2026. 10. 23. → 2026. 11. 22.");
  });
  it("백엔드가 이미 적은 저장 응답 줄은 메모에 다시 쓰지 않는다", () => {
    const report = fixture();
    report.dataGaps = ["경제 뉴스 확인: 조회가 실패해 3시간 전에 받은 응답을 썼어요 (데이터 기준일은 출처 그대로)"];
    const $ = render(report, [{ tool: "get_korean_economic_news", status: "ok", ms: 30, fallbackAgeMs: 3 * 3_600_000 }]);
    expect($(".report-tools")).toHaveLength(0);
    expect($.text().match(/경제 뉴스 확인:/g)).toHaveLength(1);
  });
});

describe("11/23 재점검", () => {
  it("계산 도구 실패는 자료 확인 메모에 보이지 않는다", () => {
    const $ = render(fixture(), [{ tool: "calc_metrics", status: "error", ms: 5, error: "데이터를 확인하지 못했어요." }]);
    expect($(".report-tools")).toHaveLength(0);
    expect($.text()).not.toContain("데이터를 확인하지 못했어요");
  });
});

describe("11/23 운영 브라우저 검수", () => {
  it("계산식의 장부 키를 화면 라벨로 바꾸고, 환산 키도 한글로 보여 준다", () => {
    const report = fixture();
    const calc = report.evidence.find(entry => entry.id === "C1")!;
    calc.note = "E1.change -3.77 × 100 ÷ 100 = -3.77원. 장부 값에 사용자가 말한 금액을 곱한 결과";
    calc.values = { scaled: -3.77, from: -3.77, amount: 100, unit: "원" };
    const record = render(report)(`.evidence-record[data-evidence-id='C1']`);
    expect(record.find(".evidence-formula").text()).toContain("E1 변화량 -3.77 × 100 ÷ 100 = -3.77원");
    expect(record.text()).not.toContain("E1.change");
    expect(record.text()).toContain("환산 결과");
    expect(record.text()).toContain("환산할 금액");
    expect(record.find(".evidence-note").text()).toBe("장부 값에 사용자가 말한 금액을 곱한 결과");
  });

  it("출처 이름의 ISO 기간을 리포트 문장처럼 한국어로 보여 준다", () => {
    const report = fixture();
    const fx = report.evidence.find(entry => entry.id === "E1")!;
    fx.source = { ...fx.source, name: "Frankfurter v2 일별 환율 (2026-07-27 ~ 2026-11-23)" };
    report.sources = report.sources.map(source => source.url === fx.source.url ? { ...source, name: fx.source.name } : source);
    const $ = render(report);
    // 11/24: 카드에는 짧은 이름, 전체 이름(날짜 포함)은 title · 출처 카드에
    expect($(".metric-source").first().attr("title")).toBe("Frankfurter v2 일별 환율 (2026년 7월 27일~11월 23일)");
    expect($(".source-library").text()).toContain("Frankfurter v2 일별 환율 (2026년 7월 27일~11월 23일)");
    expect($.text()).not.toContain("2026-07-27");
  });

  it("제목만 확인한 기사 안내는 뉴스 묶음 위에 한 번만 나온다", () => {
    const report = fixture();
    for (const entry of report.evidence.filter(e => e.id.startsWith("E4-"))) entry.values.body = "not_requested";
    const $ = render(report);
    const panel = $("[data-source-group='뉴스']");
    expect(panel.find(".news-title-note")).toHaveLength(1);
    expect(panel.find(".news-title-note").text()).toContain("기사 2건 모두 제목만 확인해");
    expect(panel.text()).not.toContain("제목만 확인한 기사라");
    expect(panel.text()).not.toContain("본문 미요청");
  });
});

describe("월 단위 지표의 기준일 (11/23 운영 검수)", () => {
  it("물가 · 고용 지표 카드의 '매달 1일' 기준일은 달로 보여 준다", () => {
    const report = fixture();
    const fx = report.evidence.find(entry => entry.id === "E1")!;
    fx.tool = "get_macro_indicators";
    fx.source = { ...fx.source, asOf: "2026-10-01" };
    const card = report.numbers.find(n => n.ref === "E1")!;
    card.asOf = "2026-10-01";
    const $ = render(report);
    const text = $(".numbers").text();
    expect(text).toContain("기준일 2026. 10.");
    expect(text).not.toContain("2026. 10. 1.");
  });
  it("월 단위 장부와 같은 자료 목록도 기준일을 같이 바꿔 '참고 문서' 에 다시 나오지 않는다 (Codex 리뷰)", () => {
    const report = fixture();
    const fx = report.evidence.find(entry => entry.id === "E1")!;
    fx.tool = "get_macro_indicators";
    fx.source = { ...fx.source, asOf: "2026-10-01" };
    // 자료 목록의 E1 도 같은 자료(주소 · 이름 · 기준일)로 맞춥니다
    report.sources = report.sources.map(source => source.id === "E1" ? { ...source, url: fx.source.url, name: fx.source.name, asOf: "2026-10-01" } : source);
    const $ = render(report);
    expect($("[data-source-group='참고 문서']")).toHaveLength(0);
    expect($.text()).not.toContain("2026. 10. 1.");
  });
  it("일별 자료의 1일은 그대로 날짜로 보여 준다", () => {
    const report = fixture();
    const card = report.numbers.find(n => n.ref === "E1")!;
    card.asOf = "2026-10-01";
    expect(render(report)(".numbers").text()).toContain("기준일 2026. 10. 1.");
  });
});

describe("계산 방식 이름 (11/23 운영 검수)", () => {
  it("검증 상세와 원본 표의 계산 방식을 한글로 보여 준다", () => {
    expect(formatEvidenceValue("op", "scale")).toBe("금액 환산");
    expect(formatEvidenceValue("op", "zscore")).toBe("평소 움직임과 비교");
    const report = fixture();
    const c2 = report.evidence.find(entry => entry.id === "C2")!;
    report.numbers.push({ label: "평소 30일 변동 폭", value: "±1.63%", change: "", asOf: "2026-11-23", ref: "C2", check: "derived" } as Report["numbers"][number]);
    expect(c2.lineage?.op).toBeDefined();
    c2.lineage = { ...c2.lineage!, op: "zscore" };
    const text = render(report)(".report-verification").text();
    expect(text).not.toContain("zscore");
    expect(text).toContain("평소 움직임과 비교");
  });
});

describe("리포트 목차 퀵메뉴 (11/23)", () => {
  it("리포트 한 장 화면에서만 있는 영역으로 목차를 만든다", () => {
    const report = fixture();
    const $ = load(renderToStaticMarkup(<ReportView report={report} quickMenu />));
    const labels = $(".quick-menu-list button").map((_, el) => $(el).text()).get();
    expect(labels[0]).toBe("요약");
    expect(labels).toContain("숫자");
    expect(labels).toContain("출처");
    expect(labels[labels.length - 1]).toBe("검증");
    for (const key of ["summary", "numbers", "sources", "verify"]) expect($(`[data-quick='${key}']`)).toHaveLength(1);
    expect($("nav.quick-menu").attr("aria-label")).toBe("리포트 목차");
  });
  it("영향 · 차트가 없으면 목차에서 빠지고, 퀵메뉴를 켜지 않으면 그리지 않는다", () => {
    const report = fixture();
    report.impact = []; report.impactTitles = []; report.charts = [];
    const labels = load(renderToStaticMarkup(<ReportView report={report} quickMenu />))(".quick-menu-list button").map((_, el) => load(el)("*").text()).get();
    expect(labels.join(" ")).not.toContain("영향");
    expect(labels.join(" ")).not.toContain("차트");
    expect(load(renderToStaticMarkup(<ReportView report={report} />))("nav.quick-menu")).toHaveLength(0);
  });
});

describe("숫자 카드의 짧은 출처 이름 (11/24 가독성)", () => {
  it("끝의 괄호 설명만 떼고, 전체 이름은 title 로 남긴다", async () => {
    const { shortSourceName } = await import("./ReportView");
    expect(shortSourceName("Frankfurter v2 일별 환율 (2026년 7월 27일~11월 23일)")).toBe("Frankfurter v2 일별 환율");
    expect(shortSourceName("한국은행 경제통계시스템(ECOS)")).toBe("한국은행 경제통계시스템");
    expect(shortSourceName("Frankfurter v2")).toBe("Frankfurter v2");
    expect(shortSourceName("(공공데이터)")).toBe("(공공데이터)");
    const report = fixture();
    const fx = report.evidence.find(entry => entry.id === report.numbers[0].ref)!;
    fx.source = { ...fx.source, name: "Frankfurter v2 일별 환율 (2026-07-27 ~ 2026-11-23)" };
    const source = render(report)(".num .metric-source").first();
    expect(source.text()).toBe("Frankfurter v2 일별 환율");
    expect(source.attr("title")).toContain("2026년 7월 27일");
  });
});

describe("기사 제목 끝의 언론사 (11/24)", () => {
  it("언론사를 따로 보일 때 제목 끝의 ' - 언론사' 만 뗀다", async () => {
    const { titleWithoutPublisher } = await import("./format");
    expect(titleWithoutPublisher("코스피 급락에도 원화는 강세 - Chosunbiz", "Chosunbiz")).toBe("코스피 급락에도 원화는 강세");
    expect(titleWithoutPublisher("한투증권 \"주가 하락에 외인 매도 둔화\" - 연합뉴스", "연합뉴스")).toBe("한투증권 \"주가 하락에 외인 매도 둔화\"");
    expect(titleWithoutPublisher("연합뉴스 - 연합뉴스", "연합뉴스")).toBe("연합뉴스");
    expect(titleWithoutPublisher("환율 1,350원 돌파 - 2주 만", "연합뉴스")).toBe("환율 1,350원 돌파 - 2주 만");
    expect(titleWithoutPublisher("제목 - Chosunbiz")).toBe("제목 - Chosunbiz");
  });
});

describe("한국은행 보도자료 · 정책브리핑 표시 (11/25 이용 조건)", () => {
  const news = (id: string, publisher: string, url: string): Report["evidence"][number] => ({ id, tool: "get_korean_economic_news", label: "기사", values: { title: `${id} 제목`, publisher, publishedAt: "2026-11-24", body: "available" }, source: { name: publisher, url, asOf: "2026-11-24" } });
  const bok = news("E9-1", "한국은행", "https://www.bok.or.kr/portal/bbs/B0000501/view.do?nttId=1&menuNo=200690");
  const policy = news("E9-2", "정책브리핑(기획재정부)", "https://www.korea.kr/news/policyNewsView.do?newsId=1");
  const press = news("E9-3", "연합뉴스", "https://www.yna.co.kr/view/1");

  it("한국은행만이면 '보도자료', 섞이면 '기사 · 보도자료' 로 부르고, ECOS 금리 같은 데이터는 보도자료로 보지 않는다", async () => {
    const { isBokRelease, isPolicyNews, newsCountLine, newsLicenseNote, newsNoun } = await import("./format");
    expect(isBokRelease(bok)).toBe(true);
    expect(isBokRelease(press)).toBe(false);
    expect(isBokRelease({ ...bok, tool: "get_rate_data" })).toBe(false);
    expect(isPolicyNews(policy)).toBe(true);
    expect(newsNoun([bok])).toBe("보도자료");
    expect(newsNoun([bok, press])).toBe("기사 · 보도자료");
    expect(newsNoun([press, undefined])).toBe("기사");
    expect(newsCountLine([bok])).toMatch(/^보도자료 1건 · /);
    expect(newsLicenseNote(bok)).toBe("출처 한국은행 · 보도자료 원문을 글자만 옮겨 요약에 썼어요.");
    expect(newsLicenseNote(policy)).toContain("공공누리 1유형");
    expect(newsLicenseNote(press)).toBeNull();
  });

  it("원인 문장의 링크는 '한국은행 보도자료 보기', 여럿이면 '기사 · 보도자료 N건 보기'", () => {
    const report = fixture();
    report.evidence.push(bok, press);
    report.why[0].refs = ["E9-1"];
    expect(render(report)(".reason-article").text()).toContain("한국은행 보도자료 보기");
    report.why[0].refs = ["E9-1", "E9-3"];
    expect(render(report)(".reason-news > summary").text()).toContain("기사 · 보도자료 2건 보기");
  });

  it("출처 카드는 '보도자료 보기' 와 출처 · 가공 안내를, 정책브리핑은 공공누리 안내를 보이고 일반 기사에는 없다", () => {
    const card = (entry: Report["evidence"][number]) => load(renderToStaticMarkup(<EvidenceRecord entry={entry} evidence={[entry]} />));
    const $bok = card(bok);
    expect($bok(".evidence-meta").text()).toContain("보도자료 보기");
    expect($bok(".evidence-meta").text()).not.toContain("기사 보기");
    expect($bok(".evidence-license").text()).toContain("출처 한국은행");
    expect(card(policy)(".evidence-license").text()).toContain("정책브리핑(공공누리 1유형)");
    expect(card(press)(".evidence-license")).toHaveLength(0);
  });

  it("보도 기반 원인의 근거가 한국은행 보도자료면 '보도자료 내용을 바탕으로' 라고 쓴다", () => {
    const report = fixture();
    report.evidence.push(bok, press);
    report.why[0] = { ...report.why[0], basis: "news", refs: ["E9-1"] };
    // 11/25 가독성: 등급 설명은 배지 풍선(title)으로
    expect(render(report)(".basis-explanation .report-badge").first().attr("title")).toBe("보도자료 내용을 바탕으로 안내해요");
    report.why[0].refs = ["E9-3"];
    expect(render(report)(".basis-explanation .report-badge").first().attr("title")).toBe("기사 내용을 바탕으로 안내해요");
  });

  it("차트 아래 목록도 한국은행 항목이면 '관련 보도자료' 로 부른다", () => {
    const report = fixture();
    const entry = report.evidence.find(item => item.id === report.charts![0].events![0].ref)!;
    entry.values.publisher = "한국은행";
    entry.source = { ...entry.source, name: "한국은행", url: "https://www.bok.or.kr/portal/bbs/B0000501/view.do?nttId=2&menuNo=200690" };
    expect(render(report)(".chart-news > summary").text()).toContain("이 기간 관련 보도자료 1건");
  });
});

describe("11/25 가독성: 같은 말 한 번만 · 나에게 · 평소 범위 막대", () => {
  it("설명이 굵은 문장을 거의 되풀이하는지 낱말로 본다 (숫자 · 날짜를 더하면 되풀이가 아님)", async () => {
    const { repeatsClaim } = await import("./format");
    // 녹화 fx-cause · macro-cause-deep · rate-cause 의 실제 문장
    expect(repeatsClaim("데일리안 기사 제목에서 미국 기술주 투매와 환율 상승을 함께 다뤘어요.", "데일리안 제목은 미국 기술주 투매와 원·달러 환율의 소폭 상승을 함께 언급했어요")).toBe(true);
    expect(repeatsClaim("교통 물가는 전년 동월 대비 6.80% 올랐고, 총지수 상승에 대한 근사 기여도는 0.75%p예요.", "교통 물가 상승이 전년 동월 대비 총지수 상승에 가장 크게 기여했어요.")).toBe(false);
    expect(repeatsClaim("한국은행은 2026-10-22 통화정책방향에서 물가·금융안정 위험과 불확실성을 동결 이유로 들었어요.", "한국은행은 물가의 높은 오름세와 금융안정 위험, 불확실성 때문에 금리를 유지했어요.")).toBe(false);
    expect(repeatsClaim("", "아무 문장")).toBe(true);
    // Codex 리뷰: 숫자는 글자 일부가 아니라 낱말 전체로 ('2%p' 는 '5.25%' 안의 '2' 가 아님)
    expect(repeatsClaim("미국 금리는 한국 금리보다 2%p 높아요.", "미국 금리는 5.25%, 한국 금리는 3.25%예요.")).toBe(false);
    expect(repeatsClaim("환율은 1.36% 올라 평소 범위 안이에요.", "환율이 1.36% 올랐지만 평소 범위 안의 움직임이에요.")).toBe(true);
  });

  it("원인이 있으면 요약 문단은 한입 요약 안에 접고, 원인이 없으면 그대로 보인다", () => {
    const report = fixture();
    expect(render(report)(".hero-more")).toHaveLength(1);
    report.why = [];
    const $ = render(report);
    expect($(".hero-more")).toHaveLength(0);
    expect($(".report").text().split(report.summary)).toHaveLength(2);
  });

  it("한입 요약은 '나에게' 줄 대신 아래로 이끄는 한 줄로 끝나고, 머핀 그림에 반짝이를 둔다 (11/25 사용자)", () => {
    const $ = render(fixture());
    expect($("[data-quick=summary]").text()).not.toContain("나에게");
    expect($("[class*=heroNudge]").text()).toContain("자세한 내용은 아래에서 확인해 봐요");
    expect($("[class*=heroArt] [class*=sparkle]")).toHaveLength(3);
    expect($(".hero-more > summary").text()).toBe("요약 펼쳐 보기");
  });

  it("굵은 문장을 되풀이하는 설명은 빼고, 등급 설명 문장은 '근거 부족' 에만 남긴다", () => {
    const report = fixture();
    report.why = [
      { ...report.why[0], basis: "news", claim: "데일리안 제목은 미국 기술주 투매와 원·달러 환율의 소폭 상승을 함께 언급했어요", evidence: "데일리안 기사 제목에서 미국 기술주 투매와 환율 상승을 함께 다뤘어요." },
      { ...report.why[0], basis: "data", claim: "교통 물가가 가장 크게 올랐어요", evidence: "2026년 10월 교통 기여도는 0.8%p 였어요" },
      { ...report.why[0], basis: "none", claim: "수요 회복이 이어졌을 수 있어요", evidence: "" },
    ];
    const $ = render(report);
    const items = $(".why-list > li");
    expect(items.eq(0).find("p").text()).not.toContain("함께 다뤘어요");
    expect(items.eq(1).text()).toContain("기여도는 0.8%p");
    expect(items.eq(0).find(".basis-explanation").text().trim()).toBe("보도 기반");
    expect(items.eq(1).find(".basis-explanation").text().trim()).toBe("데이터 인용");
    expect(items.eq(2).find(".basis-explanation").text()).toContain("AI 해석이에요");
    expect(items.eq(1).find(".report-badge").attr("title")).toBe("공개된 데이터를 바탕으로 설명해요");
  });

  it("차트 아래 설명 문단 대신 평소 범위 막대로 안 · 위 · 아래를 보이고, 띠에 이름을 쓴다", async () => {
    const $ = render(fixture());
    expect($(".chart-context")).toHaveLength(0);
    expect($(".chart-range-verdict").text()).toMatch(/평소 범위/);
    expect($(".chart-band-label").text()).toBe("평소 범위");
    const { RangeBar } = await import("./ReportChart");
    const band = { from: "2026-10-24", to: "2026-11-23", low: 1320, high: 1355, label: "평소 폭 ±1.63% (직전 90일 기준)" };
    const bar = (value: number) => load(renderToStaticMarkup(<RangeBar band={band} value={value} valueText={v => v.toLocaleString("ko-KR")} />));
    expect(bar(1343)(".chart-range").attr("data-where")).toBe("in");
    expect(bar(1343)(".chart-range-verdict").text()).toBe("평소 범위 안이에요");
    expect(bar(1343)(".chart-range-now").text()).toBe("지금 1,343");
    expect(bar(1370)(".chart-range-verdict").text()).toBe("평소 범위보다 높아요");
    expect(bar(1300)(".chart-range-verdict").text()).toBe("평소 범위보다 낮아요");
    expect(bar(1343)(".chart-range-note").text()).toBe(band.label);
  });
});

describe("11/25 리포트 끝 정리 (사용자: 아래쪽 가독성)", () => {
  it("안내문은 '투자 권유' 문장 앞에서 두 줄로 나누되 글은 그대로다", async () => {
    const { disclosureLines } = await import("./ReportView");
    const text = "이 리포트는 생성형 AI 머핀이 여러 자료를 바탕으로 작성했으며, 내용에 오류나 누락이 있을 수 있어요. 출처와 기준일, 확인하지 못한 내용을 함께 살펴봐 주세요. 투자 권유가 아닌 참고용 정보이므로, 실제 투자 결정은 본인의 투자 목적과 위험 감수 수준을 충분히 고려해 신중하게 내려주세요.";
    expect(disclosureLines(text)).toEqual([text.slice(0, text.indexOf("투자 권유")).trim(), text.slice(text.indexOf("투자 권유"))]);
    expect(disclosureLines("예전 고지 한 줄")).toEqual(["예전 고지 한 줄"]);
    const report = fixture();
    report.disclosure = text;
    const $ = render(report);
    expect($(".report-disclosure > span")).toHaveLength(2);
    expect($(".report-disclosure").text()).toBe(text);
  });

  it("검증 한 줄은 0개 항목을 빼고 권유 표현은 '없음' 으로 쓴다", async () => {
    const { verificationLine } = await import("./ReportEvidence");
    const v = { ...fixture().verification, advice: 0, numbers: { total: 1, verified: 1, derived: 0, reported: 0, unverified: 0 } };
    expect(verificationLine(v)).toBe("숫자 1개 중 값 대조 1개 · 권유 표현 없음");
    expect(verificationLine({ ...v, advice: 2, numbers: { total: 3, verified: 1, derived: 2, reported: 0, unverified: 0 } })).toBe("숫자 3개 중 값 대조 1개 · 계산값 2개 · 권유 표현 2건 정리");
  });

  it("주의점 칸은 개수 줄 없이 있는 것만 제목으로, 안쪽 제목은 둘 이상일 때만", () => {
    const report = fixture();
    report.caveats = ["환율은 일별 기준값이에요."];
    report.dataGaps = [];
    let $ = render(report);
    expect($("details.reference-toggle > summary").text().trim()).toBe("i 주의점");
    // 사용자 화면에서 숨기는 '검사 후 제외한 항목'(verification-only) 은 빼고 봅니다
    const userHeadings = () => $("details.reference-toggle .verification-body h2").filter((_, el) => $(el).closest(".verification-only").length === 0);
    expect(userHeadings()).toHaveLength(0);
    report.dataGaps = ["미국 금리"];
    $ = render(report);
    expect($("details.reference-toggle > summary").text()).toContain("주의점 · 확인하지 못한 것");
    expect(userHeadings().map((_, el) => $(el).text()).get()).toEqual(["주의점", "확인하지 못한 것"]);
  });

  it("작성일은 '(한국 시간)' · 초 없이, 이어서 알아볼까요 카드는 화살표만", () => {
    const $ = load(renderToStaticMarkup(<ReportView report={fixture()} question="요즘 환율 왜 이래?" createdAt="2026-11-25T02:06:55Z" />));
    const created = $(".report-created-at").text();
    expect(created).not.toContain("한국 시간");
    expect(created).not.toContain(":55");
    expect(created).toContain("11:06");
    expect($.text()).not.toContain("머핀랩과 더 알아보기");
  });
});
