/// <reference types="next/image-types/global" />
import type { ReactNode } from "react";
import { evidenceCategory } from "./reportCategory";
import { reportChange } from "./reportChange";
import Image from "next/image";
import resultMuffin from "../result-muffin.png";
import { labelFor } from "@/src/agent/events";
import { formatAge } from "@/src/lib/age";
import { ReportDisplay, ReportModeToggle } from "./ReportDisplay";
import { ReportHelp } from "./ReportHelp";
import { ReportSources } from "./ReportSources";
import Link from "next/link";
import styles from "./ReportView.module.css";
import type { ToolStep } from "@/src/agent/context";
import type { Area, Report } from "@/src/agent/schema";
import { ReportChart } from "./ReportChart";
import { ReportEvidenceScope, ReasonEvidenceLink, ReportSectionTarget } from "./ReportEvidenceScope";
import { EvidenceReference, ReportVerification } from "./ReportEvidence";

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
  impactTitles?: string[];
  topicReasons?: string[];
  headline?: string;
  steps?: ToolStep[];
  area?: Area;
  question?: string;
};

export function ReportView({
  report,
  steps,
  area,
  question,
  headline = report.headline ?? undefined,
  impactTitles = report.impactTitles ?? [],
  topicReasons = report.topicReasons ?? [],
  header,
}: ReportViewProps) {
  const basisLabels = { data: "공개된 데이터를 바탕으로 설명해요", news: "기사 내용을 바탕으로 안내해요", none: "직접 뒷받침하는 자료가 없는 머핀랩의 AI 해석이에요" };
  const tags = { data: "데이터 인용", news: "보도 기반", none: "근거 부족" };
  const category = (ref: string | null) => { const entry = report.evidence.find(e => e.id === ref); return entry ? evidenceCategory(entry) : "자료"; };
  const groups = [...new Set(report.numbers.map(n => category(n.ref)))];
  return (
    <ReportEvidenceScope>
    <ReportDisplay className={`report ${styles.report}`}>
      <div className="report-top-controls"><ReportModeToggle /></div>
      {header ?? <div className={styles.reportToolbar}><ReportHelp /></div>}
      <p className="report-ai-intro">생성형 AI 머핀이 작성한 리포트예요. 투자 권유가 아닌 참고용 정보이며, 출처와 기준일을 함께 확인해 주세요.</p>
      {report.notice && report.mode !== "research" && <p className="report-notice">{report.notice}</p>}
      {question && (
        <section className={styles.questionCard} aria-label="나의 질문">
          <h2>나의 질문</h2>
          <blockquote>{question}</blockquote>
        </section>
      )}
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h2>갓 구운 한입 요약</h2>
          {headline && <h3 className={styles.headlinePlaceholder}>{headline}</h3>}
          <p className={styles.summaryBody}>{report.summary}</p>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <Image src={resultMuffin} alt="" fill sizes="(max-width: 600px) 120px, 176px" />
        </div>
      </section>

      <ReportVerification report={report}>
        {report.notice && report.mode === "research" && <section className="verification-context"><h2>움직임 비교 · 참고 정보</h2><p className="report-notice">{report.notice}</p></section>}

      </ReportVerification>

      <section className={styles.metrics}>
        <div className="metrics-heading"><h2>오늘의 숫자</h2>{groups.map(group => <span className="category-chip mini" data-category={group} key={group}>{group}</span>)}<div className="numbers-help"><ReportHelp numbers /></div></div><div className="metrics-guide"><p className="section-guide">질문과 관련된 수치를 변화량·기준일과 함께 비교해 보세요.</p></div>
        <div className="numbers">
          {report.numbers.map((n, i) => {
            const change = n.change && !/^이번\s*주$/.test(n.change.trim())
              ? reportChange(n.change, n.changeDetail)
              : null;
            const check = report.verification.status === "skipped" ? "unverified" : n.check;
            return (
              <div className="num" key={i}>
                <div className="metric-label"><span className="category-chip" data-category={category(n.ref)}>{category(n.ref)}</span><small>{n.label}</small></div>
                <EvidenceReference evidenceId={n.ref} evidence={report.evidence} label={`${n.label} ${n.value}의 원본 데이터 보기`}><b>{n.value}</b></EvidenceReference>
                {change && <i className={change.direction}>{change.text}</i>}
                {n.changeDetail && (n.changeDetail.from || n.changeDetail.to) && <small className="metric-period">비교 기간 {n.changeDetail.from ?? "시작일 미제공"} → {n.changeDetail.to ?? "종료일 미제공"}</small>}
                <div className={styles.metricMeta}>
                  <span className={styles.metricDate}>{n.asOf ? `기준일 ${n.asOf}` : "자료 날짜 미제공"}</span>
                  <span className={`report-badge check-${check}`}>{{ verified: "값 대조", derived: "계산값", reported: "기사 보도", unverified: "원문 미대조" }[check]}</span>
                </div>
              </div>
            );
          })}
        </div>

        {report.numbers.length === 0 && <p className="report-muted">표시할 숫자를 확보하지 못했습니다.</p>}
      </section>

      <div className={styles.columns}>
        <div className={styles.story}>
          <section>
            <h2>숫자 너머의 이야기</h2><p className="section-guide">지금의 수치가 나온 배경을 읽고, 설명 옆 배지로 근거의 종류를 확인해 보세요.</p>
            {report.why.length === 0 ? (
              <p className="muted">이 질문의 원인을 설명할 데이터가 아직 없습니다.</p>
            ) : (
              <ul>
                {report.why.map((w, i) => (
                  <li key={i}>
                    <span className="basis-explanation"><strong className={`report-badge basis-${w.basis}`}>{tags[w.basis]}</strong> {basisLabels[w.basis]}</span>{" "}
                    {w.refs.some(ref => report.evidence.some(entry => entry.id === ref)) ? <ReasonEvidenceLink index={i}>{w.claim}</ReasonEvidenceLink> : <span>{w.claim}</span>}
                    <div className="reason-originals">{w.refs.map((ref, index) => <EvidenceReference key={`${ref}-${index}`} evidenceId={ref} evidence={report.evidence} label={`원본 보기 · ${ref}`}><span>▸ 원본 보기 · {ref}</span></EvidenceReference>)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>내 생활에 미치는 영향</h2><p className="section-guide">내 소비와 자산에 해당하는 카드를 골라, 어떤 영향을 받을 수 있는지 살펴보세요.</p>
            <div className="impact-grid">{report.impact.map((w, i) => <article className="impact-card" key={i}>{impactTitles[i] && <h3><span aria-hidden="true">{/여행|해외/.test(impactTitles[i]) ? "✈️" : /자산|보유/.test(impactTitles[i]) ? "💰" : /상품|비교/.test(impactTitles[i]) ? "🔎" : /예금|적금/.test(impactTitles[i]) ? "🏦" : /물가|장보기/.test(impactTitles[i]) ? "🛒" : /뉴스/.test(impactTitles[i]) ? "📰" : "💡"}</span> {impactTitles[i]}</h3>}<p>{w}</p></article>)}</div>
          </section>

          {report.charts && report.charts.length > 0 && (
            <section>
              <h2>숫자의 변화 추이</h2><p className="section-guide">날짜에 따른 수치의 흐름을 보고, 아래 요약에서 얼마나 달라졌는지 확인해 보세요.</p>
              {report.charts.map((c, i) => (
                <ReportChart key={i} chart={c} evidence={report.evidence} />
              ))}
            </section>
          )}
        </div>
      </div>

      <ReportSources report={report} />

      {report.nextTopics.length > 0 && <section className={styles.nextTopics}>
        <h2>이어서 알아볼까요?</h2><p className="section-guide">머핀랩이 추천하는 연관 지식이에요. 주제를 고르면 질문이 채워져요.</p>
        <div className={styles.topicGrid}>{report.nextTopics.map((topic, i) => <Link key={i} href={`/?question=${encodeURIComponent(topic)}${area ? `&area=${area}` : ""}`} className={styles.topicLink}><span><strong>{topic}</strong>{topicReasons[i] && <small>{topicReasons[i]}</small>}</span><span className="topic-action"><em>머핀랩과 더 알아보기</em><span aria-hidden="true">→</span></span></Link>)}</div>
      </section>}

      {(report.caveats.length > 0 || report.dataGaps.length > 0 || report.verification.removed.length > 0 || !!steps?.length) && <section className="report-verification report-reference" data-user-empty={report.caveats.length === 0 && report.dataGaps.length === 0 ? "true" : undefined} aria-label="주의점과 자료 범위">
        <details className="verification-toggle reference-toggle">
          <summary>
            <span className="verification-summary-copy"><strong><span className="verification-icon" aria-hidden="true">i</span> 주의점과 확인하지 못한 것</strong><span>주의점 {report.caveats.length}개 · 확인하지 못한 것 {report.dataGaps.length}개<span className="verification-only"> · 제외 {report.verification.removed.length}개</span></span></span>
            <span className="verification-summary-action"><span className="verification-toggle-label">상세 보기</span><span className="verification-chevron" aria-hidden="true">⌄</span></span>
          </summary>
          <div className="verification-body" aria-label="자료 범위">
            {report.caveats.length > 0 && <section><h2>주의점</h2><ul>{report.caveats.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}
            {report.dataGaps.length > 0 && <section><h2>확인하지 못한 것</h2><ul>{report.dataGaps.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}
        {report.verification.removed.length > 0 && <section className="verification-only"><ReportSectionTarget name="removed"><h2>검사 후 제외한 항목</h2><ul>{report.verification.removed.map((item, i) => <li key={i}>{item}</li>)}</ul></ReportSectionTarget></section>}

        {!!steps?.length && <section className="report-tools"><h2>사용한 Tool</h2>
          <div className="tool-table-scroll" role="region" aria-label="도구 실행 내역" tabIndex={0}>
            <table className="tool-table">
              <caption className="tool-table-caption">리포트 작성에 사용한 도구와 실행 결과</caption>
              <thead><tr><th scope="col">도구</th><th scope="col">상태</th><th scope="col">소요 시간</th><th scope="col">비고</th></tr></thead>
              <tbody>{steps.map((step, i) => <tr key={i}>
                <th scope="row">{labelFor(step.tool)}</th>
                <td><span className="tool-status" data-status={step.status === "error" ? "error" : step.fallbackAgeMs !== undefined ? "cached" : "ok"}>{step.status === "ok" ? (step.fallbackAgeMs === undefined ? "✅ 완료" : "🟡 저장된 응답") : "❌ 실패"}</span></td>
                <td className="tool-duration">{step.ms}ms</td>
                <td>{step.fallbackAgeMs !== undefined && <div>{`저장된 응답(${formatAge(step.fallbackAgeMs)} 전)`}</div>}{step.breaker === "open" && <div>회로 열림(호출 생략)</div>}{step.error && <div>{step.error}</div>}{step.fallbackAgeMs === undefined && step.breaker !== "open" && !step.error && "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>}
          </div>
        </details>
      </section>}

      <p className="report-disclosure">{report.disclosure}</p>
    </ReportDisplay>
    </ReportEvidenceScope>
  );
}
