"use client";

import { ReportHint } from "./ReportHint";
import type { ReactNode } from "react";
import type { Evidence, Report } from "@/src/agent/schema";
import { ReportEvidenceLink, ReportSectionLink, useEvidenceTarget } from "./ReportEvidenceScope";

/** 장부나 저장 기록에서 온 URL도 웹 주소인 경우에만 링크로 표시합니다. */
export function SourceLink({ url, name }: { url: string; name: string }) {
  let safe = false;
  try {
    const parsed = new URL(url);
    safe = parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    // 주소가 없거나 잘못되었어도 출처명과 기준일은 보존합니다.
  }
  return safe ? (
    <a href={url} target="_blank" rel="noopener noreferrer">{name}</a>
  ) : (
    <span>{name} <small className="report-muted">(연결 가능한 출처 주소 없음)</small></span>
  );
}

export function EvidenceReference({ evidenceId, evidence, label = "자료 출처 자세히 보기", children }: {
  children?: ReactNode;
  label?: string;
  evidenceId: string | null;
  evidence: Evidence[];
}) {
  const entry = evidence.find((item) => item.id === evidenceId);
  const targetId = useEvidenceTarget(evidenceId ?? "missing");
  if (!entry) {
    return (
      <>
      {children}
      <p className="evidence-missing">
        {evidenceId ? `${evidenceId} · 근거를 찾을 수 없음` : "근거 번호 없음 · 원본을 대조할 수 없습니다."}
      </p>
      </>
    );
  }
  if (targetId) return <ReportEvidenceLink targetId={targetId} label={label} className={children ? "metric-value-link" : ""}>{children}</ReportEvidenceLink>;
  return (
    <details className="evidence-detail">
      <summary>출처와 자료 날짜 보기</summary>
      <EvidenceContent entry={entry} evidence={evidence} />
    </details>
  );
}

export function EvidenceRecord({ entry, evidence }: { entry: Evidence; evidence: Evidence[] }) {
  const id = useEvidenceTarget(entry.id);
  return <div className="evidence-record" id={id ?? undefined} tabIndex={-1}><EvidenceContent entry={entry} evidence={evidence} /></div>;
}

/** 계산의 입력은 링크만 렌더링하여 순환 계보도 재귀적으로 펼치지 않습니다. */
function EvidenceInputLink({ evidenceId, evidence }: { evidenceId: string; evidence: Evidence[] }) {
  const targetId = useEvidenceTarget(evidenceId);
  const entry = evidence.find((item) => item.id === evidenceId);
  if (!entry) return <span className="evidence-missing">{evidenceId} (자료 없음)</span>;
  return targetId
    ? <ReportEvidenceLink targetId={targetId} label={`${entry.label} · ${evidenceId}`}><span>{evidenceId}</span></ReportEvidenceLink>
    : <span>{entry.label} · {evidenceId}</span>;
}

const valueLabels: Record<string, string> = {
  op: "계산 방식", result: "결과", unit: "단위", a: "입력 값 1", b: "입력 값 2",
  rate: "값", pair: "통화", date: "자료 날짜", title: "기사 제목", formula: "계산식",
};
const operationLabels: Record<string, string> = { spread: "차이", diff: "차이", pct_change: "변화율", pp_diff: "%p 차이" };

function EvidenceContent({ entry, evidence }: { entry: Evidence; evidence: Evidence[] }) {
  const isNews = /news/i.test(entry.tool);
  return (
    <div className="evidence-content">
      <p className="evidence-title">{entry.label}</p>
      <div className="evidence-meta">
        <span aria-hidden="true">{entry.lineage ? "🧮" : isNews ? "📰" : "📊"}</span>
        {entry.lineage ? <span>계산에 사용한 자료</span> : <SourceLink url={entry.source.url} name={entry.source.name} />}
        <span>{entry.source.asOf ? `${entry.source.asOf} 자료` : "자료 날짜 미제공"}</span>
        {entry.lineage ? <span className="evidence-inputs">{entry.lineage.inputs.length > 0 ? entry.lineage.inputs.map((id, index) => (
          <span key={`${id}-${index}`}>
            {index > 0 && ", "}
            <EvidenceInputLink evidenceId={id} evidence={evidence} />
          </span>
        )) : "입력 자료 미제공"}</span> : <span>자료 {entry.id}</span>}
      </div>
      {Object.keys(entry.values).length > 0 ? (
        <dl className="evidence-values">
          {Object.entries(entry.values).map(([key, value]) => (
            <div key={key}><dt title={key}>{valueLabels[key] ?? key}</dt><dd>{key === "op" ? operationLabels[String(value)] ?? String(value) : String(value)}</dd></div>
          ))}
        </dl>
      ) : <p className="evidence-missing">공개된 원본 값이 없습니다.</p>}
    </div>
  );
}

export function ReportReadingNotice({ report }: { report: Report }) {
  const { verification: v } = report;
  const needsAttention = v.status !== "pass";
  if (!needsAttention && !report.notice) return null;
  return (
    <div className={`report-reading-notice ${needsAttention ? "needs-attention" : ""}`}>
      {report.notice && <p className="report-notice">{report.notice}</p>}
      {needsAttention && <div className="verification-notice">
        <strong>{v.status === "skipped" ? "검사 미실행" : "일부 확인 필요"}</strong>
        <p>{v.status === "skipped" ? "자동 검사를 거치지 않은 리포트예요." : [
          v.removed.length > 0 ? `제외하거나 조정한 항목이 ${v.removed.length}개 있어요.` : "",
          v.advice > 0 ? `권유로 해석될 수 있는 표현이 ${v.advice}건 남아 있어요.` : "",
        ].filter(Boolean).join(" ") || "구체적인 사유는 기록에서 확인해 주세요."}</p>
        <ReportHint>자세한 내용은 <ReportSectionLink name="sources" label="출처와 근거" /> · <ReportSectionLink name="verification" label="리포트 상세 정보" />에서 확인하세요.</ReportHint>
      </div>}
    </div>
  );
}

/** 사용자에게 필요한 미확인 정보만 표시합니다. 운영 통계는 렌더링하지 않습니다. */
export function ReportVerification({ report }: { report: Report }) {
  const v = report.verification;
  const unchecked = report.numbers.filter((n) => n.check === "unverified");
  return (
    <section className="report-verification" aria-label="리포트 검증 상태">
      <h2>확인할 내용</h2>
      <ReportHint>자동 검사는 자료와 숫자를 대조하는 과정이에요. 중요한 내용은 원문과 함께 확인해 주세요.</ReportHint>
      {v.status === "skipped" ? <p>이 리포트는 자동 검사를 거치지 않았어요.</p> : <>
        {unchecked.length > 0 && <p>원본과 대조하지 못한 숫자: {unchecked.map((n) => n.label).join(", ")}</p>}
        {v.advice > 0 && <p>권유로 해석될 수 있는 표현이 남아 있어요. 투자 결정의 근거로 삼지 않도록 주의해 주세요.</p>}
        {v.removed.length === 0 && unchecked.length === 0 && v.advice === 0 && <p>{v.status === "partial" ? "부분 확인 상태로 저장되어 있지만 구체적인 사유는 기록되지 않았어요." : "기록된 추가 확인 사항이 없어요."}</p>}
      </>}
      {v.removed.length > 0 && <div className="report-adjustments"><h3>제외·조정한 내용</h3><ul>{v.removed.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    </section>
  );
}
