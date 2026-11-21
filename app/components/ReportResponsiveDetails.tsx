"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** 기본은 접힌 details. 인쇄(PDF 저장) 순간에만 펼쳤다가 끝나면 되돌려 PDF 에 내용이 빠지지 않게 합니다 (11/21 Codex 리뷰). */
export function PrintOpenDetails({ summary, children, className = "", label }: { summary: ReactNode; children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let openBefore = false;
    const beforePrint = () => { if (ref.current) { openBefore = ref.current.open; ref.current.open = true; } };
    const afterPrint = () => { if (ref.current) ref.current.open = openBefore; };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);
  return <details ref={ref} className={className} aria-label={label}>
    <summary>{summary}</summary>
    {children}
  </details>;
}

/** Only phone viewports collapse supporting content; narrow desktop columns stay expanded. */
export function ReportResponsiveDetails({ summary, children, className = "", label }: { summary: ReactNode; children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const sync = () => {
      if (!ref.current) return;
      let linkedTarget: HTMLElement | null = null;
      try { linkedTarget = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); } catch { /* Ignore malformed hashes. */ }
      ref.current.open = !media.matches || (linkedTarget !== null && ref.current.contains(linkedTarget));
      const heading = ref.current.querySelector("summary");
      if (heading) heading.tabIndex = media.matches ? 0 : -1;
    };
    sync();
    media.addEventListener("change", sync);
    let beforePrintOpen = true;
    const beforePrint = () => { if (ref.current) { beforePrintOpen = ref.current.open; ref.current.open = true; } };
    const afterPrint = () => { if (ref.current) ref.current.open = beforePrintOpen; };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);
  return <details ref={ref} open className={`responsive-details ${className}`} aria-label={label}>
    <summary onClick={event => { if (!window.matchMedia("(max-width: 600px)").matches) event.preventDefault(); }}>{summary}</summary>
    {children}
  </details>;
}
