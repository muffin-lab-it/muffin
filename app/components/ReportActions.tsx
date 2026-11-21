"use client";

/** 인쇄(PDF 저장) 때 브라우저가 쓰는 기본 파일명: MuffinLab_261120_질문 앞 30자 (11/20 서영 2). 파일명에 못 쓰는 글자는 공백으로. */
export function pdfTitle(question: string | undefined, createdAt: string | undefined, now = new Date()): string {
  const parsed = createdAt ? new Date(createdAt) : now;
  const date = Number.isNaN(parsed.getTime()) ? now : parsed;
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const stamp = `${String(kst.getUTCFullYear()).slice(2)}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  const slug = (question ?? "").replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30).trim();
  return `MuffinLab_${stamp}${slug ? `_${slug}` : ""}`;
}

/** 리포트 화면의 동작 버튼. 보관은 생성 때 자동으로 되므로 버튼이 없고(11/20 하니), PDF 는 브라우저 인쇄를 씁니다. */
export function ReportActions({ question, createdAt }: { question?: string; createdAt?: string }) {
  function print() {
    const previous = document.title;
    const restore = () => { document.title = previous; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    document.title = pdfTitle(question, createdAt);
    window.print();
  }
  return <button type="button" onClick={print}>PDF로 담기</button>;
}
