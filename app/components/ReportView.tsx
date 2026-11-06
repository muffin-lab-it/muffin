import Image from "next/image";
import styles from "./ReportView.module.css";
import type { ToolStep } from "@/src/agent/context";
import { labelFor } from "@/src/agent/events";
import { formatAge } from "@/src/lib/age";
import type { Area, Report } from "@/src/agent/schema";
import { ReportChart } from "./ReportChart";
import { ReportEvidenceScope } from "./ReportEvidenceScope";
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
                <b>{n.value}</b>
                {n.change && <i className={direction(n.change)}>{n.change}</i>}
                <div className={styles.metricMeta}>
                  <span className={`report-badge check-${check}`}>{checkLabels[check]}</span>
                  {n.asOf && <span className={styles.metricDate}>{n.asOf}</span>}
                </div>
                <EvidenceReference evidenceId={n.ref} evidence={report.evidence} />
              </div>
            );
          })}
        </div>
        {report.numbers.length === 0 && <p className="report-muted">표시할 숫자를 확보하지 못했습니다.</p>}
      </section>

      <div className={styles.columns}>
        <div className={styles.story}>
          <section>
            <h2>왜 그럴까요?</h2>
            {report.why.length === 0 ? (
              <p className="muted">이 질문의 원인을 설명할 데이터가 아직 없습니다.</p>
            ) : (
              <ul>
                {report.why.map((w, i) => (
                  <li key={i}>
                    <span className={`report-badge basis-${w.basis}`}>{basisLabels[w.basis]}</span>{" "}
                    {w.claim}
                    <div className={styles.reasonRefs}>
                      {w.refs.length === 0 ? (
                        <p className="evidence-missing">인용한 근거 번호가 없습니다.</p>
                      ) : w.refs.map((ref, index) => (
                        <EvidenceReference key={`${ref}-${index}`} evidenceId={ref} evidence={report.evidence} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>{area ? `내가 선택한 ${areaLabels[area]}에 무슨 영향인가요?` : "나에게 미치는 영향"}</h2>
            <ul>{report.impact.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </section>

          {report.charts && report.charts.length > 0 && (
            <section>
              <h2>최근 흐름</h2>
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
              <ul>
                {report.sources.map((s, i) => (
                  <li key={i}>
                    <SourceLink url={s.url} name={s.name} /> · {s.asOf || "기준일 미제공"}
                  </li>
                ))}
              </ul>
              {report.sources.length === 0 && <p className="report-muted">확보한 출처가 없습니다.</p>}
              {report.why.length > 0 && (
                <div className={styles.reasonEvidence}>
                  <h3>설명의 근거</h3>
                  {report.why.map((reason, i) => (
                    <div key={i}>
                      <p><b>{reason.claim}</b></p>
                      <p>{reason.evidence}</p>
                      {reason.refs.length === 0 && <p className="evidence-missing">인용한 근거 번호가 없습니다.</p>}
                    </div>
                  ))}
                </div>
              )}
              {report.evidence.map((entry) => <EvidenceRecord key={entry.id} entry={entry} evidence={report.evidence} />)}
            </details>
          </section>

          <section>
            <h2>더해볼 것</h2>
            <div className="chips">{report.nextTopics.map((t, i) => <span className="chip-static" key={i}>{t}</span>)}</div>
          </section>

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
          <details className={styles.technicalDetails}>
            <summary>리포트 상세 정보 <span>검사 내역·제외 항목·자료 조회 기록</span></summary>
            <ReportVerification report={report} />
            {report.verification.removed.length > 0 && (
              <section className="fine">
                <h2>검사 후 제외한 항목</h2>
                <ul>{report.verification.removed.map((item, i) => <li key={i}>{item}</li>)}</ul>
              </section>
            )}
            {steps && steps.length > 0 && (
              <section className="fine">
                <h2>사용한 Tool</h2>
                <ul>
                  {steps.map((s, i) => (
                    <li key={i}>
                      {s.status === "ok" ? (s.fallbackAgeMs === undefined ? "✅" : "🟡") : "❌"} {labelFor(s.tool)} · {s.ms}ms
                      {s.fallbackAgeMs !== undefined ? ` · 저장된 응답(${formatAge(s.fallbackAgeMs)} 전)` : ""}
                      {s.breaker === "open" ? " · 회로 열림(호출 생략)" : ""}
                      {s.error ? ` · ${s.error}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </details>
        </aside>
      </div>

      <p className="report-disclosure">{report.disclosure}</p>
    </div>
    </ReportEvidenceScope>
  );
}
