import type { ReactNode } from "react";

/** 리포트의 사용 안내는 아이콘·글자 크기·색상을 한 가지로 맞춥니다. */
export function ReportHint({ children }: { children: ReactNode }) {
  return <p className="report-hint"><span className="report-hint-icon" aria-hidden="true">ⓘ</span><span>{children}</span></p>;
}
