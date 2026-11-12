/**
 * 리포트 차트 (리더). 데이터는 src/agent/chart.ts 가 만든 Report.charts 한 항목이고, 여기서는 그리기만 합니다 (숫자를 새로 계산하지 않음).
 * 선(일별 값) · 평소 폭 띠(유의성 게이트의 ±폭, 이번 기간 구간) · 뉴스 점(기간 안의 기사)을 inline SVG 로 그립니다.
 * 접근성: figure + 설명 문장(figcaption)과 role="img" 요약. 색은 globals.css 의 변수.
 */
import type { Chart, Evidence } from "@/src/agent/schema";


const W = 640;
const H = 280;
const PAD = { top: 42, right: 16, bottom: 48, left: 56 };

const day = (t: string) => Date.parse(`${t}T00:00:00Z`) / 86_400_000;
const fmtDate = (t: string) => `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}`;
const longDate = (t: string) => `${Number(t.slice(5, 7))}월 ${Number(t.slice(8, 10))}일`;
const fmtValue = (v: number) => v.toLocaleString("ko-KR", { maximumFractionDigits: v >= 1000 ? 0 : 2 });

export function ReportChart({ chart }: { chart: Chart; evidence: Evidence[] }) {
  const series = chart.series[0];
  if (!series || series.points.length < 2) return null;
  const points = series.points;
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
  const change = from.v ? ((last.v / from.v - 1) * 100).toFixed(2) : null;
  const subject = /USD\/KRW|환율/.test(chart.title) ? "환율" : /금리/.test(chart.title) ? "금리" : /물가/.test(chart.title) ? "물가" : "지표";
  const unitLabel = chart.unit === "KRW per 1 USD" ? "1달러당 원화 금액(원)" : chart.unit || "지표 값";
  const summary = `${chart.title}: ${fmtDate(from.t)} ${fmtValue(from.v)} 에서 ${fmtDate(last.t)} ${fmtValue(last.v)}${change ? ` (${Number(change) >= 0 ? "+" : ""}${change}%)` : ""}${band ? `. ${band.label}: ${fmtValue(band.low)}~${fmtValue(band.high)}` : ""}${events.length ? `. 뉴스 ${events.length}건 표시` : ""}`;

  return (
    <figure className="chart">
      <figcaption>
        <b>{subject} 변화를 확인해 보세요</b>

      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="chart-svg">
        <g className="chart-axis-guide"><text x={PAD.left} y={22}>{unitLabel}</text><text x={W - PAD.right} y={H - 10} textAnchor="end">날짜</text></g>
        {band && (
          <g className="chart-band">
            <rect x={sx(band.from)} y={sy(band.high)} width={Math.max(2, sx(band.to) - sx(band.from))} height={Math.max(2, sy(band.low) - sy(band.high))} rx={3} />

          </g>
        )}
        {ticks.map((v) => (
          <g key={v} className="chart-grid">
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} />
            <text x={PAD.left - 6} y={sy(v) + 4} textAnchor="end">{fmtValue(v)}</text>
          </g>
        ))}
        <path d={path} className="chart-line" />
        <circle cx={sx(last.t)} cy={sy(last.v)} r={4} className="chart-last" />
        <text x={Math.min(sx(last.t) + 6, W - PAD.right - 40)} y={sy(last.v) - 8} className="chart-last-label">{fmtValue(last.v)}</text>
        {events.map((e) => (
          <g key={`${e.ref}-${e.at}`} className="chart-event">
            <line x1={sx(e.at)} x2={sx(e.at)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle cx={sx(e.at)} cy={PAD.top + 6} r={4}>
              <title>{`${fmtDate(e.at)} ${e.label}`}</title>
            </circle>
          </g>
        ))}
        <g className="chart-axis">
          <text x={PAD.left} y={H - 28} textAnchor="start">{fmtDate(first.t)}</text>
          {/* 기간 시작 날짜는 양 끝 라벨과 겹치지 않을 때만 */}
          {band && sx(band.from) - PAD.left > 48 && W - PAD.right - sx(band.from) > 48 && (
            <text x={sx(band.from)} y={H - 28} textAnchor="middle">{fmtDate(band.from)}</text>
          )}
          <text x={W - PAD.right} y={H - 28} textAnchor="end">{fmtDate(last.t)}</text>
        </g>
      </svg>
      <div className="chart-summary">
        <p><strong>{subject}이 {fmtValue(from.v)}에서 {fmtValue(last.v)}로{change !== null ? ` ${Math.abs(Number(change)).toFixed(2)}% ${Number(change) > 0 ? "올랐어요" : Number(change) < 0 ? "내렸어요" : "변화 없이 유지됐어요"}` : " 바뀌었어요"}.</strong><span className="chart-period">{longDate(first.t)}부터 {longDate(last.t)}까지 {Math.round(day(last.t) - day(first.t))}일간의 {subject} 변화 그래프예요. {chart.unit === "KRW per 1 USD" ? "1달러당 원화 금액을 원 단위로 표시했어요." : `${unitLabel} 기준으로 표시했어요.`}</span></p>
        {band && <div className="chart-context"><strong>과거 움직임과 비교하기</strong><p>보라색 띠는 {band.label}을 적용한 비교 범위예요. 마지막 값은 이 범위{last.v > band.high ? "보다 높아요" : last.v < band.low ? "보다 낮아요" : " 안에 있어요"}.</p></div>}
      {events.length > 0 && (
        <ul className="chart-events">
          {events.map((e) => (
            <li key={`${e.ref}-${e.at}`}>
              <span aria-hidden="true">＊ </span><span className="chart-event-date">{fmtDate(e.at)}</span> {e.label} 관련 보도가 나온 시점이에요.

            </li>
          ))}
        </ul>
      )}

      </div>
    </figure>
  );
}
