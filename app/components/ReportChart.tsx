"use client";
/**
 * 리포트 차트 (리더). 데이터는 src/agent/chart.ts 가 만든 Report.charts 한 항목이고, 여기서는 그리기만 합니다 (숫자를 새로 계산하지 않음).
 * 선(일별 값) · 평소 폭 띠(유의성 게이트의 ±폭, 이번 기간 구간) · 뉴스 점(기간 안의 기사)을 inline SVG 로 그립니다.
 * 접근성: figure + 설명 문장(figcaption)과 role="img" 요약. 색은 globals.css 의 변수.
 * 11/21 사용자 요청: 선 위에 마우스를 올리거나 손가락으로 짚으면 가장 가까운 날의 날짜 · 값을 보여 줍니다 (값은 장부 그대로).
 */
import { useState } from "react";
import { newsNoun, prettyDates, titleWithoutPublisher } from "./format";
import { PrintOpenDetails } from "./ReportResponsiveDetails";
import type { Chart, Evidence } from "@/src/agent/schema";


const W = 640;
const H = 280;
const PAD = { top: 42, right: 16, bottom: 48, left: 68 }; // 휴대폰에서 세로축 숫자(9,115)가 왼쪽에서 잘리지 않게 56 → 68 (11/23)

const day = (t: string) => Date.parse(`${t}T00:00:00Z`) / 86_400_000;
const fmtDate = (t: string) => `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}`;
const longDate = (t: string) => `${Number(t.slice(5, 7))}월 ${Number(t.slice(8, 10))}일`;
const fmtValue = (v: number) => v.toLocaleString("ko-KR", { maximumFractionDigits: v >= 1000 ? 0 : 2 });
const CURRENCY_KO: Record<string, string> = { USD: "달러", JPY: "엔", EUR: "유로", CNY: "위안", GBP: "파운드" };
/** "KRW per 100 JPY" → "100엔당 원화 금액". 환율 단위가 아니면 null */
export function fxUnitLabel(unit: string | undefined): string | null {
  const m = /^KRW per (\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(unit ?? "");
  if (!m) return null;
  return `${Number(m[1]).toLocaleString("ko-KR")}${CURRENCY_KO[m[2]!] ?? m[2]}당 원화 금액`;
}

/** 받침 유무에 따라 '이' · '가' (11/22 운영 확인: 지수 차트에 "지표이" 로 나옴) */
export function particle(word: string): "이" | "가" {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}
/** 숫자 뒤 '로' · '으로'. 끝자리 소리로 고릅니다: 0(십 · 백 · 천 · 만) · 3(삼) · 6(육) 은 받침이 있어 '으로', 나머지는 '로' (ㄹ 받침 1 · 7 · 8 포함) */
export function roParticle(numberText: string): "로" | "으로" {
  const last = numberText.replace(/\D/g, "").at(-1);
  return last !== undefined && "036".includes(last) ? "으로" : "로";
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** 긴 차트(1년)의 가운데 눈금: 다음 달 1일부터 2 · 3달 간격, 양 끝 라벨과 겹치지 않는 것만 */
export function monthTicks(firstT: string, lastT: string, sx: (t: string) => number, left: number, right: number): string[] {
  const span = day(lastT) - day(firstT);
  if (span <= 120) return [];
  const step = span > 300 ? 3 : 2;
  const ticks: string[] = [];
  for (let d = new Date(Date.UTC(Number(firstT.slice(0, 4)), Number(firstT.slice(5, 7)), 1)); iso(d) < lastT; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1))) {
    const t = iso(d);
    const x = sx(t);
    if (x - left > 64 && right - x > 64) ticks.push(t);
  }
  return ticks;
}
/** 화면 x(뷰박스 단위)에 가장 가까운 점의 번호 */
export function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  for (let index = 1; index < xs.length; index++) if (Math.abs(xs[index]! - x) < Math.abs(xs[best]! - x)) best = index;
  return best;
}
const TIP_W = 170;
const TIP_H = 28;

/** 월 단위 점("2026-10")은 그달 1일로 둡니다 (물가 상승률 추이 같은 월별 차트, 11/23) */
const normT = (t: string) => (/^\d{4}-\d{2}$/.test(t) ? `${t}-01` : t);
/** 값이 비율(%)인 차트: 변화는 %p 차이로 말하고 눈금 · 값에 % 를 붙입니다 */
export const isRateUnit = (unit: string | undefined) => (unit ?? "").trim() === "%";
// 카드 값과 같은 꼴로: 부호는 "-", 소수 둘째 자리까지 ("-21.10%"). 11/23 운영 검수: 카드 "-21.10%" · 막대 "−21.1%" 로 달랐음
const signed = (v: number, suffix: string) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;

/**
 * 막대 차트 (11/23 백엔드 요청: 대표 ETF 비교 등). 시리즈가 여럿이면 시리즈마다 막대 하나(마지막 점의 값),
 * 하나뿐이면 점마다 막대 하나. 값은 장부 그대로이고 0 을 기준으로 오른쪽(오름 · 빨강) · 왼쪽(내림 · 파랑)으로 그립니다.
 */
export function BarChart({ chart }: { chart: Chart }) {
  const rate = isRateUnit(chart.unit);
  const monthly = chart.series.length === 1 && chart.series[0]!.points.every((p) => /^\d{4}-\d{2}(-01)?$/.test(p.t));
  const bars = chart.series.length > 1
    ? chart.series.flatMap((s) => { const lastPoint = s.points.at(-1); return lastPoint ? [{ key: `${s.ref}-${s.label}`, label: s.label, v: lastPoint.v, t: normT(lastPoint.t) }] : []; })
    : (chart.series[0]?.points ?? []).map((p) => { const t = normT(p.t); return { key: t, label: monthly ? `${t.slice(0, 4)}년 ${Number(t.slice(5, 7))}월` : `${t.slice(0, 4)}년 ${longDate(t)}`, v: p.v, t }; });
  if (bars.length < 2) return null;
  const fmt = (v: number) => (rate ? signed(v, "%") : `${fmtValue(v)}${chart.unit && chart.unit !== "%" ? ` ${chart.unit}` : ""}`);
  const min = Math.min(0, ...bars.map((b) => b.v));
  const max = Math.max(0, ...bars.map((b) => b.v));
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  const top = bars.reduce((a, b) => (b.v > a.v ? b : a));
  const bottom = bars.reduce((a, b) => (b.v < a.v ? b : a));
  const sameDate = chart.series.length > 1 && bars.every((b) => b.t === bars[0]!.t);
  const tone = (v: number) => (v > 0 ? "tone-up" : v < 0 ? "tone-down" : "tone-flat");
  return (
    <figure className="chart chart-bar">
      <figcaption><b>{prettyDates(chart.title)}</b></figcaption>
      <ul className="bar-rows">
        {bars.map((b) => {
          const left = b.v >= 0 ? zero : ((b.v - min) / span) * 100;
          const width = (Math.abs(b.v) / span) * 100;
          return (
            <li key={b.key}>
              <span className="bar-label">{b.label}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-zero" style={{ left: `${zero}%` }} />
                <span className={`bar-fill ${tone(b.v)}`} style={{ left: `${left}%`, width: `${Math.max(width, b.v === 0 ? 0 : 0.8)}%` }} />
              </span>
              <b className={`bar-value ${rate ? tone(b.v) : ""}`}>{fmt(b.v)}</b>
            </li>
          );
        })}
      </ul>
      <div className="chart-summary">
        <p>
          <strong>가장 높은 것은 {top.label} {fmt(top.v)}, 가장 낮은 것은 {bottom.label} {fmt(bottom.v)}예요.</strong>
          <span className="chart-period">{sameDate ? `${bars[0]!.t.slice(0, 4)}년 ${longDate(bars[0]!.t)} 기준이에요. ` : ""}{rate ? "0 을 기준으로 오른쪽은 오름, 왼쪽은 내림이에요." : "값을 나란히 놓고 비교해 보세요."}</span>
        </p>
      </div>
    </figure>
  );
}

/**
 * 차트 사건 점이 가리키는 기사. 차트에는 28자로 자른 제목만 있어 같은 리포트의 기사 원본에서 전체 제목 · 언론사 · 주소를 찾습니다
 * (11/24 사용자: 차트 아래 기사 제목이 '…' 로 갑자기 끊겨 이상함)
 */
export function chartArticle(event: { ref: string; label: string }, evidence: Evidence[]): { title: string; publisher?: string; url?: string } {
  const entry = evidence.find((item) => item.id === event.ref);
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const publisher = text(entry?.values.publisher) ?? text(entry?.source.name);
  const title = titleWithoutPublisher(text(entry?.values.title) ?? event.label, publisher);
  const href = entry?.source.pageUrl ?? entry?.source.url;
  const url = href && /^https?:\/\//.test(href) ? href : undefined;
  return { title, publisher, url };
}

/**
 * 평소 범위 막대 (11/25 가독성 · 52주 범위 막대처럼): 띠의 아래 · 위 값 사이에 지금 값을 점으로 둡니다.
 * 범위를 벗어나면 막대를 늘려 바깥에 둡니다. 차트 아래 '보라색 띠는 …' 설명 문단을 대신합니다
 */
export function RangeBar({ band, value, valueText }: { band: NonNullable<Chart["band"]>; value: number; valueText: (v: number) => string }) {
  const lo = Math.min(band.low, value);
  const hi = Math.max(band.high, value);
  const pad = (hi - lo || Math.abs(value) || 1) * 0.12;
  const pct = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  const where = value > band.high ? "above" : value < band.low ? "below" : "in";
  const verdict = where === "in" ? "평소 범위 안이에요" : where === "above" ? "평소 범위보다 높아요" : "평소 범위보다 낮아요";
  const at = pct(value);
  // 끝 가까이에서는 '지금' 글씨가 막대 밖으로 나가지 않게 기준점을 옮깁니다
  const shift = at > 80 ? "-85%" : at < 20 ? "-15%" : "-50%";
  return (
    <div className="chart-range" data-where={where}>
      <p className="chart-range-head"><strong>평소 범위와 비교</strong><span className="chart-range-verdict">{verdict}</span></p>
      <div className="chart-range-bar" role="img" aria-label={`${band.label}: ${valueText(band.low)}~${valueText(band.high)}, 지금 ${valueText(value)} · ${verdict}`}>
        <span className="chart-range-band" style={{ left: `${pct(band.low)}%`, width: `${pct(band.high) - pct(band.low)}%` }} />
        <span className="chart-range-marker" style={{ left: `${at}%` }}><span className="chart-range-now" style={{ transform: `translateX(${shift})` }}>지금 {valueText(value)}</span></span>
      </div>
      <div className="chart-range-scale" aria-hidden="true">
        <span style={{ left: `${pct(band.low)}%` }}>{valueText(band.low)}</span>
        <span style={{ left: `${pct(band.high)}%` }}>{valueText(band.high)}</span>
      </div>
      <p className="chart-range-note">{band.label}</p>
    </div>
  );
}

export function ReportChart({ chart, evidence = [] }: { chart: Chart; evidence?: Evidence[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (chart.kind === "bar") return <BarChart chart={chart} />;
  const series = chart.series[0];
  if (!series || series.points.length < 2) return null;
  const monthly = series.points.every((p) => /^\d{4}-\d{2}(-01)?$/.test(p.t)) && series.points.length >= 3;
  const points = series.points.map((p) => ({ ...p, t: normT(p.t) }));
  const rate = isRateUnit(chart.unit);
  const valueText = (v: number) => `${fmtValue(v)}${rate ? "%" : ""}`;
  const xs = points.map((p) => day(p.t));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const values = points.map((p) => p.v);
  const band = chart.band;
  const lo = Math.min(...values, ...(band ? [band.low] : []));
  const hi = Math.max(...values, ...(band ? [band.high] : []));
  const margin = (hi - lo || 1) * 0.08;
  const y0 = lo - margin;
  const y1 = hi + margin;
  const sx = (t: string) => PAD.left + ((day(t) - x0) / Math.max(1, x1 - x0)) * (W - PAD.left - PAD.right);
  const sy = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const first = points[0]!;
  // 설명 문장의 변화는 리포트와 같은 기간: 띠(이번 기간)가 있으면 그 시작일 이후 첫 점부터
  const from = (band && points.find((p) => p.t >= band.from)) || first;
  const ticks = [y0 + margin, (y0 + y1) / 2, y1 - margin];
  const events = (chart.events ?? []).filter((e) => day(e.at) >= x0 && day(e.at) <= x1);
  const change = rate ? (last.v - from.v).toFixed(2) : from.v ? ((last.v / from.v - 1) * 100).toFixed(2) : null;
  const changeUnit = rate ? "%p" : "%";
  // 환율 차트는 통화마다 제목이 다르니(JPY(100)/KRW 최근 30일) 단위로 알아봅니다. 11/19 페르소나 테스트: 엔화 차트 설명에 "지표 이" 가 나옴
  const fxLabel = fxUnitLabel(chart.unit);
  const subject = fxLabel || /\/KRW|환율/.test(chart.title) ? "환율" : /금리/.test(chart.title) ? "금리" : /물가/.test(chart.title) ? "물가" : /지수|코스피|코스닥|S&P|나스닥|다우/i.test(`${chart.title} ${chart.unit ?? ""}`) ? "지수" : "지표";
  const subjectWithParticle = `${subject}${particle(subject)}`;
  const unitLabel = fxLabel ? `${fxLabel}(원)` : chart.unit || "지표 값";
  // 1년 차트(11/23 백엔드 #144 관계 질문): 양 끝이 "11/20 · 11/20" 처럼 같아 보이지 않게 해가 바뀌면 연도를 붙입니다
  const spanDays = Math.round(x1 - x0);
  const multiYear = first.t.slice(0, 4) !== last.t.slice(0, 4);
  const dateY = (t: string) => (monthly ? `${t.slice(0, 4)}년 ${Number(t.slice(5, 7))}월` : multiYear ? `${t.slice(0, 4)}년 ${longDate(t)}` : longDate(t));
  const axisDate = (t: string) => (monthly ? (multiYear ? `${t.slice(2, 4)}.${Number(t.slice(5, 7))}` : `${Number(t.slice(5, 7))}월`) : multiYear ? `${t.slice(2, 4)}.${Number(t.slice(5, 7))}.${Number(t.slice(8, 10))}` : fmtDate(t));
  // 월별 점은 달 수를 그대로 셉니다 (2025년 11월 ~ 2026년 10월 = 12개월 = 1년간)
  const monthCount = (Number(last.t.slice(0, 4)) - Number(first.t.slice(0, 4))) * 12 + Number(last.t.slice(5, 7)) - Number(first.t.slice(5, 7)) + 1;
  const periodText = monthly ? (monthCount === 12 ? "1년간" : `${monthCount}개월간`) : spanDays >= 350 && spanDays <= 380 ? "1년간" : spanDays > 62 ? `약 ${Math.round(spanDays / 30.4)}개월간` : `${spanDays}일간`;
  const ticksX = monthTicks(first.t, last.t, sx, PAD.left, W - PAD.right);
  // 지수 차트는 제목 앞의 지수 이름을 씁니다 ("코스피 2025-11-20 ~ 2026-11-20" → 코스피)
  const titleName = chart.title.replace(/\s*\(.*$/, "").replace(/\s*\d{4}-\d{2}(-\d{2})?.*$/, "").trim() || null;
  const name = subject === "지수" || rate ? titleName : null;
  const lead = name ? (subject === "지수" && !rate ? `${name} 지수가` : `${name}${particle(name)}`) : subjectWithParticle;
  const tipWidth = multiYear ? 210 : TIP_W;
  const pointXs = points.map((p) => sx(p.t));
  // 화면 좌표 → 뷰박스 좌표. SVG 가 넓은 칸 가운데 놓이면 가로 여백이 생기므로 너비 비율이 아니라 변환 행렬로 바꿉니다 (Codex 리뷰)
  const locate = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    if (!svg) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    setHover(nearestIndex(pointXs, point.x));
  };
  const hovered = hover === null ? null : points[hover] ?? null;
  const tipText = hovered ? `${dateY(hovered.t)} · ${valueText(hovered.v)}` : null;
  const tipX = hovered ? sx(hovered.t) : 0;
  const tipLeft = tipX + 12 + tipWidth > W - PAD.right ? tipX - 12 - tipWidth : tipX + 12;
  const summary = `${chart.title}: ${dateY(from.t)} ${valueText(from.v)} 에서 ${dateY(last.t)} ${valueText(last.v)}${change ? ` (${Number(change) >= 0 ? "+" : ""}${change}${changeUnit})` : ""}${band ? `. ${band.label}: ${fmtValue(band.low)}~${fmtValue(band.high)}` : ""}${events.length ? `. 뉴스 ${events.length}건 표시` : ""}`;

  return (
    <figure className="chart">
      <figcaption>
        {/* 월별 차트는 열두 달이 다 있을 때만 '1년' (11/23 백엔드 #151: 미국 물가는 11점이라 설명의 '11개월간' 과 어긋남) */}
        <b>{name ?? subject}{(monthly ? monthCount >= 12 : spanDays >= 300) ? " 1년" : ""} 변화를 확인해 보세요</b>

      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="chart-svg" onMouseLeave={() => setHover(null)}>
        <g className="chart-axis-guide"><text x={PAD.left} y={22}>{unitLabel}</text><text x={W - PAD.right} y={H - 10} textAnchor="end">날짜</text></g>
        {band && (
          <g className="chart-band">
            <rect x={sx(band.from)} y={sy(band.high)} width={Math.max(2, sx(band.to) - sx(band.from))} height={Math.max(2, sy(band.low) - sy(band.high))} rx={3} />
            {/* 띠에 이름을 바로 씁니다 (11/25 가독성: 범례 문장 대신, Datawrapper 식 주석) */}
            {sx(band.to) - sx(band.from) > 80 && sy(band.low) - sy(band.high) > 22 && <text x={sx(band.from) + 8} y={sy(band.high) + 16} className="chart-band-label">평소 범위</text>}

          </g>
        )}
        {ticks.map((v) => (
          <g key={v} className="chart-grid">
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} />
            <text x={PAD.left - 6} y={sy(v) + 4} textAnchor="end">{valueText(v)}</text>
          </g>
        ))}
        {ticksX.map((t) => <line key={t} className="chart-month-line" x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={H - PAD.bottom} />)}
        <path d={path} className={points.length > 120 ? "chart-line chart-line-dense" : "chart-line"} />
        <circle cx={sx(last.t)} cy={sy(last.v)} r={4} className="chart-last" />
        {/* 마지막 점은 늘 오른쪽 끝이라 라벨을 점 왼쪽 위에 끝 맞춤 (휴대폰에서 글씨가 커지면 "4,870" 이 잘리던 것) */}
        <text x={sx(last.t) - 8} y={sy(last.v) - 10} textAnchor="end" className="chart-last-label">{valueText(last.v)}</text>
        {/* 마우스 · 손가락 위치를 받는 투명 판. 뉴스 점은 이 위에 그려 제목 풍선이 살아 있습니다 */}
        <rect className="chart-hover-target" x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} fill="transparent"
          onMouseMove={(event) => locate(event.clientX, event.clientY, event.currentTarget.ownerSVGElement)}
          onTouchStart={(event) => { const touch = event.touches[0]; if (touch) locate(touch.clientX, touch.clientY, event.currentTarget.ownerSVGElement); }}
          onTouchMove={(event) => { const touch = event.touches[0]; if (touch) locate(touch.clientX, touch.clientY, event.currentTarget.ownerSVGElement); }} />
        {hovered && (
          <g className="chart-hover" aria-hidden="true" pointerEvents="none">
            <line x1={tipX} x2={tipX} y1={PAD.top} y2={H - PAD.bottom} />
            <circle cx={tipX} cy={sy(hovered.v)} r={5} />
            <g className="chart-tip" transform={`translate(${tipLeft}, ${PAD.top + 4})`}>
              <rect width={tipWidth} height={TIP_H} rx={6} />
              <text x={tipWidth / 2} y={19} textAnchor="middle">{tipText}</text>
            </g>
          </g>
        )}
        {events.map((e) => (
          <g key={`${e.ref}-${e.at}`} className="chart-event">
            <line x1={sx(e.at)} x2={sx(e.at)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle cx={sx(e.at)} cy={PAD.top + 6} r={4}>
              <title>{`${axisDate(e.at)} ${chartArticle(e, evidence).title}`}</title>
            </circle>
          </g>
        ))}
        <g className="chart-axis">
          <text x={PAD.left} y={H - 28} textAnchor="start">{axisDate(first.t)}</text>
          {ticksX.map((t, index) => <text key={t} x={sx(t)} y={H - 28} textAnchor="middle">{index === 0 || t.slice(0, 4) !== ticksX[index - 1]!.slice(0, 4) ? (t.slice(0, 4) !== first.t.slice(0, 4) ? `${t.slice(2, 4)}년 ` : "") : ""}{Number(t.slice(5, 7))}월</text>)}
          {/* 기간 시작 날짜는 양 끝 라벨과 겹치지 않을 때만 */}
          {band && sx(band.from) - PAD.left > 48 && W - PAD.right - sx(band.from) > 48 && (
            <text x={sx(band.from)} y={H - 28} textAnchor="middle">{axisDate(band.from)}</text>
          )}
          <text x={W - PAD.right} y={H - 28} textAnchor="end">{axisDate(last.t)}</text>
        </g>
      </svg>
      {/* 11/25 사용자: '선을 짚으면…' 안내는 뺌. 짚은 날 값만 (PC 는 차트 말풍선, 휴대폰은 이 줄) */}
      <p className="chart-hover-text" aria-live="polite">{tipText}</p>
      <div className="chart-summary">
        <p><strong>{lead} {valueText(from.v)}에서 {valueText(last.v)}{rate ? "로" : roParticle(fmtValue(last.v))}{change !== null ? ` ${Math.abs(Number(change)).toFixed(2)}${changeUnit} ${Number(change) > 0 ? "올랐어요" : Number(change) < 0 ? "내렸어요" : "변화 없이 유지됐어요"}` : " 바뀌었어요"}.</strong>{from.t !== first.t && <span className="chart-period">변화율 비교 기간: {dateY(from.t)}부터 {dateY(last.t)}까지 ({Math.round(day(last.t) - day(from.t))}일)</span>}{/* 단위는 차트 왼쪽 위 축 이름에 있어 기간만 (11/25 가독성) */}<span className="chart-period">{dateY(first.t)}부터 {dateY(last.t)}까지 {periodText}</span></p>
        {band && <RangeBar band={band} value={last.v} valueText={valueText} />}
      {/* 차트 위 빨간 점의 기사. 접어 두고, 펼치면 전체 제목을 기사 링크로 (11/24: '…' 로 끊긴 제목 목록 대신) */}
      {events.length > 0 && (
        <PrintOpenDetails className="chart-news" summary={<><span className="chart-news-dot" aria-hidden="true" />이 기간 관련 {newsNoun(events.map(e => evidence.find(entry => entry.id === e.ref)))} {events.length}건</>}>
          <ul className="chart-events">
            {events.map((e) => {
              const article = chartArticle(e, evidence);
              return (
                <li key={`${e.ref}-${e.at}`}>
                  <span className="chart-event-date">{axisDate(e.at)}</span>
                  <span className="chart-event-title">
                    {article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title} <span aria-hidden="true">↗</span></a> : article.title}
                    {article.publisher && <small>{article.publisher}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
        </PrintOpenDetails>
      )}

      </div>
    </figure>
  );
}
