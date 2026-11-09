import type { ReactNode } from "react";
import { evidenceCategory } from "./reportCategory";
import { reportChange } from "./reportChange";
import Image from "next/image";
import { ReportHelp } from "./ReportHelp";
import { ReportSources } from "./ReportSources";
import Link from "next/link";
import styles from "./ReportView.module.css";
import type { ToolStep } from "@/src/agent/context";
import type { Area, Report } from "@/src/agent/schema";
import { ReportChart } from "./ReportChart";
import { ReportEvidenceScope, ReasonEvidenceLink } from "./ReportEvidenceScope";
import { EvidenceReference } from "./ReportEvidence";

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
export function ReportView({ report, area, question, headline, impactTitles = [], topicReasons = [], header }: { report: Report; header?: ReactNode; impactTitles?: string[]; topicReasons?: string[]; headline?: string; steps?: ToolStep[]; area?: Area; question?: string }) {
  const basisLabels = { data: "공개된 데이터를 바탕으로 설명해요", news: "기사 내용을 바탕으로 안내해요", none: "직접 뒷받침하는 자료가 없는 머핀랩의 AI 해석이에요" };
  const tags = { data: "데이터 인용", news: "보도 기반", none: "근거 부족" };
  const category = (ref: string | null) => { const entry = report.evidence.find(e => e.id === ref); return entry ? evidenceCategory(entry) : "자료"; };
  const groups = [...new Set(report.numbers.map(n => category(n.ref)))];
  return (
    <ReportEvidenceScope>
    <div className={`report ${styles.report}`}>
      {header ?? <div className={styles.reportToolbar}><ReportHelp /></div>}
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
          <Image src="/report-v3/mascot.webp" alt="" fill unoptimized />
        </div>
      </section>

      <section className={styles.metrics}>
        <div className="metrics-heading"><h2>오늘의 숫자</h2>{groups.map(group => <span className="category-chip mini" data-category={group} key={group}>{group}</span>)}<div className="numbers-help"><ReportHelp numbers /></div></div><div className="metrics-guide"><p className="section-guide">질문과 관련된 수치를 변화량·기준일과 함께 비교해 보세요.</p></div>
        <div className="numbers">
          {report.numbers.map((n, i) => {
            const check = report.verification.status === "skipped" ? "unverified" : n.check;
            return (
              <div className="num" key={i}>
                <div className="metric-label"><span className="category-chip" data-category={category(n.ref)}>{category(n.ref)}</span><small>{n.label}</small></div>
                <EvidenceReference evidenceId={n.ref} evidence={report.evidence} label={`${n.label} ${n.value}의 원본 데이터 보기`}><b>{n.value}</b></EvidenceReference>
                {n.change && !/^이번\s*주$/.test(n.change.trim()) && <i className={reportChange(n.change).direction}>{reportChange(n.change).text}</i>}
                <div className={styles.metricMeta}>
                  <span className={styles.metricDate}>{n.asOf ? `기준일 ${n.asOf}` : "자료 날짜 미제공"}</span>
                  {check === "unverified" && <span className="report-badge check-unverified">원문 미대조</span>}
                </div>
              </div>
            );
          })}
        </div>
        {(report.caveats.length > 0 || report.dataGaps.length > 0) && <div className="metric-notes" aria-label="자료 범위">{report.caveats.map((note, i) => <p key={i}><span className="category-chip">{/환율/.test(note) ? "환율" : /금리/.test(note) ? "금리" : "참고"}</span>{note}</p>)}{report.dataGaps.map((note, i) => <p key={`gap-${i}`}>💡 {note} <span>관련 해석은 참고용으로 읽어주세요.</span></p>)}</div>}
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
        <h2>이어서 알아볼까요?</h2><p className="section-guide">머핀랩이 추천하는 연관 지식이에요. 주제를 고르면 질문이 채워져요. 질문을 확인하고 생성 버튼을 눌러 새 AI 리포트를 받아보세요.</p>
        <div className={styles.topicGrid}>{report.nextTopics.map((topic, i) => <Link key={i} href={`/?question=${encodeURIComponent(topic)}${area ? `&area=${area}` : ""}`} className={styles.topicLink}><span><strong>{topic}</strong>{topicReasons[i] && <small>{topicReasons[i]}</small>}<em>머핀랩과 더 알아보기</em></span><span aria-hidden="true">→</span></Link>)}</div>
      </section>}

      <p className="report-disclosure">머핀랩은 AI 에이전트로 리포트를 만들며, 실수할 수 있어요. 중요한 정보는 원문과 함께 확인하고, 투자 결정은 신중하게 해주세요.</p>
    </div>
    </ReportEvidenceScope>
  );
}
