"use client";

/** 리포트 화면의 동작 버튼. 보관은 생성 때 자동으로 되므로 버튼이 없고(11/20 하니), PDF 는 브라우저 인쇄를 씁니다. */
export function ReportActions() {
  return <button type="button" onClick={() => window.print()}>PDF로 담기</button>;
}
