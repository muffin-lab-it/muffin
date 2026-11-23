"use client";

import { PrintOpenDetails, ReportResponsiveDetails } from "./ReportResponsiveDetails";
import { evidenceCategory } from "./reportCategory";
import { reportChange } from "./reportChange";
import type { Evidence, Report } from "@/src/agent/schema";
import { EvidenceRecord, SourceLink } from "./ReportEvidence";
import { useEvidenceSelection, useEvidenceTarget } from "./ReportEvidenceScope";
import { formatDateKo } from "./format";

/** 리포트가 실제로 참조한 장부 번호: 숫자 카드 · 원인 · 차트와, 그 계산에 들어간 입력까지 (11/21 QA 4: 안 쓴 자료가 첫 탭에 오던 것) */
export function usedEvidenceIds(report: Report): Set<string> {
  const used = new Set<string>();
  const add = (id: string | null | undefined) => { if (id) used.add(id); };
  for (const number of report.numbers) add(number.ref);
  for (const reason of report.why) reason.refs.forEach(add);
  for (const chart of report.charts ?? []) {
    chart.series.forEach(series => add(series.ref));
    chart.events?.forEach(event => add(event.ref));
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of report.evidence) {
      if (!used.has(entry.id) || !entry.lineage) continue;
      for (const input of entry.lineage.inputs) if (!used.has(input)) { used.add(input); grew = true; }
    }
  }
  return used;
}

/** 장부별로 숫자 카드가 대조한 값 키. 카드에서 그 값을 먼저 보여 줍니다 */
function usedKeysByRef(report: Report): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const number of report.numbers) {
    if (!number.ref || !number.match?.key) continue;
    const key = number.match.key.replace(/#text$/, "");
    const list = map.get(number.ref) ?? [];
    if (!list.includes(key)) list.push(key);
    map.set(number.ref, list);
  }
  return map;
}

export function ReportSources({ report }: { report: Report }) {
  const scope = useEvidenceSelection();
  const rootId = useEvidenceTarget("section-sources");
  const used = usedEvidenceIds(report);
  // 기사는 리포트의 재료 그 자체라 번호로 참조되지 않아도 접지 않습니다 (11/22 운영 확인: 기사 11건 중 10건이 '안 쓴 자료' 로 접힘)
  const isShown = (entry: Evidence) => used.has(entry.id) || /news/i.test(entry.tool);
  const usedEntries = report.evidence.filter(isShown);
  // 쓴 자료가 하나도 없는 리포트(숫자 · 원인 없음)는 전부 그대로 보여 줍니다
  const shown = usedEntries.length > 0 ? usedEntries : report.evidence;
  const folded = usedEntries.length > 0 ? report.evidence.filter(entry => !isShown(entry)) : [];
  // 숫자 카드 순서대로 주제를 배열해 리포트가 쓴 자료가 첫 탭에 옵니다. 계산은 파생이라 맨 뒤
  const firstByNumbers = report.numbers.map(number => report.evidence.find(entry => entry.id === number.ref)).filter((entry): entry is Evidence => !!entry);
  const ordered = [...new Set([...firstByNumbers, ...shown].map(evidenceCategory))].filter(group => shown.some(entry => evidenceCategory(entry) === group));
  const groups = [...ordered.filter(group => group !== "계산"), ...ordered.filter(group => group === "계산")];
  // Preserve sources without a matching evidence record, without repeating linked originals.
  const extraSources = report.sources.filter(source => !report.evidence.some(entry => entry.source.url === source.url && entry.source.name === source.name && entry.source.asOf === source.asOf));
  if (extraSources.length > 0) groups.push("참고 문서");
  const active = scope?.selection && groups.includes(scope.selection) ? scope.selection : groups[0];
  const keys = usedKeysByRef(report);
  return <section className="source-library" aria-label="정확한 데이터로 보는 금융" id={rootId ?? undefined} tabIndex={-1}>
    <ReportResponsiveDetails className="report-fold" summary={<h2>출처와 원본 데이터</h2>}>

    {groups.length > 1 && <div className="source-chips" role="group" aria-label="자료 주제 선택">
      {groups.map(group => <button type="button" key={group} aria-pressed={active === group} onClick={() => scope?.select(group)}>{group}</button>)}
    </div>}
    {groups.length === 0 && <p className="report-muted">연결된 자료가 없어요.</p>}
    {groups.map(group => <div className="source-panel" key={group} data-source-group={group} hidden={active !== group}>
      <div className="source-panel-heading"><h3>{group}</h3></div>
      {group === "참고 문서" ? <ul>{extraSources.map((source, index) => <li key={index}><SourceLink url={source.pageUrl ?? source.url} name={source.name} /> · 기준일 {formatDateKo(source.asOf) || "미제공"}</li>)}</ul> : <div className="source-data-grid">
        {shown.filter(entry => evidenceCategory(entry) === group).map(entry => {
          // 같은 장부를 가리키는 숫자가 여럿이면 첫 숫자만 크게, 나머지는 작은 줄로 (11/22 운영 확인: 숫자 넷이 큰 글씨로 세로로 쌓였음)
          const nums = report.numbers.filter(number => number.ref === entry.id);
          const [first, ...rest] = nums;
          return <div key={entry.id} className="source-data-item">
          {first && <div className="source-number"><span className="source-number-label">{first.label} <span className="evidence-id" aria-label={`근거 번호 ${entry.id}`}>{entry.id}</span></span><strong>{first.value}</strong>{first.change && <small>{reportChange(first.change, first.changeDetail).text}</small>}</div>}
          {rest.length > 0 && <ul className="source-number-subs">{rest.map((number, index) => <li key={index}><span>{number.label}</span><b>{number.value}</b>{number.change && <small>{reportChange(number.change, number.changeDetail).text}</small>}</li>)}</ul>}
          <EvidenceRecord entry={entry} evidence={report.evidence} usedKeys={keys.get(entry.id) ?? []} displayedValue={first?.value} displayedLabel={first?.label} hideHeading={!!first} />
        </div>;
        })}
      </div>}
    </div>)}
    {/* 조회는 했지만 리포트에 쓰지 않은 자료는 뒤로 접어 둡니다 (11/21 QA 4) */}
    {folded.length > 0 && <PrintOpenDetails className="source-unused" summary={`조회했지만 리포트에 쓰지 않은 자료 ${folded.length}개 · ${folded.slice(0, 5).map(entry => `${evidenceCategory(entry)} ${entry.id}`).join(", ")}${folded.length > 5 ? ` 외 ${folded.length - 5}개` : ""}`}>
      <div className="source-data-grid">{folded.map(entry => <div key={entry.id} className="source-data-item"><EvidenceRecord entry={entry} evidence={report.evidence} usedKeys={[]} /></div>)}</div>
    </PrintOpenDetails>}
    <p className="section-guide">{groups.length > 1 ? "주제를 고른 뒤, 리포트에 쓰인 수치의 출처와 기준일을 확인해 보세요." : "리포트에 쓰인 수치의 출처와 기준일을 확인해 보세요."} 비교에 사용한 자료도 아래에서 함께 볼 수 있어요.</p>

    </ReportResponsiveDetails>
  </section>;
}
