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

export function ReportEvidenceLink({ targetId, label }: { targetId: string; label: string }) {
  return <a className="evidence-link" href={`#${encodeURIComponent(targetId)}`} onClick={(event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    let parent = target.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    target.focus({ preventScroll: true });
  }}>{label}</a>;
}
