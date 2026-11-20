import { PrintOpenDetails, ReportResponsiveDetails } from "./ReportResponsiveDetails";
/// <reference types="next/image-types/global" />
import { supportedReportTopics } from "@/src/lib/report-topics";
import type { ReactNode } from "react";
import { reportChange } from "./reportChange";
import Image from "next/image";
import resultMuffin from "../result-muffin.png";
import { labelFor } from "@/src/agent/events";
import { whyEmptyNote } from "@/src/agent/report";
import { formatAge } from "@/src/lib/age";
import { ReportDisplay } from "./ReportDisplay";
import { ReportHelp } from "./ReportHelp";
import { ReportSources } from "./ReportSources";
import Link from "next/link";
import styles from "./ReportView.module.css";
import type { ToolStep } from "@/src/agent/context";
import type { Area, Evidence, Report } from "@/src/agent/schema";
import { ReportChart } from "./ReportChart";
import { ReportEvidenceScope, ReasonEvidenceTarget, ReportSectionLink, ReportSectionTarget } from "./ReportEvidenceScope";
import { EvidenceReference, ReportVerification, SourceLink } from "./ReportEvidence";
import { formatDateKo, fxBasisNote, isNewsEvidence, newsCountLine, publisherOf, valueTone } from "./format";
import { splitAreaPrefix } from "./home-form";

export const areaLabels: Record<Area, string> = {
  fx: "환율",
  etf: "ETF",
  news: "경제뉴스",
  rate: "금리",
  macro: "물가",
};

/**
 * 리포트 한 장. 홈과 리포트 상세가 같이 씁니다.
 * 프론트 팀은 이 컴포넌트를 기준으로 디자인을 올리면 됩니다. 데이터 모양은 src/agent/schema.ts.
 */
type ReportViewProps = {
  report: Report;
  header?: ReactNode;
  actions?: ReactNode;
  createdAt?: string;
  impactTitles?: string[];
  topicReasons?: string[];
  headline?: string;
  steps?: ToolStep[];
  area?: Area;
  question?: string;
};

/** 원인 문장의 근거 링크. 뉴스는 기사로 바로 새 창, 데이터는 아래 출처 칸으로 (11/20 QA 3: "원본 보기" 가 기사인 줄 알았는데 아래로 내려가 두 번 눌러야 했음). */
function ReasonLinks({ refs, evidence }: { refs: string[]; evidence: Evidence[] }) {
  const items = refs.map(ref => ({ ref, entry: evidence.find(item => item.id === ref) }));
  const news = items.filter((item): item is { ref: string; entry: Evidence } => !!item.entry && isNewsEvidence(item.entry));
  const data = items.filter(item => !item.entry || !isNewsEvidence(item.entry));
  if (items.length === 0) return null;
  const article = ({ ref, entry }: { ref: string; entry: Evidence }) => {
    const url = entry.source.pageUrl ?? entry.source.url;
    let relay = false;
    try { relay = new URL(url).hostname === "news.google.com"; } catch { /* SourceLink 가 잘못된 주소를 링크로 만들지 않습니다. */ }
    return <SourceLink key={ref} url={url} name={`${publisherOf(entry)} 기사 보기${relay ? " (Google News)" : ""} ↗`} className="reason-article" />;
  };
  return <div className="reason-originals">
    {news.length === 1 && article(news[0])}
    {news.length >= 2 && <PrintOpenDetails className="reason-news" summary={`기사 ${news.length}건 보기`}><ul>{news.map(item => <li key={item.ref}>{article(item)}</li>)}</ul></PrintOpenDetails>}
    {data.map(item => <EvidenceReference key={item.ref} evidenceId={item.ref} evidence={evidence} label={`출처로 이동 · ${item.ref}`}><span>출처로 이동 ↓ · {item.ref}</span></EvidenceReference>)}
  </div>;
}

export function ReportView({
  report,
  steps,
  area,
  question,
  headline = report.headline ?? undefined,
  impactTitles = report.impactTitles ?? [],
  header,
  actions,
  createdAt,
}: ReportViewProps) {
  const nextTopics = supportedReportTopics(report.nextTopics, area, question);
  const whyNote = report.why.length === 0 ? whyEmptyNote(report) : null;
  // 영역을 여러 개 고르면 화면이 질문 앞에 붙인 "관심 영역: …" 머리말은 떼서 배지로 보여 줍니다 (11/20 외부 G1 · 하니 2)
  const shown = splitAreaPrefix(question ?? "");
  const questionText = question ? shown.question : undefined;
  const areaChips = shown.areas.length > 0 ? <div className="chips report-area-chips">{shown.areas.map(name => <span key={name} className="category-chip" data-category={name === "경제뉴스" ? "뉴스" : name}>{name}</span>)}</div> : null;
  // 관심 영역 · 깊이 배지와 작성일은 질문 바로 아래 한 줄에 (11/20 하니 리뷰: 머리에 모아 두기, 보관함에서 다시 볼 때 날짜가 바로 보이게)
  const metaLine = (header || createdAt || areaChips)
    ? <div className="report-meta-line">{areaChips}{header}{createdAt && <span className="report-created-at">작성일 · <time dateTime={createdAt}>{new Date(createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국 시간)</time></span>}</div>
    : null;
  const newsEntries = report.evidence.filter(isNewsEvidence);
  // 도구 표는 리포트에서 빼고(11/20 QA 7 · 하니 5, 전체 표는 /admin) 저장본 · 실패 · 호출 생략만 주의점 옆에 메모로 남깁니다
  const toolNotes = (steps ?? []).filter(step => step.status === "error" || step.fallbackAgeMs !== undefined || step.breaker === "open");
  const showReference = report.caveats.length > 0 || report.dataGaps.length > 0 || report.verification.removed.length > 0 || toolNotes.length > 0;
  const basisLabels = { data: "공개된 데이터를 바탕으로 설명해요", news: "기사 내용을 바탕으로 안내해요", none: "직접 뒷받침하는 자료가 없는 머핀랩의 AI 해석이에요" };
  const tags = { data: "데이터 인용", news: "보도 기반", none: "근거 부족" };
  return (
    <div className={styles.reportContainer}>
    <ReportEvidenceScope>
    <ReportDisplay className={`report ${styles.report}`}>
      {report.notice && report.mode !== "research" && <p className="report-notice">{report.notice}</p>}
      <header className="report-brand-header"><div><p>갓 구운 오늘의 리포트</p><h1>Today&apos;s Muffin</h1></div>{actions && <div className="report-actions">{actions}</div>}</header>
      {questionText && (
        <section className={styles.questionCard} aria-label="나의 질문">
          <h2>나의 질문</h2>
          <blockquote>{questionText}</blockquote>
          {metaLine}
        </section>
      )}
      {!questionText && metaLine}
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h2>갓 구운 한입 요약</h2>
          {headline && <h3 className={styles.headlinePlaceholder}>{headline}</h3>}
          {!headline && <p className={styles.summaryBody}>{report.summary}</p>}
          {/* 답에 영향을 준 자료 부족은 요약 아래 짧게 (11/20 하니 5) */}
          {report.dataGaps.length > 0 && <p className="hero-gaps"><ReportSectionLink name="gaps" label={`확인하지 못한 자료 ${report.dataGaps.length}개 · 아래 주의점에 적었어요`} /></p>}
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <Image src={resultMuffin} alt="" fill sizes="(max-width: 560px) 64px, 150px" />
        </div>
      </section>

      {report.numbers.length > 0 ? (
      <section className={styles.metrics}>
        <div className="metrics-heading"><h2>오늘의 숫자</h2></div>
        <div className="numbers" data-count={report.numbers.length}>
          {report.numbers.map((n, i) => {
            const change = n.change && !/^이번\s*주$/.test(n.change.trim())
              ? reportChange(n.change, n.changeDetail)
              : null;
            const entry = report.evidence.find(item => item.id === n.ref);
            const source = entry?.source;
            const basis = entry ? fxBasisNote(entry.tool, entry.source.name) : null;
            const check = report.verification.status === "skipped" ? "unverified" : n.check;
            const tone = valueTone(n.value);
            return (
              <div className="num" data-kind={check} key={i}>
                <div className="metric-label"><small>{n.label}</small></div>
                <EvidenceReference evidenceId={n.ref} evidence={report.evidence} label={`${n.label} ${n.value}의 원본 데이터 보기`}><b className={tone ?? undefined}>{n.value}</b></EvidenceReference>
                {change && <i className={change.direction}><span aria-hidden="true">{change.direction === "up" ? "↑ " : change.direction === "down" ? "↓ " : ""}</span>{change.text}</i>}
                {n.changeDetail?.from && n.changeDetail.to && <small className="metric-period">비교 기간 {formatDateKo(n.changeDetail.from)} → {formatDateKo(n.changeDetail.to)}</small>}
                <div className={styles.metricMeta}>
                  <span className={styles.metricDate}>{n.asOf ? `기준일 ${formatDateKo(n.asOf)}` : "자료 날짜 미제공"}</span>
                  {source && <span className="metric-source">{source.name}</span>}
                  {source && <EvidenceReference evidenceId={n.ref} evidence={report.evidence} label={`${n.label} 근거 보기`}><span>근거 보기</span></EvidenceReference>}
                  <span className={`report-badge check-${check}`}>{{ verified: "값 대조", derived: "계산값", reported: "기사 보도", unverified: "원문 미대조" }[check]}</span>
                </div>
                {basis && <small className="metric-basis">{basis}</small>}
              </div>
            );
          })}
        </div>
        <p className="section-guide">질문과 관련된 수치를 변화량·기준일과 함께 비교해 보세요.</p>
        <div className={styles.reportToolbar}><ReportHelp /></div>
      </section>
      ) : newsEntries.length > 0 ? (
      /* 기사로만 만든 리포트는 숫자 칸 대신 확인한 기사 수를 보여 줍니다 (11/20 QA 12) */
      <section className={styles.metrics}>
        <div className="metrics-heading"><h2>확인한 기사</h2></div>
        <p className="news-count">{newsCountLine(newsEntries)}</p>
        <p className="section-guide">숫자 자료 없이 기사로 만든 리포트예요. 기사 원문은 아래 출처에서 바로 열 수 있어요.</p>
        <div className={styles.reportToolbar}><ReportHelp /></div>
      </section>
      ) : (
      /* 숫자도 기사도 없으면 "확보하지 못했습니다" 칸을 두지 않고 숨깁니다 (11/20 QA 11) */
      <div className={styles.toolbarRow}><ReportHelp /></div>
      )}

      <div className={styles.columns}>
        <div className={styles.story}>
          {/* 원인을 묻지 않은 질문은 원인이 없어도 빈 칸 안내를 띄우지 않고 칸을 숨깁니다 (11/20 QA) */}
          {(report.why.length > 0 || whyNote) && <section className={styles.why}>
            <h2>숫자 너머의 이야기</h2>
            {report.why.length === 0 ? (
              <p className="why-note">{whyNote}</p>
            ) : (
              <ol className="why-list">
                {report.why.map((w, i) => (
                  <li key={i}>
                    <span className="basis-explanation"><strong className={`report-badge basis-${w.basis}`}>{tags[w.basis]}</strong> {basisLabels[w.basis]}</span>{" "}
                    <ReasonEvidenceTarget index={i}><h3>{w.claim}</h3>{w.evidence && w.evidence !== w.claim && <p>{w.evidence}</p>}</ReasonEvidenceTarget>
                    <ReasonLinks refs={w.refs} evidence={report.evidence} />
                  </li>
                ))}
              </ol>
            )}

          </section>}
      {headline && <p className={styles.summaryBody}>{report.summary}</p>}

          {report.impact.length > 0 && <section>
            <h2>내 생활에 미치는 영향</h2>
            <div className="impact-grid">{report.impact.map((w, i) => <article className="impact-card" key={i}>{impactTitles[i] && <h3><span aria-hidden="true">{/여행|해외/.test(impactTitles[i]) ? "✈️" : /자산|보유/.test(impactTitles[i]) ? "💰" : /상품|비교/.test(impactTitles[i]) ? "🔎" : /예금|적금/.test(impactTitles[i]) ? "🏦" : /물가|장보기/.test(impactTitles[i]) ? "🛒" : /뉴스/.test(impactTitles[i]) ? "📰" : "💡"}</span> {impactTitles[i]}</h3>}<p>{w}</p></article>)}</div>
            <p className="section-guide">내 소비와 자산에 해당하는 카드에서 어떤 영향을 받을 수 있는지 살펴보세요.</p>
          </section>}

          {report.charts && report.charts.length > 0 && (
            <section>
              <h2>숫자의 변화 추이</h2>
              {report.charts.map((c, i) => (
                <ReportChart key={i} chart={c} evidence={report.evidence} />
              ))}
              <p className="section-guide">날짜에 따른 수치의 흐름을 보고, 아래 요약에서 얼마나 달라졌는지 확인해 보세요.</p>
            </section>
          )}
        </div>
      </div>

      {(report.evidence.length > 0 || report.sources.length > 0) && <ReportSources report={report} />}

      <ReportVerification report={report}>
        {report.notice && report.mode === "research" && <section className="verification-context"><h2>움직임 비교 · 참고 정보</h2><p className="report-notice">{report.notice}</p></section>}

      </ReportVerification>

      {showReference && <section className="report-verification report-reference" data-user-empty={report.caveats.length === 0 && report.dataGaps.length === 0 ? "true" : undefined} aria-label="주의점과 자료 범위">
        {/* 주의점 · 확인하지 못한 것은 접지 않고 항상 보여 줍니다 (11/20 하니 리뷰). details 는 제외 항목 링크의 대상 구조를 위해 두고 open 으로 고정 */}
        <details className="verification-toggle reference-toggle" open>
          <summary tabIndex={-1}>
            <span className="verification-summary-copy"><strong><span className="verification-icon" aria-hidden="true">i</span> 주의점과 확인하지 못한 것</strong><span>주의점 {report.caveats.length}개 · 확인하지 못한 것 {report.dataGaps.length}개<span className="verification-only"> · 제외 {report.verification.removed.length}개</span></span></span>
          </summary>
          <div className="verification-body" aria-label="자료 범위">
            {report.caveats.length > 0 && <section><h2>주의점</h2><ul>{report.caveats.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}
            {report.dataGaps.length > 0 && <section><ReportSectionTarget name="gaps"><h2>확인하지 못한 것</h2><ul>{report.dataGaps.map((item, i) => <li key={i}>{item}</li>)}</ul></ReportSectionTarget></section>}
        {report.verification.removed.length > 0 && <section className="verification-only"><ReportSectionTarget name="removed"><h2>검사 후 제외한 항목</h2><ul>{report.verification.removed.map((item, i) => <li key={i}>{item}</li>)}</ul></ReportSectionTarget></section>}

        {toolNotes.length > 0 && <section className="report-tools"><h2>자료 확인 메모</h2>
          <ul>{toolNotes.map((step, i) => <li key={i}>{labelFor(step.tool)}: {step.status === "error"
            ? `확인하지 못했어요${step.error ? ` (${step.error})` : ""}`
            : step.breaker === "open" ? "잠시 호출을 쉬고 있어 이번에는 부르지 않았어요"
            : `${formatAge(step.fallbackAgeMs ?? 0)} 전에 저장해 둔 응답을 썼어요`}</li>)}</ul>
        </section>}
          </div>
        </details>
      </section>}

      {/* 추천은 맨 끝에 두어 검증 · 주의점과 섞이지 않게 (11/20 외부 E2) */}
      {nextTopics.length > 0 && <section className={styles.nextTopics}>
        <ReportResponsiveDetails className="report-fold" summary={<h2>이어서 알아볼까요?</h2>}>
        <div className={styles.topicGrid}>{nextTopics.map((topic, i) => <Link key={i} href={`/?question=${encodeURIComponent(topic.question)}&area=${topic.area}`} className={styles.topicLink}><span><strong>{topic.question}</strong><small>{topic.reason}</small></span><span className="topic-action"><em>머핀랩과 더 알아보기</em><span aria-hidden="true">→</span></span></Link>)}</div>
        <p className="section-guide">머핀랩이 추천하는 연관 지식이에요. 주제를 고르면 질문이 채워져요.</p>
        </ReportResponsiveDetails>
      </section>}

      <p className="report-disclosure">{report.disclosure}</p>
    </ReportDisplay>
    </ReportEvidenceScope>
    </div>
  );
}
