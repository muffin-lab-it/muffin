"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

type Scope = {
  prefix: string;
  selection: string | null;
  select: (key: string) => void;
  /** 근거 보기로 내려간 뒤 돌아갈 자리(숫자 카드 id)와 도착한 장부 번호 (11/21 QA 2 · 외부 F8: 돌아오기가 번거로웠음) */
  origin: string | null;
  target: string | null;
  visit: (origin: string | null, target: string | null) => void;
  returnToOrigin: () => void;
};
const EvidenceScope = createContext<Scope | null>(null);

/** 링크 클릭과 URL 해시 복원 모두 접힌 조상 패널을 먼저 엽니다. */
function openContainingDetails(target: HTMLElement) {
  let parent = target.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
}

/**
 * 근거로 내려간 뒤 사용자가 버튼 없이 스크롤로 읽던 곳에 돌아왔는지 (11/26 사용자: 떠 있는 돌아가기 버튼이 남지 않게).
 * 읽던 곳이 화면에서 한 번 벗어났다가(left) 다시 절반 넘게 보이면 돌아온 것으로 봅니다. 처음부터 계속 보이면 돌아온 게 아닙니다.
 */
export function returnedByScroll(left: boolean, visible: boolean): { left: boolean; returned: boolean } {
  if (!visible) return { left: true, returned: false };
  return { left, returned: left };
}

function clearHighlights() {
  document.querySelectorAll<HTMLElement>("[data-highlight='true']").forEach(element => element.removeAttribute("data-highlight"));
}

/** 여러 리포트가 있어도 각자의 자료 패널로 이동합니다. */
export function ReportEvidenceScope({ children }: { children: ReactNode }) {
  const prefix = useId();
  const [selection, select] = useState<string | null>(null);
  const [visit, setVisit] = useState<{ origin: string | null; target: string | null }>({ origin: null, target: null });
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
  // 스크롤로 직접 돌아오면 떠 있는 돌아가기 버튼을 거둠
  useEffect(() => {
    const element = visit.origin ? document.getElementById(visit.origin) : null;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let left = false;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const next = returnedByScroll(left, entry.intersectionRatio >= 0.5);
        left = next.left;
        if (next.returned) setVisit({ origin: null, target: null });
      }
    }, { threshold: [0, 0.5] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visit.origin]);
  const value = useMemo<Scope>(() => ({
    prefix,
    selection,
    select,
    origin: visit.origin,
    target: visit.target,
    visit: (origin, target) => setVisit({ origin, target }),
    returnToOrigin: () => {
      clearHighlights();
      const element = visit.origin ? document.getElementById(visit.origin) : null;
      setVisit({ origin: null, target: null });
      if (element) requestAnimationFrame(() => { element.focus({ preventScroll: true }); element.scrollIntoView({ block: "center" }); });
    },
  }), [prefix, selection, visit]);
  return <EvidenceScope.Provider value={value}>{children}</EvidenceScope.Provider>;
}

export function useEvidenceTarget(evidenceId: string) {
  const scope = useContext(EvidenceScope);
  return scope === null ? null : `${scope.prefix}-evidence-${evidenceId}`;
}

/** 돌아올 자리 표시용 감싸개 (숫자 카드). 같은 리포트 안에서만 유효한 id 를 붙입니다. */
export function EvidenceOrigin({ name, className, children, ...rest }: { name: string; className?: string; children: ReactNode; [key: `data-${string}`]: string | undefined }) {
  const id = useEvidenceTarget(name);
  return <div id={id ?? undefined} className={className} tabIndex={-1} {...rest}>{children}</div>;
}

export function ReportEvidenceLink({ targetId, label, children, className = "", valueKey, originId }: { targetId: string; label: string; children?: ReactNode; className?: string; valueKey?: string; originId?: string }) {
  const scope = useContext(EvidenceScope);
  return <a className={`evidence-link ${className}`} aria-label={children ? label : undefined} href={`#${encodeURIComponent(targetId)}`} data-value-key={valueKey} data-origin={originId} onClick={(event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    const group = target.closest<HTMLElement>("[data-source-group]")?.dataset.sourceGroup;
    openContainingDetails(target);
    // 값 키가 있으면 그 줄을 열고 색칠해 그 줄로 내려갑니다 (11/21 QA 2: 카드 맨 위로만 가서 어느 값인지 몰랐음)
    const row = valueKey ? target.querySelector<HTMLElement>(`[data-key="${CSS.escape(valueKey)}"]`) : null;
    clearHighlights();
    if (row) { openContainingDetails(row); row.setAttribute("data-highlight", "true"); }
    if (group && scope) scope.select(group);
    scope?.visit(originId ?? null, target.dataset.evidenceId ?? null);
    window.history.pushState(null, "", `#${encodeURIComponent(targetId)}`);
    requestAnimationFrame(() => { target.focus({ preventScroll: true }); (row ?? target).scrollIntoView({ block: row ? "center" : "start" }); });
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
