/**
 * 리포트 차트 (리더). 유의성 게이트가 받은 일별 환율(movement.series)로 "최근 30일 선 + 평소 폭 띠 + 기간 안의 뉴스 점" 을 만듭니다.
 * 숫자는 모두 코드가 계산한 것이고, 선의 출처는 게이트의 C 번호(일별 환율 주소), 뉴스 점의 출처는 기사의 E 번호입니다.
 * 화면은 app/components/ReportChart.tsx 가 그립니다. 모양은 schema.ts 의 chartSchema.
 */
import { areaTools } from "./plan";
import { SERIES_DAYS, type Movement } from "./movement";
import type { Chart, Evidence } from "./schema";

/** 뉴스 점 라벨 길이 */
const LABEL_MAX = 28;
/** 차트에 올리는 뉴스 점 최대 수 (많으면 겹침) */
const EVENTS_MAX = 4;

/** 표시 단위 배수: "JPY(100)/KRW" 는 받은 환율(1엔)을 100엔 기준으로 */
export function displayScale(pair: string): number {
  const m = /\((\d+)\)/.exec(pair);
  return m ? Number(m[1]) : 1;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 환율 차트. id 는 게이트 장부 항목(C 번호). 뉴스 점은 장부의 기사 중 차트 기간 안에 나온 것(끝은 시차로 하루 여유)만, 오래된 순으로 최대 EVENTS_MAX 개.
 * series 가 비어 있으면(받은 일별 환율이 없음) null
 */
export function fxChart(m: Movement, id: string, evidence: Evidence[]): Chart | null {
  if (m.series.length === 0) return null;
  const scale = displayScale(m.pair);
  const points = m.series.map((r) => ({ t: r.date, v: Math.round(r.rate * scale * 100) / 100 }));
  const start = points[0]!.t;
  const end = m.period.to;
  const windowDays = Math.max(SERIES_DAYS, m.period.days);
  const events = evidence
    .filter((e) => e.tool === areaTools.news)
    .map((e) => ({ ref: e.id, label: clip(String(e.values.title ?? e.label), LABEL_MAX), at: String(e.values.publishedAt ?? "").slice(0, 10) }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.at) && e.at >= start && e.at <= end)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, EVENTS_MAX);
  const typical = m.typicalPct / 100;
  const currency = m.pair.split("/")[0] ?? m.pair;
  const code = currency.replace(/\(\d+\)/, "");
  return {
    kind: "line",
    title: `${m.pair} 최근 ${windowDays}일`,
    unit: `KRW per ${scale === 1 ? "1" : String(scale)} ${code}`,
    series: [{ label: m.pair, ref: id, points }],
    ...(events.length ? { events } : {}),
    band: {
      from: m.period.from,
      to: m.period.to,
      low: Math.round(m.rates.from * (1 - typical) * 100) / 100,
      high: Math.round(m.rates.from * (1 + typical) * 100) / 100,
      label: `평소 폭 ±${m.typicalPct.toFixed(2)}% (직전 90일 기준)`,
    },
  };
}

