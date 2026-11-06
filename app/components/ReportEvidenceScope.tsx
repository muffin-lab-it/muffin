"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

const EvidenceScope = createContext<string | null>(null);

/** 여러 리포트가 있어도 각자 오른쪽 자료 패널로 이동합니다. */
export function ReportEvidenceScope({ children }: { children: ReactNode }) {
  const prefix = useId();
  return <EvidenceScope.Provider value={prefix}>{children}</EvidenceScope.Provider>;
}

export function useEvidenceTarget(evidenceId: string) {
  const prefix = useContext(EvidenceScope);
  return prefix === null ? null : `${prefix}-evidence-${evidenceId}`;
}

export function ReportEvidenceLink({ targetId, label, children, className = "" }: { targetId: string; label: string; children?: ReactNode; className?: string }) {
  return <a className={`evidence-link ${className}`} aria-label={children ? label : undefined} href={`#${encodeURIComponent(targetId)}`} onClick={(event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    let parent = target.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    target.focus({ preventScroll: true });
  }}>{children ?? label}</a>;
}

export function ReasonEvidenceLink({ index, children }: { index: number; children?: ReactNode }) {
  const targetId = useEvidenceTarget(`reason-${index}`);
  return targetId ? <ReportEvidenceLink targetId={targetId} label={`${typeof children === "string" ? children : `설명 ${index + 1}`} · 근거 보기`} className="reason-link">{children}</ReportEvidenceLink> : null;
}

export function ReasonEvidenceTarget({ index, children }: { index: number; children: ReactNode }) {
  const id = useEvidenceTarget(`reason-${index}`);
  return <div className="reason-evidence" id={id ?? undefined} tabIndex={-1}>{children}</div>;
}

export function ReportSectionLink({ name, label }: { name: string; label: string }) {
  const targetId = useEvidenceTarget(`section-${name}`);
  return targetId ? <ReportEvidenceLink targetId={targetId} label={label} /> : <span>{label}</span>;
}

export function ReportSectionTarget({ name, children }: { name: string; children: ReactNode }) {
  const id = useEvidenceTarget(`section-${name}`);
  return <div className="report-section-target" id={id ?? undefined} tabIndex={-1}>{children}</div>;
}
