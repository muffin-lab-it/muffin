"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";

const EvidenceScope = createContext<{ prefix: string; selection: string | null; select: (key: string) => void } | null>(null);

/** 링크 클릭과 URL 해시 복원 모두 접힌 조상 패널을 먼저 엽니다. */
function openContainingDetails(target: HTMLElement) {
  let parent = target.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
}

/** 여러 리포트가 있어도 각자의 자료 패널로 이동합니다. */
export function ReportEvidenceScope({ children }: { children: ReactNode }) {
  const prefix = useId();
  const [selection, select] = useState<string | null>(null);
  useEffect(() => {
    const revealHash = () => {
      let id: string;
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id.startsWith(`${prefix}-evidence-`)) return;
      const target = document.getElementById(id);
      const group = target?.closest<HTMLElement>("[data-source-group]")?.dataset.sourceGroup;
      if (target) openContainingDetails(target);
      if (group) select(group);
      if (target) requestAnimationFrame(() => { target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start" }); });
    };
    revealHash();
    window.addEventListener("hashchange", revealHash);
    return () => window.removeEventListener("hashchange", revealHash);
  }, [prefix]);
  return <EvidenceScope.Provider value={{ prefix, selection, select }}>{children}</EvidenceScope.Provider>;
}

export function useEvidenceTarget(evidenceId: string) {
  const scope = useContext(EvidenceScope);
  return scope === null ? null : `${scope.prefix}-evidence-${evidenceId}`;
}

export function ReportEvidenceLink({ targetId, label, children, className = "" }: { targetId: string; label: string; children?: ReactNode; className?: string }) {
  const scope = useContext(EvidenceScope);
  return <a className={`evidence-link ${className}`} aria-label={children ? label : undefined} href={`#${encodeURIComponent(targetId)}`} onClick={(event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    const group = target.closest<HTMLElement>("[data-source-group]")?.dataset.sourceGroup;
    if (group && scope) {
      event.preventDefault();
      scope.select(group);
      window.history.pushState(null, "", `#${encodeURIComponent(targetId)}`);
      requestAnimationFrame(() => { target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start" }); });
      return;
    }
    openContainingDetails(target);
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

export function useEvidenceSelection() {
  return useContext(EvidenceScope);
}
