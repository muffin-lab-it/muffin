"use client";

import { ReportResponsiveDetails } from "./ReportResponsiveDetails";
import { evidenceCategory } from "./reportCategory";
import { reportChange } from "./reportChange";
import type { Report } from "@/src/agent/schema";
import { EvidenceRecord, SourceLink } from "./ReportEvidence";
import { formatDateKo } from "./format";
import { useEvidenceSelection, useEvidenceTarget } from "./ReportEvidenceScope";

export function ReportSources({ report }: { report: Report }) {
  const scope = useEvidenceSelection();
  const rootId = useEvidenceTarget("section-sources");
  const groups = [...new Set(report.evidence.map(evidenceCategory))];
  // Preserve sources without a matching evidence record, without repeating linked originals.
  const extraSources = report.sources.filter(source => !report.evidence.some(entry => entry.source.url === source.url && entry.source.name === source.name && entry.source.asOf === source.asOf));
  if (extraSources.length > 0) groups.push("참고 문서");
  const active = scope?.selection && groups.includes(scope.selection) ? scope.selection : groups[0];
  return <section className="source-library" aria-label="정확한 데이터로 보는 금융" id={rootId ?? undefined} tabIndex={-1}>
    <ReportResponsiveDetails className="report-fold" summary={<h2>출처와 원본 데이터</h2>}>

    {groups.length > 1 && <div className="source-chips" role="group" aria-label="자료 주제 선택">
      {groups.map(group => <button type="button" key={group} aria-pressed={active === group} onClick={() => scope?.select(group)}>{group}</button>)}
    </div>}
    {groups.length === 0 && <p className="report-muted">연결된 자료가 없습니다.</p>}
    {groups.map(group => <div className="source-panel" key={group} data-source-group={group} hidden={active !== group}>
      <div className="source-panel-heading"><h3>{group}</h3></div>
      {group === "참고 문서" ? <ul>{extraSources.map((source, index) => <li key={index}><SourceLink url={source.pageUrl ?? source.url} name={source.name} /> · 기준일 {formatDateKo(source.asOf) || "미제공"}</li>)}</ul> : <div className="source-data-grid">
        {report.evidence.filter(entry => evidenceCategory(entry) === group).map(entry => <div key={entry.id} className="source-data-item">
          {report.numbers.filter(number => number.ref === entry.id).map((number, index) => <div className="source-number" key={index}><span className="source-number-label">{number.label} <span className="evidence-id" aria-label={`근거 번호 ${entry.id}`}>{entry.id}</span></span><strong>{number.value}</strong>{number.change && <small>{reportChange(number.change, number.changeDetail).text}</small>}</div>)}
          <EvidenceRecord entry={entry} evidence={report.evidence} displayedValue={report.numbers.find(number => number.ref === entry.id)?.value} displayedLabel={report.numbers.find(number => number.ref === entry.id)?.label} hideHeading={report.numbers.some(number => number.ref === entry.id)} />
        </div>)}
      </div>}
    </div>)}
    <p className="section-guide">{groups.length > 1 ? "주제를 고른 뒤, 리포트에 쓰인 수치의 출처와 기준일을 확인해 보세요." : "리포트에 쓰인 수치의 출처와 기준일을 확인해 보세요."} 비교에 사용한 자료도 아래에서 함께 볼 수 있어요.</p>

    </ReportResponsiveDetails>
  </section>;
}
