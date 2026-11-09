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
    expect(panel.find("a")).toHaveLength(0);
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
  it("자료의 해석에 영향을 주는 범위와 부족한 자료는 접지 않고 표시한다", () => {
    const report = fixture();
    const $ = render(report);
    const notes = $('[aria-label="자료 범위"]');
    expect(notes.parents("details")).toHaveLength(0);
    for (const text of [...report.caveats, ...report.dataGaps]) expect(notes.text()).toContain(text);
    expect($(".report-disclosure").text()).toContain("머핀랩은 AI 에이전트");
    expect($(".report-disclosure").text()).toContain("투자 결정은 신중하게");
    expect($(".report details")).toHaveLength(0);
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
  it("검사 집계·재작성 횟수는 제거하고 필요한 조정 내역은 보존한다", () => {
    const $ = render(fixture());
    expect($(".verification-detail, .verification-stats")).toHaveLength(0);
    expect($(".report").text()).not.toContain("다시 쓰기");
    expect($(".report").text()).not.toContain("권유 표현 패턴 감지");
    expect($(".report-reading-notice, .report-verification")).toHaveLength(0);
    expect($(".num .check-verified, .num .check-derived")).toHaveLength(0);
    expect($(".num .check-reported")).toHaveLength(0);
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
  expect($(".evidence-record .report-hint, .evidence-source, .evidence-id")).toHaveLength(0);
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


it("자료 영역에서는 외부 출처만 링크로 제공한다", () => {
  const $ = render(fixture());
  expect($(".source-library a[href^='#']")).toHaveLength(0);
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
