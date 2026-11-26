import { describe, expect, it } from "vitest";
import recording from "../replays/rate-compare.json";
import { CSV_HEADER, reportToCsv, reportToMarkdown } from "./report-export";
import type { Report } from "../agent/schema";

const real = recording.report as unknown as Report;

/** 표 · CSV 가 깨질 만한 글자를 넣은 리포트 */
const tricky: Report = {
  ...real,
  notice: undefined,
  headline: "환율은 1,344.33원이에요",
  summary: "원/달러 환율은 \"평소 범위\" 안이에요.\n둘째 줄이에요.",
  numbers: [
    { label: "달러 | 원", value: "1,344.33원", change: "30일 +1.49%", asOf: "2026-11-25", ref: "E1", check: "verified" },
    { label: "=HYPERLINK(\"http://x\")", value: "-3.54%", change: "+계산", asOf: "2026-11-25", ref: null, check: "derived" },
  ],
  why: [{ claim: "외국인 매도", evidence: "기사 제목", basis: "news", refs: ["E2-1"] }],
  impact: ["해외 결제가 늘어요."],
  impactTitles: ["해외 결제"],
  caveats: ["기준 환율이에요."],
  dataGaps: [],
  sources: [{ id: "S1", name: "Frankfurter", url: "https://api.frankfurter.dev/v2", asOf: "2026-11-25" }],
  evidence: [{ id: "E1", tool: "get_fx_krw_rate", label: "환율", values: {}, source: { name: "Frankfurter, 유럽중앙은행", url: "https://api.frankfurter.dev/v2", asOf: "2026-11-25" } }],
};

describe("리포트 내보내기 (11/26, 스터디 결과물 'Notion / Google Sheets Export')", () => {
  it("Markdown: 질문 제목 · 한 줄 · 요약 · 숫자 표 · 원인 · 영향 · 주의점 · 출처 · 고지 순서 (실제 녹화 리포트)", () => {
    const md = reportToMarkdown(real, { question: recording.question, createdAt: recording.recordedAt, url: "https://muffin-kappa.vercel.app/report/abc" });
    expect(md.startsWith(`# ${recording.question}\n`)).toBe(true);
    expect(md).toContain("머핀랩 리포트 · ");
    // 표는 줄바꿈 하나로 이어야 Markdown 표가 됩니다 (빈 줄이 끼면 줄마다 문단)
    expect(md).toContain("## 오늘의 숫자\n\n| 항목 | 값 | 변화 | 기준일 | 출처 |\n| --- | --- | --- | --- | --- |\n| ");
    expect(md).not.toMatch(/\|\n\n\|/);
    for (const n of real.numbers) expect(md).toContain(`| ${n.label.replace(/\|/g, "\\|")} | ${n.value} |`);
    expect(md).toContain("## 출처");
    expect(md).toContain(real.disclosure);
    expect(md.trimEnd().endsWith("https://muffin-kappa.vercel.app/report/abc")).toBe(true);
    const order = ["## 오늘의 숫자", "## 출처", "\n---\n"].map((h) => md.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("Markdown: 표 칸의 | 와 줄바꿈을 지키고, 영향 제목 · 원인 근거 이름표를 붙인다", () => {
    const md = reportToMarkdown(tricky, { question: "환율 어때?" });
    expect(md).toContain("| 달러 \\| 원 | 1,344.33원 | 30일 +1.49% | 2026-11-25 | Frankfurter, 유럽중앙은행 (값 대조) |");
    expect(md).toContain("| 계산값 |");
    expect(md).toContain("- **외국인 매도** (보도 기반) — 기사 제목");
    expect(md).toContain("## 나에게 어떤 의미일까요\n\n- **해외 결제**: 해외 결제가 늘어요.");
    expect(md).toContain("- [Frankfurter](https://api.frankfurter.dev/v2) · 2026-11-25");
    expect(md).not.toContain("## 확인하지 못한 것");
  });

  it("CSV: BOM · 머리줄 · 카드마다 한 줄 (출처 이름 · 링크 · 확인), 줄 끝 CRLF", () => {
    const csv = reportToCsv(real);
    expect(csv.startsWith("﻿항목,값,변화,기준일,출처,출처 링크,확인\r\n")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(real.numbers.length + 1);
    expect(lines[0]!.split(",")).toEqual([...CSV_HEADER]);
  });

  it("CSV: 쉼표 · 따옴표를 감싸고, 수식으로 읽힐 글은 ' 를 붙이되 부호 있는 숫자는 그대로", () => {
    const rows = reportToCsv(tricky).slice(1).trimEnd().split("\r\n");
    expect(rows[1]).toBe('달러 | 원,"1,344.33원",30일 +1.49%,2026-11-25,"Frankfurter, 유럽중앙은행",https://api.frankfurter.dev/v2,값 대조');
    expect(rows[2]).toBe(`"'=HYPERLINK(""http://x"")",-3.54%,'+계산,2026-11-25,,,계산값`);
  });
});
