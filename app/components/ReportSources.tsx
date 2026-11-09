"use client";

import { evidenceCategory } from "./reportCategory";
import { reportChange } from "./reportChange";
import type { Report } from "@/src/agent/schema";
import { EvidenceRecord, SourceLink } from "./ReportEvidence";
import { ReasonEvidenceTarget, useEvidenceSelection, useEvidenceTarget } from "./ReportEvidenceScope";

const introductions: Record<string, string> = {
  환율: "통화의 교환 비율과 기간별 움직임을 살펴보세요.",
  금리: "국가별 금리 수준과 자료가 가리키는 날짜를 비교해 보세요.",
  물가: "물가 지표의 변화와 집계 기간을 살펴보세요.",
  ETF: "상품별 가격·지표와 자료 날짜를 살펴보세요.",
  뉴스: "리포트에서 참고한 보도와 원문을 모았어요.",
  계산: "어떤 값을 사용해 결과를 얻었는지 살펴보세요.",
};

export function ReportSources({ report }: { report: Report }) {
  const scope = useEvidenceSelection();
  const rootId = useEvidenceTarget("section-sources");
  const groups = [...new Set(report.evidence.map(evidenceCategory))];
  const reasonGroup = (reason: Report["why"][number]) => {
    const entry = report.evidence.find(item => reason.refs.includes(item.id));
    return entry ? evidenceCategory(entry) : "AI 해설";
  };
  // Preserve sources without a matching evidence record, without repeating linked originals.
  const extraSources = report.sources.filter(source => !report.evidence.some(entry => entry.source.url === source.url && entry.source.name === source.name && entry.source.asOf === source.asOf));
  if (extraSources.length > 0) groups.push("참고 문서");
  const active = scope?.selection && groups.includes(scope.selection) ? scope.selection : groups[0];
  return <section className="source-library" aria-label="정확한 데이터로 보는 금융" id={rootId ?? undefined} tabIndex={-1}>
    <div className="source-library-heading"><div><span className="source-eyebrow">더 나아가기</span><h2>정확한 데이터로 보는 금융</h2></div></div>
    <div className="source-chips" role="group" aria-label="자료 주제 선택">
      {groups.map(group => <button type="button" key={group} aria-pressed={active === group} onClick={() => scope?.select(group)}>{group}</button>)}
    </div>
    {groups.length === 0 && <p className="report-muted">연결된 자료가 없습니다.</p>}
    {groups.map(group => <div className="source-panel" key={group} data-source-group={group} hidden={active !== group}>
      <div className="source-panel-heading"><h3>{group}</h3>{introductions[group] && <p>{introductions[group]}</p>}</div>
      {group === "계산" && report.notice && <p className="source-insight">{report.notice}</p>}
      {report.why.some(reason => reasonGroup(reason) === group) && <div className="source-reasons">
        {report.why.map((reason, index) => reasonGroup(reason) === group && <ReasonEvidenceTarget index={index} key={index}>
          <h4>{reason.claim}</h4><p>{reason.evidence}</p>
          
        </ReasonEvidenceTarget>)}
      </div>}
      {group === "참고 문서" ? <ul>{extraSources.map((source, index) => <li key={index}><SourceLink url={source.url} name={source.name} /> · 기준일 {source.asOf || "미제공"}</li>)}</ul> : <div className="source-data-grid">
        {report.evidence.filter(entry => evidenceCategory(entry) === group).map(entry => <div key={entry.id} className="source-data-item">
          {report.numbers.filter(number => number.ref === entry.id).map((number, index) => <div className="source-number" key={index}><span>{number.label}</span><strong>{number.value}</strong>{number.change && <small>{reportChange(number.change).text}</small>}</div>)}
          <EvidenceRecord entry={entry} evidence={report.evidence} />
        </div>)}
      </div>}
    </div>)}
  </section>;
}
