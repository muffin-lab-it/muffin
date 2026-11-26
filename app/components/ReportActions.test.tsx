import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY_DONE, COPY_FAILED, copyForNotion, csvFile, exportLink, pdfTitle, ReportActions } from "./ReportActions";
import recording from "@/src/replays/rate-compare.json";
import type { Report } from "@/src/agent/schema";

const report = recording.report as unknown as Report;

describe("리포트 동작 버튼", () => {
  it("보관은 자동이라 PDF 버튼만 있다 (11/20)", () => {
    const $ = load(renderToStaticMarkup(<ReportActions question="요즘 환율 왜 올라?" createdAt="2026-11-20T03:00:00Z" />));
    expect($("button").map((_, el) => $(el).text()).get()).toEqual(["PDF로 담기"]);
    expect($.text()).not.toContain("보관");
  });
  it("PDF 기본 파일명은 MuffinLab_날짜_질문 (11/21 서영 2)", () => {
    expect(pdfTitle("요즘 환율 왜 올라?", "2026-11-20T03:00:00Z")).toBe("MuffinLab_261120_요즘 환율 왜 올라");
    expect(pdfTitle("a/b:c*d?e\"f<g>h|i", "2026-11-20T16:30:00Z")).toBe("MuffinLab_261121_a b c d e f g h i");
    expect(pdfTitle("", "bad date", new Date("2026-11-21T00:00:00Z"))).toBe("MuffinLab_261121");
    expect(pdfTitle("가".repeat(40), "2026-11-20T03:00:00Z")).toBe(`MuffinLab_261120_${"가".repeat(30)}`);
  });
});

describe("리포트 내보내기 버튼 (11/26, Notion · 구글 시트)", () => {
  it("리포트가 있으면 PDF 옆에 'Notion에 붙여 넣기' · '시트용 CSV 받기', 숫자 카드가 없으면 CSV 는 숨김", () => {
    let $ = load(renderToStaticMarkup(<ReportActions question={recording.question} createdAt={recording.recordedAt} report={report} />));
    expect($("button").map((_, el) => $(el).text()).get()).toEqual(["PDF로 담기", "Notion에 붙여 넣기", "시트용 CSV 받기"]);
    expect($("[role=status]").text()).toBe("");
    $ = load(renderToStaticMarkup(<ReportActions question={recording.question} createdAt={recording.recordedAt} report={{ ...report, numbers: [] }} />));
    expect($("button").map((_, el) => $(el).text()).get()).toEqual(["PDF로 담기", "Notion에 붙여 넣기"]);
  });

  it("Notion 복사는 Markdown 을 클립보드에 쓰고, 실패하거나 클립보드가 없으면 실패 문구", async () => {
    const written: string[] = [];
    const ok = { writeText: async (text: string) => { written.push(text); } };
    expect(await copyForNotion(report, { question: recording.question, createdAt: recording.recordedAt, url: "https://muffin-kappa.vercel.app/report/abc" }, ok)).toBe(COPY_DONE);
    expect(written[0]!.startsWith(`# ${recording.question}\n`)).toBe(true);
    expect(written[0]).toContain("https://muffin-kappa.vercel.app/report/abc");
    expect(await copyForNotion(report, {}, { writeText: async () => { throw new Error("denied"); } })).toBe(COPY_FAILED);
    expect(await copyForNotion(report, {}, undefined)).toBe(COPY_FAILED);
  });

  it("시트용 CSV 는 PDF 와 같은 이름에 .csv, UTF-8 CSV", async () => {
    const { name, blob } = csvFile(report, "요즘 환율 왜 올라?", "2026-11-20T03:00:00Z");
    expect(name).toBe("MuffinLab_261120_요즘 환율 왜 올라.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const text = await blob.text();
    expect(text.split("\r\n")[0]).toContain("항목,값,변화,기준일,출처,출처 링크,확인");
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(report.numbers.length + 1);
  });
});

describe("내보낸 글의 리포트 주소 (#181 Codex 리뷰)", () => {
  it("화면이 넘긴 주소가 있으면 그것(상대 주소는 지금 주소 기준), 없으면 지금 주소", () => {
    // 다시 보기 목록에서 고르면 주소가 /replay 그대로라, 고른 녹화의 주소를 넘김
    expect(exportLink("/replay?id=fx-cause", "https://muffin-kappa.vercel.app/replay")).toBe("https://muffin-kappa.vercel.app/replay?id=fx-cause");
    expect(exportLink("/replay?id=macro-cause", "https://muffin-kappa.vercel.app/replay?id=fx-cause&speed=10")).toBe("https://muffin-kappa.vercel.app/replay?id=macro-cause");
    expect(exportLink(undefined, "https://muffin-kappa.vercel.app/report/abc")).toBe("https://muffin-kappa.vercel.app/report/abc");
  });
});
