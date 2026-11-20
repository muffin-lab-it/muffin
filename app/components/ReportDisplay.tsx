import type { ReactNode } from "react";

export function ReportDisplay({ children, className }: { children: ReactNode; className: string }) {
  return <div className={className} data-verification="on">{children}</div>;
}
