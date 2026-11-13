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
    expect(target.parents("details").attr("open")).toBeUndefined();
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
    expect(panel.find("dd").text()).toBe("1444");
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
    expect($(".check-unverified").text()).toContain("원문 미대조");
    expect($(".check-verified, .check-derived, .num .evidence-detail, .verification-detail")).toHaveLength(0);
    expect($(".num .evidence-missing")).toHaveLength(report.numbers.length);
  });

  it("빈 원본과 계산 계보의 누락된 입력을 숨기지 않는다", () => {
    const report = fixture();
    report.numbers = [{ ...report.numbers[0], ref: "C1", check: "derived" }];
    report.evidence = [{ ...report.evidence[0], id: "C1", values: {}, lineage: { op: "spread", inputs: ["E404"] } }];
    const $ = render(report);
    expect($(".evidence-record").text()).toContain("공개된 원본 값이 없습니다");
    expect($(".evidence-inputs").text()).toContain("연결된 자료 없음");
  });
});

describe("읽기 중심 리포트", () => {
  it("구현 안내 문구 없이 실제 서버 요약을 보존한다", () => {
    const $ = render(fixture());
    expect($(".report").text()).not.toContain("핵심을 한 문장으로 정리할 자리예요.");
    expect($(".report").text()).toContain(fixture().summary);
    expect($(".source-library").parents("aside")).toHaveLength(0);
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
  it("주의점과 부족한 자료는 하단 참고 토글에 원문 그대로 표시한다", () => {
    const report = fixture();
    const $ = render(report);
    const notes = $('[aria-label="자료 범위"]');
    expect(notes.parents(".reference-toggle")).toHaveLength(1);
    expect($(".reference-toggle").attr("open")).toBeUndefined();
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
    expect($(".report-tools").parents(".reference-toggle")).toHaveLength(1);
    expect($('details[aria-label="리포트 상세 정보"]').attr("open")).toBeUndefined();
    expect($(".verification-toggle").attr("open")).toBeUndefined();
    expect($(".report-details")).toHaveLength(0);
    expect(text).toContain("🟡");
    expect(text).toContain("저장된 응답(3시간 전)");
    expect(text).toContain("820ms");
    expect(text).toContain("회로 열림");
    expect(text).toContain("timeout");
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
  it("검증 패널은 숫자 카드 앞에 있고 대조 내역과 도구는 하나의 토글 안에 표시한다", () => {
    const report = fixture();
    report.numbers[0].match = { key: "rate", policy: "rounded" };
    const $ = render(report);
    expect($(".report-details")).toHaveLength(0);
    expect($(".verification-detail").parents(".report-verification")).toHaveLength(1);
    expect($(".report-verification").first().next().find(".numbers")).toHaveLength(1);
    expect($(".report-verification").parents("details")).toHaveLength(0);
    expect($(".verification-toggle").attr("open")).toBeUndefined();
    expect($(".verification-detail").parents(".verification-toggle")).toHaveLength(1);
    expect($(".verification-toggle details")).toHaveLength(0);
    expect($(".verification-detail").text()).toContain("rate 값과 표기 반올림과 일치");
    expect($(".verification-detail").text()).toContain("다시 쓰기");
    expect($(".num .report-badge")).toHaveLength(report.numbers.length);
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
    expect($(".num").first().text()).toContain("기준일 2000-01-01");
    expect($(".num").first().text()).not.toContain("최신");
  });

  it("숫자와 설명 자체가 링크이며 반복 CTA 대신 영역별 안내를 제공한다", () => {
    const report = fixture();
    const $ = render(report);
    expect($(".num .metric-value-link b")).toHaveLength(report.numbers.length);
    expect($(".reason-link")).toHaveLength(report.why.filter(reason => reason.refs.some(ref => report.evidence.some(entry => entry.id === ref))).length);
    expect($(".reason-link").first().text()).toBe(report.why[0].claim);
    expect($(".num").text()).not.toContain("이 숫자의 출처 보기");
    expect($(".report-help-dialog").text()).toContain("숫자나 설명을 누르면");
    expect($(".source-chips button").length).toBeGreaterThan(0);
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
  expect($(".evidence-record .report-hint, .evidence-source")).toHaveLength(0);
  const meta = $(".evidence-meta").first().text();
  expect(meta).toContain(fixture().evidence[0].source.name);
  expect(meta).toContain("기준일 " + fixture().evidence[0].source.asOf);
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
  expect($(".reason-evidence")).toHaveLength(report.why.filter(reason => reason.refs.some(ref => report.evidence.some(entry => entry.id === ref))).length);
  expect($(".reason-evidence").first().parents("[data-source-group]").attr("data-source-group")).toBe("금리");
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
    expect($(link).text().split(" · ")[0]).toBe(record.find(".evidence-id").text());
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
    report.nextTopics.forEach((_, i) => expect($('a[href^="/?question="]').eq(i).find("small").text()).toBe(`연결 이유 ${i}`));
  });
  it("새 필드가 없거나 빈 문자열이면 빈 제목과 이유를 만들지 않는다", () => {
    const report = fixture();
    delete report.headline; delete report.impactTitles; delete report.topicReasons;
    report.numbers.forEach(number => { delete number.changeDetail; });
    const $ = render(report);
    expect($(".impact-card h3, a[href^='/?question='] small, .metric-period")).toHaveLength(0);
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
    expect($(".report-notice").text()).toBe(report.notice);
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
  expect(panel.find(".verification-detail").text()).toContain("rate 값과 정확히 일치");
  expect($(".reference-toggle .report-tools").text()).toContain("🟡");
  expect($(".reference-toggle .report-tools").text()).toContain("저장된 응답(1시간 전)");
  expect($(".reference-toggle .report-tools").text()).toContain("회로 열림(호출 생략)");
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
  expect($(".reason-originals").text()).toContain("원본 보기 · E2");
  expect($(".reason-originals").text()).toContain("원본 보기 · E3");
  expect($(".reason-originals").text()).toContain("원본 보기 · C1");
});

it("원본 자료마다 실제 근거 번호를 표시한다", () => {
  const report = fixture();
  const $ = render(report);
  expect($(".evidence-record .evidence-id").map((_, el) => $(el).text()).get()).toEqual(report.evidence.map(entry => entry.id));
});

it("기본은 검증 ON이며 검증 토글과 필수 고지·원본 탐색을 제공한다", () => {
  const report = fixture();
  const $ = render(report);
  expect($(".report").attr("data-verification")).toBe("on");
  expect($(".report-mode-toggle")).toHaveLength(1);
  expect($(".report-mode-toggle").attr("aria-pressed")).toBe("true");
  expect($(".report-mode-toggle").text()).toContain("검증·근거 보기");
  expect($(".report-disclosure").text()).toContain("생성형 AI");
  expect($(".reference-toggle").text()).toContain(report.caveats[0]);
  expect($(".num .metric-value-link").length).toBeGreaterThan(0);
});

it("도구 기록은 표에서 도구·상태·시간·비고를 구분한다", () => {
  const $ = render(fixture(), [{ tool: "get_fx_krw_rate", status: "ok", ms: 912 }, { tool: "get_rate_data", status: "error", ms: 20, error: "조회 실패" }]);
  expect($(".tool-table thead th").map((_, el) => $(el).text()).get()).toEqual(["도구", "상태", "소요 시간", "비고"]);
  expect($(".tool-table tbody tr")).toHaveLength(2);
  expect($(".tool-table tbody tr").first().find(".tool-duration").text()).toBe("912ms");
  expect($(".tool-table tbody tr").last().text()).toContain("❌ 실패");
  expect($(".tool-table tbody tr").last().text()).toContain("조회 실패");
});
