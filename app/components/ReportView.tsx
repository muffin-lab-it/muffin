import Image from "next/image";
import Link from "next/link";
import styles from "./ReportView.module.css";
import type { ToolStep } from "@/src/agent/context";
import { labelFor } from "@/src/agent/events";
import { formatAge } from "@/src/lib/age";
import type { Area, Report } from "@/src/agent/schema";
import { ReportChart } from "./ReportChart";
import { ReportEvidenceScope, ReasonEvidenceLink, ReasonEvidenceTarget, ReportSectionLink, ReportSectionTarget } from "./ReportEvidenceScope";
import { EvidenceRecord, EvidenceReference, ReportReadingNotice, ReportVerification, SourceLink } from "./ReportEvidence";

export const areaLabels: Record<Area, string> = {
  fx: "환율",
  etf: "ETF",
  news: "경제뉴스",
  rate: "금리",
  macro: "물가",
};

/** change 문자열에서 방향을 읽어 색을 정합니다. "-3.61%" → down, "+0.43%" → up */
function direction(change: string): "up" | "down" | "flat" {
  if (/[-−]\s*\d/.test(change)) return "down";
  if (/[+▲]\s*\d/.test(change)) return "up";
  return "flat";
}

/**
 * 리포트 한 장. 홈과 리포트 상세가 같이 씁니다.
 * 프론트 팀은 이 컴포넌트를 기준으로 디자인을 올리면 됩니다. 데이터 모양은 src/agent/schema.ts.
 */
export function ReportView({ report, steps, area, question }: { report: Report; steps?: ToolStep[]; area?: Area; question?: string }) {
  const checkLabels = { verified: "값 대조", derived: "계산값", reported: "기사 보도", unverified: "미검증" };
  const basisLabels = { data: "데이터 인용", news: "보도 기반", none: "근거 부족" };
  return (
    <ReportEvidenceScope>
    <div className={`report ${styles.report}`}>
      {question && (
        <section className={styles.questionCard} aria-label="나의 질문">
          <h2>나의 질문</h2>
          <blockquote>{question}</blockquote>
        </section>
      )}
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h2>한입 요약</h2>
          <h3 className={styles.headlinePlaceholder}>핵심을 한 문장으로 정리할 자리예요.</h3>
          <p className={styles.summaryBody}>{report.summary}</p>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <Image src="/report-v3/mascot.webp" alt="" fill unoptimized />
        </div>
      </section>
      <ReportReadingNotice report={report} />

      <section className={styles.metrics}>
        <h2>오늘의 숫자</h2>
        <div className="numbers">
          {report.numbers.map((n, i) => {
            const check = report.verification.status === "skipped" ? "unverified" : n.check;
            return (
              <div className="num" key={i}>
                <small>{n.label}</small>
                <EvidenceReference evidenceId={n.ref} evidence={report.evidence} label={`${n.label} ${n.value}의 원본 데이터 보기`}><b>{n.value}</b></EvidenceReference>
                {n.change && <i className={direction(n.change)}>{n.change}</i>}
                <div className={styles.metricMeta}>
                  <span className={styles.metricDate}>기준일 <strong>{n.asOf || "미제공"}</strong></span>
                  <span className={`report-badge check-${check}`}>{checkLabels[check]}</span>
                </div>
              </div>
            );
          })}
        </div>
        {report.numbers.length > 0 && <p className={styles.sectionHint}>밑줄이 있는 숫자를 누르면 원본 데이터와 출처를 볼 수 있어요. 기준일은 자료마다 달라요.</p>}
        {report.numbers.length === 0 && <p className="report-muted">표시할 숫자를 확보하지 못했습니다.</p>}
      </section>

      <div className={styles.columns}>
          {(report.caveats.length > 0 || report.dataGaps.length > 0) && (
            <section className={`fine ${styles.readingNotes}`} aria-label="읽기 전에 알아둘 점">
              <h2>읽기 전에 알아둘 점</h2>
              {report.caveats.length > 0 && <ul>{report.caveats.map((item, i) => <li key={i}>{item}</li>)}</ul>}
              {report.dataGaps.length > 0 && (
                <>
                  <h3>자료가 부족한 부분</h3>
                  <ul>{report.dataGaps.map((item, i) => <li key={i}>{item}</li>)}</ul>
                </>
              )}
            </section>
          )}

        <div className={styles.story}>
          <section>
            <h2>변화의 배경</h2>
            {report.why.length === 0 ? (
              <p className="muted">이 질문의 원인을 설명할 데이터가 아직 없습니다.</p>
            ) : (
              <ul>
                {report.why.map((w, i) => (
                  <li key={i}>
                    <span className={`report-badge basis-${w.basis}`}>{basisLabels[w.basis]}</span>{" "}
                    <ReasonEvidenceLink index={i}>{w.claim}</ReasonEvidenceLink>
                  </li>
                ))}
              </ul>
            )}
            {report.why.length > 0 && <p className={styles.sectionHint}>밑줄이 있는 설명을 누르면 참고한 근거를 읽을 수 있어요.</p>}
          </section>

          <section>
            <h2>내 생활에 미치는 영향</h2>
            <ul>{report.impact.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </section>

          {report.charts && report.charts.length > 0 && (
            <section>
              <h2>숫자의 변화 추이</h2>
              {report.charts.map((c, i) => (
                <ReportChart key={i} chart={c} evidence={report.evidence} />
              ))}
            </section>
          )}
        </div>
        <aside className={styles.aside} aria-label="출처와 참고 사항">
          <section>
            <details className={styles.sourceList}>
              <summary>출처와 근거 ({report.sources.length})</summary>
              <ReportSectionTarget name="sources">
                <p className={styles.sectionHint}>설명을 이해하고 → 데이터를 비교하고 → 원문에서 맥락을 확인해 보세요.</p>
                <nav className={styles.sourceIndex} aria-label="자료 읽는 순서">
                  <ReportSectionLink name="reasons" label="1 설명 이해하기" />
                  <ReportSectionLink name="data" label="2 데이터 비교하기" />
                  <ReportSectionLink name="originals" label="3 원문 읽기" />
                </nav>
              </ReportSectionTarget>
              {report.why.length > 0 ? (
                <div className={styles.reasonEvidence}>
                  <ReportSectionTarget name="reasons"><h3>1. 설명 이해하기</h3></ReportSectionTarget>
                  <p className="report-muted">아래는 각 설명에 참고한 내용이에요. 자료를 인용했다는 사실만으로 원인 관계가 확정되는 것은 아니에요.</p>
                  {report.why.map((reason, i) => (
                    <ReasonEvidenceTarget key={i} index={i}>
                      <p><b>{reason.claim}</b></p>
                      <p>{reason.evidence}</p>
                      {reason.refs.map((ref, index) => (
                        <EvidenceReference key={`${ref}-${index}`} evidenceId={ref} evidence={report.evidence} label={`${report.evidence.find((entry) => entry.id === ref)?.label ?? "자료"} · 원본 확인 →`} />
                      ))}
                      {reason.refs.length === 0 && <p className="evidence-missing">인용한 근거 번호가 없습니다.</p>}
                    </ReasonEvidenceTarget>
                  ))}
                </div>
              ) : <ReportSectionTarget name="reasons"><h3>1. 설명 이해하기</h3><p className="report-muted">확보한 설명이 없습니다.</p></ReportSectionTarget>}
              <ReportSectionTarget name="data"><h3>2. 데이터 비교하기</h3><p className={styles.sectionHint}>항목명·값·기준일을 함께 보세요. 서로 다른 시점의 자료일 수 있어요.</p></ReportSectionTarget>
              {report.evidence.map((entry) => <EvidenceRecord key={entry.id} entry={entry} evidence={report.evidence} />)}
              {report.evidence.length === 0 && <p className="report-muted">공개된 원본 데이터가 없습니다.</p>}
              <ReportSectionTarget name="originals"><h3>3. 원문 읽기</h3><p className={styles.sectionHint}>제목을 누르면 원문이 새 탭으로 열려요. 발행일과 지표의 정의를 함께 확인해 보세요.</p>
              <ul>
                {report.sources.map((s, i) => (
                  <li key={i}>
                    <SourceLink url={s.url} name={s.name} /> · {s.asOf || "기준일 미제공"}
                  </li>
                ))}
              </ul>
              {report.sources.length === 0 && <p className="report-muted">확보한 출처가 없습니다.</p>}
              </ReportSectionTarget>
            </details>
          </section>

          {report.nextTopics.length > 0 && <section className={styles.nextTopics}>
            <h2>이어서 알아볼까요?</h2>
            <p className={styles.sectionHint}>궁금한 주제를 고르면 새 질문으로 이어져요. 질문을 확인한 뒤 리포트를 만들어 보세요.</p>
            <div>{report.nextTopics.map((t, i) => <Link key={i} href={`/?question=${encodeURIComponent(t)}${area ? `&area=${area}` : ""}`} className={styles.topicLink}>{t}<span aria-hidden="true">→</span></Link>)}</div>
          </section>}

          <details className={styles.technicalDetails}>
            <summary>리포트 상세 정보 <span>검사 내역·제외 항목·자료 조회 기록</span></summary>
            <p className={styles.sectionHint}>검사 결과 → 제외·조정 내역 → 자료 조회 기록 순서로 살펴보세요. 자동 검사 기록이며, 리포트 전체의 정확성을 보증하지는 않아요.</p>
            <ReportSectionTarget name="verification"><ReportVerification report={report} /></ReportSectionTarget>
              <section className="fine">
                <h2>2. 검사 후 제외한 항목</h2>
                <p className={styles.sectionHint}>출처와 맞지 않거나 표현을 조정해야 해서 처리한 내역이에요. 아래 사유를 확인해 주세요.</p>
                {report.verification.removed.length > 0 ? <ul>{report.verification.removed.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="report-muted">기록된 제외·조정 항목이 없습니다.</p>}
              </section>
              <section className="fine">
                <h2>3. 자료 조회 기록</h2>
                <p className={styles.sectionHint}>조회 성공·실패와 저장된 응답 사용 여부예요. 조회 성공이 자료의 최신성을 뜻하지는 않아요.</p>
                {steps && steps.length > 0 ? <ul>
                  {steps.map((s, i) => (
                    <li key={i}>
                      {s.status === "ok" ? (s.fallbackAgeMs === undefined ? "✅" : "🟡") : "❌"} {labelFor(s.tool)} · {s.ms}ms
                      {s.fallbackAgeMs !== undefined ? ` · 저장된 응답(${formatAge(s.fallbackAgeMs)} 전)` : ""}
                      {s.breaker === "open" ? " · 회로 열림(호출 생략)" : ""}
                      {s.error ? ` · ${s.error}` : ""}
                    </li>
                  ))}
                </ul> : <p className="report-muted">이 리포트에 저장된 조회 기록이 없습니다.</p>}
              </section>
          </details>
        </aside>
      </div>

      <p className="report-disclosure">{report.disclosure}</p>
    </div>
    </ReportEvidenceScope>
  );
}
