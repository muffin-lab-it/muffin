"use client";

import { useEffect, useRef, useState } from "react";
import type { Report } from "@/src/agent/schema";
import { reportToCsv, reportToMarkdown, type ExportMeta } from "@/src/lib/report-export";

/** 인쇄(PDF 저장) 때 브라우저가 쓰는 기본 파일명: MuffinLab_261120_질문 앞 30자 (11/20 서영 2). 파일명에 못 쓰는 글자는 공백으로. */
export function pdfTitle(question: string | undefined, createdAt: string | undefined, now = new Date()): string {
  const parsed = createdAt ? new Date(createdAt) : now;
  const date = Number.isNaN(parsed.getTime()) ? now : parsed;
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const stamp = `${String(kst.getUTCFullYear()).slice(2)}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  const slug = (question ?? "").replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30).trim();
  return `MuffinLab_${stamp}${slug ? `_${slug}` : ""}`;
}

export const COPY_DONE = "복사했어요. Notion에 붙여 넣으면 표와 목록이 그대로 들어가요";
export const COPY_FAILED = "복사하지 못했어요";

/** 리포트를 Notion 붙여 넣기용 Markdown 으로 클립보드에 복사하고 안내 문구를 돌려줍니다. 클립보드를 못 쓰면(권한 거부 · 지원 안 함) 실패 문구 */
export async function copyForNotion(report: Report, meta: ExportMeta, clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard): Promise<string> {
  if (!clipboard) return COPY_FAILED;
  try {
    await clipboard.writeText(reportToMarkdown(report, meta));
    return COPY_DONE;
  } catch {
    return COPY_FAILED;
  }
}

/** 시트용 CSV 파일 (구글 시트 · 엑셀 가져오기). 이름은 PDF 기본 파일명에 .csv */
export function csvFile(report: Report, question?: string, createdAt?: string): { name: string; blob: Blob } {
  return { name: `${pdfTitle(question, createdAt)}.csv`, blob: new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8" }) };
}

/**
 * 리포트 화면의 동작 버튼. 보관은 생성 때 자동으로 되므로 버튼이 없고(11/20 하니), PDF 는 브라우저 인쇄를 씁니다.
 * 11/26: 스터디 결과물 'Notion / Google Sheets 내보내기' — Notion 은 Markdown 복사, 시트는 숫자 카드 CSV(숫자 카드가 없으면 숨김).
 * 인쇄 때는 감싼 .report-actions 가 통째로 숨습니다.
 */
export function ReportActions({ question, createdAt, report }: { question?: string; createdAt?: string; report?: Report }) {
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function show(message: string) {
    setNote(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(""), 5000);
  }
  function print() {
    const previous = document.title;
    const restore = () => { document.title = previous; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    document.title = pdfTitle(question, createdAt);
    window.print();
  }
  async function copy(target: Report) {
    show(await copyForNotion(target, { question, createdAt, url: window.location.href }));
  }
  function download(target: Report) {
    const { name, blob } = csvFile(target, question, createdAt);
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return (
    <>
      <button type="button" onClick={print}>PDF로 담기</button>
      {report && <button type="button" onClick={() => { void copy(report); }}>Notion에 붙여 넣기</button>}
      {report && report.numbers.length > 0 && <button type="button" onClick={() => download(report)}>시트용 CSV 받기</button>}
      {/* 안내는 비어 있어도 자리(읽기 도구 알림 칸)를 두고, 글이 있을 때만 보입니다 */}
      {report && <p role="status">{note}</p>}
    </>
  );
}
