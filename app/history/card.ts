/**
 * 보관함 카드에 보일 것 (11/25 보관함 카드 정리). page.tsx 는 페이지 외 이름을 내보낼 수 없어 따로 둡니다.
 */
import type { ReportRecord } from "@/src/lib/history";
import { prettyDates } from "../components/format";
import { homeAreaLabel, splitAreaPrefix } from "../components/home-form";
import { evidenceCategory } from "../components/reportCategory";

/** 영역 칩에 쓰는 자료 분류 (계산 · 기타 자료는 영역이 아니라 뺌) */
const AREA_CATEGORIES = ["환율", "금리", "물가", "ETF", "뉴스", "지수"];

/** 카드 한 줄 요약: 리포트 머리말, 없으면 요약 첫 문장 */
export function cardLine(report: ReportRecord["report"]): string {
  const headline = report.headline?.trim();
  if (headline) return prettyDates(headline);
  const summary = report.summary.trim();
  const first = /^.*?[.!?](?=\s|$)/.exec(summary)?.[0] ?? summary;
  return prettyDates(first);
}

/**
 * 카드 영역 칩: 고른 영역이 있으면 그 이름, 영역 없이(Auto) 물었으면 리포트가 쓴 자료의 영역을 앞에서 둘까지.
 * 쓴 자료가 없으면 칩을 빼도록 null ('Auto 머핀' 만으로는 무엇을 본 리포트인지 알 수 없었음)
 */
export function cardArea(record: Pick<ReportRecord, "input" | "report">): string | null {
  if (record.input.area || splitAreaPrefix(record.input.question).areas.length > 0) return homeAreaLabel(record.input);
  const used = [...new Set(record.report.evidence.map(evidenceCategory))].filter(category => AREA_CATEGORIES.includes(category));
  return used.length > 0 ? used.slice(0, 2).join(" · ") : null;
}
