/**
 * /admin 차트. 라이브러리 없이 서버에서 그립니다.
 * 막대 · 점 차트는 글자가 화면 폭에 따라 작아지지 않게 HTML 로, 작은 선 그래프만 SVG 로 그립니다.
 */
import type { Bucket, LatencyPoint } from "@/src/lib/admin";
import styles from "./admin.module.css";
import { axisLabel, count, kst, seconds } from "./format";

/** 타일 아래 작은 선 그래프. 값이 없는 칸(null)은 건너뜁니다 */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const known = values.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
  if (known.length < 2) return <div className={styles.sparkEmpty} aria-hidden="true" />;
  const max = Math.max(...known.map((p) => p.v));
  const min = Math.min(...known.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 30 - ((v - min) / span) * 26;
  const line = known.map((p) => `${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const area = `${x(known[0]!.i).toFixed(2)},32 ${line} ${x(known.at(-1)!.i).toFixed(2)},32`;
  return (
    <svg className={styles.spark} viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={label}>
      <polygon points={area} className={styles.sparkArea} />
      <polyline points={line} className={styles.sparkLine} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function niceMax(n: number): number {
  for (const step of [2, 4, 5, 10, 20, 40, 50, 100, 200, 500]) if (n <= step) return step;
  return Math.ceil(n / 500) * 500;
}

/** 시간 칸별 요청 (아래부터 성공 · 실패 · 호출 제한) */
export function RequestBars({ buckets, bucketMs }: { buckets: Bucket[]; bucketMs: number }) {
  const max = niceMax(Math.max(1, ...buckets.map((b) => b.ok + b.failed + b.limited)));
  const height = (n: number) => `${(n / max) * 100}%`;
  const total = buckets.reduce((sum, b) => sum + b.ok + b.failed + b.limited, 0);
  const columns = { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` };
  // 칸 이름은 칸 왼쪽에서 시작해 옆 칸으로 넘칩니다. 마지막 칸의 "지금"은 바로 앞 두 칸에 이름이 없을 때만 붙여 겹치지 않게 합니다.
  const labels = buckets.map((b) => axisLabel(b.start, bucketMs));
  if (!labels.slice(-3, -1).some(Boolean)) labels[labels.length - 1] = "지금";
  return (
    <div className={styles.chart} role="img" aria-label={`시간대별 요청 ${count(total)}건. 칸마다 성공 · 실패 · 호출 제한`}>
      <div className={styles.yAxis} aria-hidden="true">
        <span>{max}</span>
        <span>{max / 2}</span>
        <span>0</span>
      </div>
      <div className={styles.plot}>
        <span className={styles.gridline} style={{ bottom: "50%" }} />
        <span className={styles.gridline} style={{ bottom: "100%" }} />
        <div className={styles.bars} style={columns}>
          {buckets.map((b) => (
            <div key={b.start} className={styles.bar} title={`${kst(b.start)}부터 · 성공 ${b.ok} · 실패 ${b.failed} · 호출 제한 ${b.limited}`}>
              <span className={styles.segOk} style={{ height: height(b.ok) }} />
              <span className={styles.segBad} style={{ height: height(b.failed) }} />
              <span className={styles.segLimited} style={{ height: height(b.limited) }} />
            </div>
          ))}
        </div>
      </div>
      <div className={styles.xAxis} style={columns} aria-hidden="true">
        {buckets.map((b, i) => (
          <span key={b.start}>{labels[i]}</span>
        ))}
      </div>
    </div>
  );
}

const SCATTER_MAX_MS = 60_000;

/** 리포트마다 응답 시간 한 점 (색은 깊이). 예산선과 p90 선을 함께 그립니다 */
export function LatencyScatter({ points, since, until, budgetMs, p90Ms }: { points: LatencyPoint[]; since: string; until: string; budgetMs: number; p90Ms: number | null }) {
  const from = Date.parse(since);
  const span = Date.parse(until) - from;
  const bottom = (ms: number) => `${(Math.min(ms, SCATTER_MAX_MS) / SCATTER_MAX_MS) * 100}%`;
  return (
    <div className={styles.chart} role="img" aria-label={`리포트 ${count(points.length)}건의 응답 시간. 예산 ${seconds(budgetMs)}${p90Ms ? `, 90%가 ${seconds(p90Ms)} 안` : ""}`}>
      <div className={styles.yAxis} aria-hidden="true">
        <span>60초</span>
        <span>30초</span>
        <span>0</span>
      </div>
      <div className={styles.plot}>
        <span className={styles.gridline} style={{ bottom: "50%" }} />
        <span className={styles.gridline} style={{ bottom: "100%" }} />
        <span className={styles.budgetLine} style={{ bottom: bottom(budgetMs) }}>
          <em>예산 {seconds(budgetMs)}</em>
        </span>
        {p90Ms !== null && (
          <span className={styles.p90Line} style={{ bottom: bottom(p90Ms) }}>
            <em>p90 {seconds(p90Ms)}</em>
          </span>
        )}
        {points.map((p) => (
          <span
            key={`${p.at}-${p.ms}`}
            className={`${styles.dot} ${styles[`depth_${p.depth}`] ?? ""}`}
            style={{ left: `${((Date.parse(p.at) - from) / span) * 100}%`, bottom: bottom(p.ms) }}
            title={`${kst(p.at)} · ${seconds(p.ms)}`}
          />
        ))}
      </div>
      <div className={styles.xAxisEnds} aria-hidden="true">
        <span>{kst(since)}</span>
        <span>지금</span>
      </div>
    </div>
  );
}

/** 가로 막대 하나를 여러 칸으로 나눈 것 (합이 100% 가 되게) */
export function StackBar({ parts, label }: { parts: { value: number; className: string; title: string }[]; label: string }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div className={styles.stack} role="img" aria-label={label}>
      {parts.map((p) =>
        p.value > 0 ? <span key={p.title} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} title={p.title} /> : null,
      )}
    </div>
  );
}
