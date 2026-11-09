"use client";

import type { ReactNode } from "react";
import type { Evidence } from "@/src/agent/schema";
import { ReportEvidenceLink, useEvidenceTarget } from "./ReportEvidenceScope";

/** 장부나 저장 기록에서 온 URL도 웹 주소인 경우에만 링크로 표시합니다. */
export function SourceLink({ url, name }: { url: string; name: string }) {
  let safe = false;
  try {
    const parsed = new URL(url);
    safe = (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.hostname.startsWith("api.") && !/\/api(?:\/|$)/i.test(parsed.pathname);
  } catch {
    // 주소가 없거나 잘못되었어도 출처명과 기준일은 보존합니다.
  }
  return safe ? (
    <a href={url} target="_blank" rel="noopener noreferrer">{name}</a>
  ) : (
    <span>{name}</span>
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
        {evidenceId ? "연결된 원본 자료를 찾을 수 없어요." : "연결된 원본 자료가 없어요."}
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

export function EvidenceRecord({ entry, evidence, displayedValue }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string }) {
  const id = useEvidenceTarget(entry.id);
  return <div className="evidence-record" id={id ?? undefined} tabIndex={-1}><EvidenceContent entry={entry} evidence={evidence} displayedValue={displayedValue} /></div>;
}

/** 입력 자료는 이름으로 보여주며 내부 이동이나 재귀 펼침을 만들지 않습니다. */
function EvidenceInputLink({ evidenceId, evidence }: { evidenceId: string; evidence: Evidence[] }) {
  const entry = evidence.find((item) => item.id === evidenceId);
  return <span>{entry?.label ?? "연결된 자료 없음"}</span>;
}

const valueLabels: Record<string, string> = {
  op: "계산 방식", result: "결과", unit: "단위", a: "입력 값 1", b: "입력 값 2",
  rate: "값", value: "값", pair: "통화", date: "자료 날짜", asOf: "자료 날짜", title: "기사 제목", formula: "계산식",
  comparisonRate: "비교 값", comparisonAsOf: "비교 날짜", change: "변화량", changePct: "변화율 (%)", changePp: "변화 (%p)",
};
const operationLabels: Record<string, string> = { spread: "차이", diff: "차이", pct_change: "변화율", pp_diff: "%p 차이" };

function EvidenceContent({ entry, evidence, displayedValue }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string }) {
  // A single raw value adds no context when its formatted equivalent is already above.
  // Keep differing values, calculations and multi-field records visible.
  const fields = Object.entries(entry.values);
  const formatted = displayedValue?.replaceAll(",", "");
  const duplicate = !entry.lineage && fields.length === 1 && ["value", "rate"].includes(fields[0][0])
    && typeof fields[0][1] === "number" && formatted !== undefined
    && /^[+-]?\d+(?:\.\d+)?(?:%p|%|원)?$/.test(formatted)
    && Number.parseFloat(formatted) === fields[0][1];
  const isNews = /news/i.test(entry.tool);
  return (
    <div className="evidence-content">
      <p className="evidence-title">{entry.label.replace(new RegExp(" · " + entry.source.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "")}</p>
      <div className="evidence-meta">
        <span aria-hidden="true">{entry.lineage ? "🧮" : isNews ? "📰" : "📊"}</span>
        {entry.lineage ? <span>계산에 사용한 자료</span> : <SourceLink url={entry.source.url} name={entry.source.name} />}
        <span>{entry.source.asOf ? `기준일 ${entry.source.asOf}` : "자료 날짜 미제공"}</span>
        {entry.lineage ? <span className="evidence-inputs">{entry.lineage.inputs.length > 0 ? entry.lineage.inputs.map((id, index) => (
          <span key={`${id}-${index}`}>
            {index > 0 && ", "}
            <EvidenceInputLink evidenceId={id} evidence={evidence} />
          </span>
        )) : "입력 자료 미제공"}</span> : null}
      </div>
      {duplicate ? null : Object.keys(entry.values).length > 0 ? (
        <dl className="evidence-values">
          {Object.entries(entry.values).map(([key, value]) => (
            <div key={key}><dt title={key}>{valueLabels[key] ?? key}</dt><dd>{key === "op" ? operationLabels[String(value)] ?? String(value) : String(value)}</dd></div>
          ))}
        </dl>
      ) : <p className="evidence-missing">공개된 원본 값이 없습니다.</p>}
    </div>
  );
}
