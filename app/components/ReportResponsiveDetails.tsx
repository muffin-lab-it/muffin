"use client";
import { useEffect, useRef, type ReactNode } from "react";

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
