"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const ReportMode = createContext<{ enabled: boolean; toggle: () => void } | null>(null);

export function ReportDisplay({ children, className }: { children: ReactNode; className: string }) {
  const [enabled, setEnabled] = useState(true);
  return <ReportMode.Provider value={{ enabled, toggle: () => setEnabled(value => !value) }}>
    <div className={className} data-verification={enabled ? "on" : "off"}>{children}</div>
  </ReportMode.Provider>;
}

export function ReportModeToggle() {
  const mode = useContext(ReportMode);
  if (!mode) return null;
  return <button type="button" className="report-mode-toggle" aria-pressed={mode.enabled} onClick={mode.toggle}>
    <span aria-hidden="true">✓</span> 검증·근거 보기 <span className="report-mode-state">{mode.enabled ? "ON" : "OFF"}</span>
  </button>;
}
