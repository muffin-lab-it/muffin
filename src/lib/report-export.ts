/**
 * 리포트 내보내기 (리더, 11/26).
 *
 * 스터디 목표의 결과물 "선택적으로 Notion / Google Sheets Export" 를 로그인 · 키 없이 채웁니다.
 * Notion · 구글 시트에 직접 쓰려면 OAuth 연결이 필요하지만 머핀에는 로그인이 없어, 화면이 브라우저 안에서 이 함수로 바꿔
 *  - Markdown 을 클립보드에 복사 → Notion 에 붙여 넣으면 제목 · 목록 · 표가 블록이 됩니다
 *  - 숫자 카드를 CSV 로 내려받기 → 구글 시트 · 엑셀에서 '가져오기' 로 엽니다
 * 서버를 거치지 않습니다 (보관함 API 는 브라우저 id 헤더가 필요해 링크 하나로 받는 방식이 맞지 않고, 주소에 id 를 넣으면 로그에 남음).
 * 화면과 같은 이름표(값 대조 · 계산값 · 기사 보도 · 원문 미대조, 데이터 인용 · 보도 기반 · 근거 부족)를 씁니다.
 */
import type { Report } from "../agent/schema";

export type ExportMeta = {
  /** 사용자가 물은 질문 (제목) */
  question?: string;
  /** 리포트를 만든 시각 (ISO) */
  createdAt?: string;
  /** 리포트 화면 주소 (있으면 맨 아래에) */
  url?: string;
};

const CHECK_LABELS: Record<Report["numbers"][number]["check"], string> = { verified: "값 대조", derived: "계산값", reported: "기사 보도", unverified: "원문 미대조" };
const BASIS_LABELS: Record<Report["why"][number]["basis"], string> = { data: "데이터 인용", news: "보도 기반", none: "근거 부족" };

/** 한국 날짜 · 시각 ("2026-11-26 14:05") */
function kstStamp(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

/** 숫자 카드가 가리키는 출처 (장부 항목의 출처 이름 · 링크 · 기준일) */
function sourceOf(report: Report, ref: string | null): { name: string; url: string; asOf: string } {
  const e = ref ? report.evidence.find((x) => x.id === ref) : undefined;
  return { name: e?.source.name ?? "", url: e?.source.url ?? "", asOf: e?.source.asOf ?? "" };
}

/** 표 칸 안의 글자: 줄바꿈은 띄어쓰기로, | 는 \| 로 */
const cell = (s: string) => s.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
/** 목록 한 줄: 줄바꿈은 띄어쓰기로 */
const line = (s: string) => s.replace(/\r?\n+/g, " ").trim();

/** 리포트 → Markdown (Notion 에 붙여 넣기용). 문단 · 제목 사이는 빈 줄, 표와 목록은 한 덩어리(줄바꿈 하나)로 둡니다 */
export function reportToMarkdown(report: Report, meta: ExportMeta = {}): string {
  const out: string[] = [];
  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    out.push(`## ${title}`, items.map((x) => `- ${x}`).join("\n"));
  };
  out.push(`# ${line(meta.question || report.headline || "머핀 리포트")}`);
  const stamp = kstStamp(meta.createdAt);
  out.push(`머핀랩 리포트${stamp ? ` · ${stamp} (한국 시간)` : ""}`);
  if (report.notice) out.push(`> ${line(report.notice)}`);
  if (report.headline) out.push(`**${line(report.headline)}**`);
  if (report.summary.trim()) out.push(report.summary.trim());

  if (report.numbers.length > 0) {
    const rows = report.numbers.map((n) => {
      const src = sourceOf(report, n.ref);
      return `| ${cell(n.label)} | ${cell(n.value)} | ${cell(n.change)} | ${cell(n.asOf)} | ${src.name ? `${cell(src.name)} (${CHECK_LABELS[n.check]})` : CHECK_LABELS[n.check]} |`;
    });
    out.push("## 오늘의 숫자", ["| 항목 | 값 | 변화 | 기준일 | 출처 |", "| --- | --- | --- | --- | --- |", ...rows].join("\n"));
  }
  list("왜 그럴까요", report.why.map((w) => `**${line(w.claim)}** (${BASIS_LABELS[w.basis]})${w.evidence.trim() ? ` — ${line(w.evidence)}` : ""}`));
  const titles = report.impactTitles && report.impactTitles.length === report.impact.length ? report.impactTitles : null;
  list("나에게 어떤 의미일까요", report.impact.map((text, i) => `${titles ? `**${line(titles[i]!)}**: ` : ""}${line(text)}`));
  list("주의할 점", report.caveats.map(line));
  list("확인하지 못한 것", report.dataGaps.map(line));
  list("출처", report.sources.map((s) => `${s.url ? `[${line(s.name)}](${s.url})` : line(s.name)}${s.asOf ? ` · ${s.asOf.slice(0, 10)}` : ""}`));
  out.push("---", line(report.disclosure));
  if (meta.url) out.push(meta.url);
  return `${out.join("\n\n")}\n`;
}

/** CSV 칸: 쉼표 · 따옴표 · 줄바꿈이 있으면 따옴표로 감쌈. 수식으로 읽힐 수 있는 글(= · @ 로 시작, 숫자가 아닌 + · -)은 ' 를 앞에 붙임 */
function csvField(value: string): string {
  let v = value.replace(/\r?\n+/g, " ").trim();
  const signedNumber = /^[+-]\d[\d,]*(?:\.\d+)?\s*(?:%p?|원|포인트|bp|달러|엔|유로)?$/;
  if (/^[=@]/.test(v) || (/^[+-]/.test(v) && !signedNumber.test(v))) v = `'${v}`;
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const CSV_HEADER = ["항목", "값", "변화", "기준일", "출처", "출처 링크", "확인"] as const;

/** 리포트의 숫자 카드 → CSV (구글 시트 · 엑셀 가져오기용). UTF-8 BOM 을 붙여 엑셀에서도 한글이 깨지지 않게, 줄 끝은 CRLF */
export function reportToCsv(report: Report): string {
  const rows: string[][] = [[...CSV_HEADER]];
  for (const n of report.numbers) {
    const src = sourceOf(report, n.ref);
    rows.push([n.label, n.value, n.change, n.asOf, src.name, src.url, CHECK_LABELS[n.check]]);
  }
  return `﻿${rows.map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`;
}
