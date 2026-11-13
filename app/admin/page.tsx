/**
 * 관리자 화면: 실행 모니터링 (최근 24시간 · 7일). 리더 관리. 보호는 proxy.ts + 아래 확인 (src/lib/admin-auth.ts).
 * 데이터는 src/lib/admin.ts 의 loadRuns (runs 표 최근 7일). Supabase 환경 변수가 없거나 ?source=sample 이면 예시 데이터이고 맨 위에 그렇게 표시합니다.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { labelFor } from "@/src/agent/events";
import { BUDGET_MS, healthOf, loadRuns, MAX_PAGES, PAGE, parseRange, RANGES, summarizeRuns, THRESHOLDS, windowStats, type AdminEvent, type Health, type LoadedRuns, type RangeKey, type RunsSummary, type WindowStat } from "@/src/lib/admin";
import { isAdminAuthorized } from "@/src/lib/admin-auth";
import { failedLabels, loadEvals, metricLines, withinRatio, type EvalRow, type LoadedEvals } from "@/src/lib/admin-evals";
import { componentStatusLabels, healthOfComponent, healthOfImpact, healthOfIndicator, impactLabels, incidentStatusLabels, loadVendorStatus, vendorVerdict, type VendorStatus } from "@/src/lib/admin-status";
import { redactSecrets } from "@/src/lib/redact";
import styles from "./admin.module.css";
import { EvalSummary } from "./EvalSummary";
import { AutoRefresh } from "./AutoRefresh";
import { LatencyScatter, RequestBars, Sparkline, StackBar } from "./charts";
import { ago, count, kst, percent, seconds } from "./format";

export const metadata: Metadata = { title: "실행 모니터링 · Muffin Lab", robots: { index: false, follow: false } };

const healthLabels: Record<Health, string> = { ok: "정상", warn: "주의", bad: "장애", idle: "기록 없음" };
const levelLabels = { bad: "장애", warn: "주의", info: "정보" } as const;
const depthLabels: Record<string, string> = { easy: "Easy", standard: "Standard", deep: "Deep Dive" };
const intentLabels: Record<string, string> = { status: "현황", cause: "원인", compare: "비교", decision: "판단 요청", out_of_scope: "범위 밖" };
const eventTitles: Record<string, string> = { agent: "조사 중 오류", started: "중간에 멈춤", input: "입력 확인 실패", config: "서비스 설정 오류", limited: "호출 제한" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // proxy.ts 가 먼저 막습니다. matcher 가 바뀌어도 열리지 않게 여기서 한 번 더 확인합니다.
  if (!isAdminAuthorized((await headers()).get("authorization"))) notFound();

  const params = await searchParams;
  const range = parseRange(params.range);
  // ?source=sample 은 예시 데이터로 화면을 보는 용도입니다 (스크린샷 · 시연 연습). 기본은 runs 표입니다.
  const source = params.source === "sample" ? "sample" : undefined;
  const now = new Date();
  let loaded: LoadedRuns;
  try {
    loaded = await loadRuns(now, { source });
  } catch (err) {
    const reason = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 200);
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>실행 모니터링</h1>
        <p className={`${styles.banner} ${styles.bad}`} role="alert">
          실행 로그를 불러오지 못했습니다. Supabase 프로젝트가 일시 정지됐는지 확인한 뒤 새로고침하세요. ({reason})
        </p>
      </div>
    );
  }
  const s = summarizeRuns(loaded.rows, now, range);
  const health = healthOf(s);
  // 품질 평가(evals 표)와 OpenAI 상태 페이지는 실행 로그와 따로 읽습니다. 없거나 실패해도 위 화면은 그대로 그립니다.
  const [evals, vendor] = await Promise.all([loadEvals(), loadVendorStatus()]);
  const lastHour = windowStats(loaded.rows, now);

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div>
          <p className={styles.eyebrow}>Muffin Lab 운영</p>
          <h1 className={styles.title}>실행 모니터링</h1>
          <p className={styles.meta}>
            {kst(s.until, true)} 기준 · 최근 {RANGES[range].label} · 한국 시간
          </p>
        </div>
        <div className={styles.controls}>
          <nav className={styles.segment} aria-label="기간">
            {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((key) => (
              // 예시 모드(?source=sample)는 기간을 바꿔도 유지합니다
              <Link key={key} href={{ pathname: "/admin", query: { range: key, ...(source ? { source } : {}) } }} aria-current={key === range ? "page" : undefined}>
                {RANGES[key].label}
              </Link>
            ))}
          </nav>
          <AutoRefresh seconds={60} />
        </div>
      </header>

      {loaded.source === "sample" && (
        <p className={styles.sample} role="note">
          예시 데이터입니다. 실제 요청이 아닙니다.{" "}
          {loaded.reason === "requested" ? (
            <Link href={{ pathname: "/admin", query: { range } }}>실제 기록 보기</Link>
          ) : (
            "Supabase 환경 변수(SUPABASE_URL · SUPABASE_SECRET_KEY)가 없어 runs 표를 읽지 못했습니다."
          )}
        </p>
      )}
      {loaded.source === "runs" && loaded.truncated && (
        <p className={styles.sample} role="note">
          최근 7일 기록이 {count(PAGE * MAX_PAGES)}건을 넘어 최신 {count(loaded.rows.length)}건만 집계했습니다.
        </p>
      )}

      <StatusBanner s={s} health={health} />
      {s.total + s.limited === 0 ? <Empty range={range} real={loaded.source === "runs"} rowsInTable={loaded.rows.length} /> : <Dashboard s={s} health={health} now={now} />}
      <VendorPanel vendor={vendor} lastHour={lastHour} now={now} />
      <EvalPanel evals={evals} />
    </div>
  );
}

/**
 * 상용 AI 상태: OpenAI 상태 페이지(공개 JSON)의 전체 상태 · 우리가 쓰는 구성 요소 · 진행 중 장애와, 우리 실측(최근 1시간 요청 · 성공률 · 평균 응답)을 나란히 둡니다.
 * 외부가 "정상" 이어도 우리 쪽이 느리면 그게 진짜 상태라서 둘을 같이 보고 한 줄로 판단합니다 (vendorVerdict).
 */
function VendorPanel({ vendor, lastHour, now }: { vendor: VendorStatus; lastHour: WindowStat; now: Date }) {
  const verdict = vendorVerdict(vendor, lastHour);
  const h: Health = vendor.ok ? healthOfIndicator(vendor.indicator) : "idle";
  return (
    <Panel title="🤖 상용 AI 상태" sub="OpenAI 상태 페이지(status.openai.com) + 우리 실측(최근 1시간)">
      <div className={styles.vendorGrid}>
        <div>
          {vendor.ok ? (
            <>
              <p className={styles.vendorHead}>
                <span className={`${styles.pill} ${styles[h]}`}>
                  <span className={styles.pillDot} aria-hidden="true" />
                  {healthLabels[h]}
                </span>
                <span className={styles.vendorDesc}>{vendor.description}</span>
                <span className={styles.vendorMeta}>
                  {vendor.updatedAt ? `갱신 ${ago(vendor.updatedAt, now)} · ` : ""}읽는 데 {vendor.ms}ms
                </span>
              </p>
              <ul className={styles.pills} aria-label="구성 요소">
                {vendor.components.map((c) => {
                  const ch = healthOfComponent(c.status);
                  return (
                    <li key={c.name} className={`${styles.pill} ${styles[ch]}`}>
                      <span className={styles.pillDot} aria-hidden="true" />
                      {c.name} · {componentStatusLabels[c.status] ?? c.status}
                    </li>
                  );
                })}
              </ul>
              {vendor.incidents.length > 0 && (
                <ol className={styles.incidents} aria-label="진행 중 장애">
                  {vendor.incidents.map((i) => (
                    <li key={`${i.name}:${i.updatedAt}`}>
                      <span className={`${styles.badge} ${styles[healthOfImpact(i.impact)]}`}>{impactLabels[i.impact] ?? i.impact}</span>{" "}
                      {i.url ? (
                        <a href={i.url} target="_blank" rel="noreferrer">
                          {i.name}
                        </a>
                      ) : (
                        i.name
                      )}
                      {` · ${incidentStatusLabels[i.status] ?? i.status}`}
                      {i.updatedAt ? ` · ${ago(i.updatedAt, now)}` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className={styles.note}>OpenAI 상태 페이지를 읽지 못했습니다 ({vendor.error}). 오른쪽 실측으로 판단하세요.</p>
          )}
        </div>
        <dl className={styles.facts} aria-label="우리 실측 최근 1시간">
          <div>
            <dt>최근 1시간 요청</dt>
            <dd>{count(lastHour.total)}건</dd>
          </div>
          <div>
            <dt>성공률</dt>
            <dd>{percent(lastHour.ok, lastHour.total)}</dd>
          </div>
          <div>
            <dt>평균 응답</dt>
            <dd>{lastHour.avgMs === null ? "-" : seconds(lastHour.avgMs)}</dd>
          </div>
          <div>
            <dt>판단</dt>
            <dd className={styles[`text_${verdict.health}`] ?? ""}>{verdict.text}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

const evalKind = (r: EvalRow) => (r.tag ? `실험 ${r.tag}` : r.source === "ci" ? (r.set_name ? `수동 (${r.set_name})` : "주간 평가") : r.set_name ? `로컬 (${r.set_name})` : "로컬 실행");

/**
 * 품질 평가: 고정 질문 세트를 매주 금요일 자동으로 돌린 결과(Weekly eval)와 로컬 · 실험 실행의 기록.
 * 본 결과는 주간 평가(Action, 전체 세트)만 쓰고, 세트 일부 · 로컬 · 실험은 기록 목록에만 둡니다 (전체 세트와 비교할 수 없어서).
 * 지표마다 통과율을 기준(promptfooconfig.yaml 의 thresholds)과 비교하고, 주간 평가끼리 "기준 안 지표 비율" 추이를 그립니다.
 */
function EvalPanel({ evals }: { evals: LoadedEvals }) {
  const weekly = evals.weekly;
  const latest = weekly[0];
  const trend = [...weekly].reverse().map(withinRatio);
  const history = evals.rows.length > 0 && (
    <ol className={styles.evalHistory} aria-label="평가 기록">
      {evals.rows.map((r) => (
        <li key={r.id}>
          <time dateTime={r.at} title={kst(r.at, true)}>
            {kst(r.at)}
          </time>
          <span>{evalKind(r)}</span>
          <span>{count(r.questions)}문항</span>
          <span className={r.failed.length ? styles.text_bad : ""}>{r.failed.length ? `미달 ${count(r.failed.length)}` : r.errors ? `오류 ${count(r.errors)}` : "기준 안"}</span>
          <span>{r.avg_ms ? seconds(r.avg_ms) : "-"}</span>
          {r.run_url ? <a href={r.run_url} title="GitHub Actions 실행 페이지 (로그인 필요)">GitHub</a> : <span />}
        </li>
      ))}
    </ol>
  );
  let body: ReactNode;
  if (evals.source === "none") body = <p className={styles.note}>Supabase 환경 변수가 없어 평가 기록을 읽지 못합니다.</p>;
  else if (evals.error) body = <p className={styles.note}>평가 기록을 읽지 못했습니다: {evals.error}. evals 표가 아직 없으면 supabase/migrations 의 evals 마이그레이션을 적용하세요.</p>;
  else if (!latest)
    body = (
      <>
        <p className={styles.note}>
          {evals.rows.length ? "아직 주간 평가(전체 세트) 결과가 없습니다. 아래는 세트 일부 · 로컬 · 실험 실행 기록입니다." : "아직 평가 기록이 없습니다."} 주간 평가는 금요일 아침(07:17 예약)에 자동으로 돌고, pnpm eval:promptfoo 를 돌려도 기록이 쌓입니다.
        </p>
        {history}
      </>
    );
  else {
    const tone = latest.failed.length || latest.errors ? "bad" : "ok";
    body = (
      <>
        <div className={styles.evalHead}>
          <span className={`${styles.pill} ${styles[tone]}`}>
            <span className={styles.pillDot} aria-hidden="true" />
            {latest.failed.length ? `기준 미달 ${count(latest.failed.length)}개` : latest.errors ? `오류 ${count(latest.errors)}건` : "모든 지표 기준 안"}
          </span>
          <span className={styles.evalMeta}>
            {kst(latest.at)} · {evalKind(latest)} · 질문 {count(latest.questions)}개{latest.avg_ms ? ` · 평균 ${seconds(latest.avg_ms)}` : ""}
            {latest.models?.length ? ` · ${latest.models.join(" · ")}` : ""}
            {latest.run_url && (
              <>
                {" · "}
                <a href={latest.run_url} title="GitHub Actions 실행 페이지. 로그인하지 않으면 요약 · 결과 파일이 보이지 않습니다">GitHub 실행 (로그인 필요)</a>
              </>
            )}
          </span>
        </div>
        {latest.failed.length > 0 && <p className={styles.evalFailed}>미달: {failedLabels(latest).join(", ")}</p>}
        <table className={styles.evalTable}>
          <thead>
            <tr>
              <th>지표</th>
              <th>통과</th>
              <th>통과율</th>
              <th>기준</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {metricLines(latest).map((l) => (
              <tr key={l.metric}>
                <td>{l.label}</td>
                <td>
                  {count(l.pass)}/{count(l.total)}
                </td>
                <td>{l.rate === null ? "-" : percent(l.rate, 1)}</td>
                <td>{l.threshold === null ? "-" : percent(l.threshold, 1)}</td>
                <td>
                  <span className={`${styles.pill} ${styles[l.ok === null ? "idle" : l.ok ? "ok" : "bad"]}`}>{l.ok === null ? "-" : l.ok ? "기준 안" : "미달"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {weekly.length >= 2 && (
          <div className={styles.evalTrend}>
            <span className={styles.note}>주간 평가 {count(weekly.length)}회의 기준 안 지표 비율 추이</span>
            <Sparkline values={trend} label="주간 평가 기준 안 지표 비율 추이" />
          </div>
        )}
        {latest.summary && (
          <details className={styles.evalDetails}>
            <summary>질문별 결과 · 실패 항목 보기 (저장된 요약, GitHub 없이)</summary>
            <EvalSummary markdown={latest.summary} />
          </details>
        )}
        {evals.rows.length > 1 && history}
      </>
    );
  }
  return (
    <Panel title="📊 품질 평가" sub="고정 질문 세트를 매주 금요일 아침(07:17 예약) 자동으로 돌린 결과 (Weekly eval) · 실험 실행은 기록으로만">
      {body}
    </Panel>
  );
}

function StatusBanner({ s, health }: { s: RunsSummary; health: ReturnType<typeof healthOf> }) {
  const reasons = [
    health.success === "ok" || health.success === "idle" ? "" : `성공률 ${percent(s.ok, s.total)} (기준 ${THRESHOLDS.success[0] * 100}%)`,
    health.latency === "ok" || health.latency === "idle" ? "" : `응답 시간 p90 ${seconds(s.time!.p90Ms)} (정상 ${seconds(THRESHOLDS.p90Ms[0])} 이하 · 예산 ${seconds(BUDGET_MS)})`,
    health.advice === "bad" ? `권유 표현 ${count(s.verification!.advice)}건 남음` : "",
    health.verification === "ok" || health.verification === "idle" ? "" : `검증 통과 ${percent(s.verification!.pass, s.verification!.checked)}`,
  ].filter(Boolean);
  const idleText = s.limited ? `처리한 요청이 없습니다. 호출 제한으로 막힌 요청만 ${count(s.limited)}건 있습니다.` : "이 기간에 들어온 요청이 없습니다.";
  const text = health.overall === "idle" ? idleText : reasons.length ? reasons.join(" · ") : "모든 지표가 기준 안에 있습니다.";
  return (
    <section className={`${styles.banner} ${styles[health.overall]}`} aria-label="전체 상태">
      <span className={styles.bannerLight} aria-hidden="true" />
      <div className={styles.bannerBody}>
        <p className={styles.bannerTitle}>{health.overall === "ok" ? "정상 운영 중" : healthLabels[health.overall]}</p>
        <p className={styles.bannerText}>{text}</p>
      </div>
      <p className={styles.bannerFacts}>
        실패 {count(s.failed)} · 호출 제한 {count(s.limited)}
        {s.mock ? ` · Mock ${count(s.mock)} 제외` : ""}
      </p>
    </section>
  );
}

/** 센 요청이 없을 때. 표 자체가 비었는지(7일 동안 0줄), 줄은 있지만 세지 않는 것(Mock · 2분 안의 진행 중)뿐인지 나눠 말합니다. */
function Empty({ range, real, rowsInTable }: { range: RangeKey; real: boolean; rowsInTable: number }) {
  const label = RANGES[range].label;
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>아직 기록이 없습니다</h2>
      <p className={styles.note}>
        {rowsInTable === 0
          ? "최근 7일 동안 runs 표에 기록이 없습니다. 홈에서 리포트를 만들면 실행 로그 저장(명세 4.4)을 거쳐 여기에 쌓입니다."
          : `최근 ${label} 동안 센 요청이 없습니다. Mock 요청과 2분 안의 진행 중 요청은 세지 않습니다.`}
        {real && (
          <>
            {" "}
            화면 구성은 <Link href={{ pathname: "/admin", query: { range, source: "sample" } }}>예시 데이터</Link>로 볼 수 있습니다.
          </>
        )}
      </p>
    </section>
  );
}

function Kpi({ label, value, sub, health, children }: { label: string; value: string; sub?: string; health?: Health; children?: ReactNode }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiLabel}>{label}</span>
        {health && (
          <span className={`${styles.pill} ${styles[health]}`}>
            <span className={styles.pillDot} aria-hidden="true" />
            {healthLabels[health]}
          </span>
        )}
      </div>
      <b className={styles.kpiValue}>{value}</b>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
      {children}
    </div>
  );
}

function Panel({ title, sub, legend, children, className = "" }: { title: string; sub?: string; legend?: { label: string; className: string }[]; children: ReactNode; className?: string }) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>{title}</h2>
          {sub && <p className={styles.panelSub}>{sub}</p>}
        </div>
        {legend && (
          <ul className={styles.legend}>
            {legend.map((l) => (
              <li key={l.label}>
                <span className={`${styles.swatch} ${l.className}`} aria-hidden="true" />
                {l.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {children}
    </section>
  );
}

function eventTitle(e: AdminEvent): string {
  if (e.kind === "tool" && e.tool) return `${labelFor(e.tool)} 실패 · 리포트는 나감`;
  if (e.kind === "cache" && e.tool) return `${labelFor(e.tool)} · 저장된 응답 사용`;
  return eventTitles[e.kind] ?? e.kind;
}

function Dashboard({ s, health, now }: { s: RunsSummary; health: ReturnType<typeof healthOf>; now: Date }) {
  const v = s.verification;
  const bucketHours = s.bucketMs / (60 * 60_000);
  return (
    <>
      <section className={styles.kpis} aria-label="핵심 지표">
        <Kpi label="요청" value={`${count(s.total)}건`} sub={`성공 ${count(s.ok)} · 실패 ${count(s.failed)}`}>
          <Sparkline values={s.buckets.map((b) => b.ok + b.failed + b.limited)} label="시간대별 요청 수 추이" />
        </Kpi>
        <Kpi label="성공률" value={percent(s.ok, s.total)} sub={`기준 ${THRESHOLDS.success[0] * 100}%`} health={health.success}>
          <Sparkline values={s.buckets.map((b) => (b.ok + b.failed ? b.ok / (b.ok + b.failed) : null))} label="시간대별 성공률 추이" />
        </Kpi>
        <Kpi label="응답 시간 p90" value={s.time ? seconds(s.time.p90Ms) : "-"} sub={`예산 ${seconds(BUDGET_MS)}`} health={health.latency}>
          {s.time && (
            <div className={styles.budgetMeter} role="img" aria-label={`예산의 ${percent(s.time.p90Ms, BUDGET_MS)}`}>
              <span className={styles[health.latency]} style={{ width: `${Math.min(100, (s.time.p90Ms / BUDGET_MS) * 100)}%` }} />
            </div>
          )}
        </Kpi>
        <Kpi label="평균 응답" value={s.time ? seconds(s.time.avgMs) : "-"} sub={s.time ? `리포트 ${count(s.time.count)}건` : undefined}>
          <Sparkline values={s.buckets.map((b) => b.avgMs)} label="시간대별 평균 응답 시간 추이" />
        </Kpi>
        <Kpi label="검증 통과" value={v ? percent(v.pass, v.checked) : "-"} sub={v ? `다시 쓰기 ${percent(v.rewritten, v.checked)}` : undefined} health={health.verification} />
        <Kpi label="남은 권유 표현" value={v ? `${count(v.advice)}건` : "-"} sub="목표 0" health={health.advice} />
      </section>

      <div className={styles.gridMain}>
        <Panel
          title="요청 추이"
          sub={`${bucketHours}시간 단위`}
          legend={[
            { label: "성공", className: styles.segOk },
            { label: "실패", className: styles.segBad },
            { label: "호출 제한", className: styles.segLimited },
          ]}
        >
          <RequestBars buckets={s.buckets} bucketMs={s.bucketMs} />
        </Panel>
        <Panel
          title="응답 시간"
          sub="리포트마다 한 점"
          legend={[
            { label: "Easy", className: styles.depth_easy },
            { label: "Standard", className: styles.depth_standard },
            { label: "Deep", className: styles.depth_deep },
          ]}
        >
          <LatencyScatter points={s.points} since={s.since} until={s.until} budgetMs={BUDGET_MS} p90Ms={s.time?.p90Ms ?? null} />
        </Panel>
      </div>

      <div className={styles.gridSplit}>
        <Panel title="🔍 tool 상태" sub={`실제 조회 성공률 · 정상 ${THRESHOLDS.tool[0] * 100}% 이상 · 주의 ${THRESHOLDS.tool[1] * 100}% 이상 · 저장 응답으로 나간 호출은 실패로 셈`}>
          {s.tools.length ? (
            <ul className={styles.tools}>
              {s.tools.map((t) => {
                const h = health.tools[t.tool] ?? "idle";
                return (
                  <li key={t.tool} className={styles.tool}>
                    <span className={`${styles.light} ${styles[h]}`} title={healthLabels[h]} />
                    <span className={styles.toolName}>{labelFor(t.tool)}</span>
                    <span className={`${styles.toolRate} ${styles[`text_${h}`] ?? ""}`}>{percent(t.live, t.calls)}</span>
                    <span className={styles.toolMeta} title={t.lastFail}>
                      {count(t.calls)}회 · 평균 {seconds(t.avgMs)}
                      {t.fallbacks ? ` · 저장 응답 ${count(t.fallbacks)}회` : ""}
                      {t.skipped ? ` · 회로 열림 ${count(t.skipped)}회` : ""}
                      {t.lastFailAt ? ` · 마지막 실패 ${ago(t.lastFailAt, now)}` : ""}
                    </span>
                    <span className={styles.toolMeter} aria-hidden="true">
                      <span className={styles[h]} style={{ width: `${(t.live / t.calls) * 100}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.note}>tool 호출 기록이 없습니다.</p>
          )}
        </Panel>

        <Panel title="이벤트" sub={`최근 ${s.events.length}건 · 실패 · 멈춤 · 호출 제한 · tool 실패`}>
          {s.events.length ? (
            <ol className={styles.events}>
              {s.events.map((e) => (
                <li key={e.id} className={styles.event}>
                  <span className={`${styles.badge} ${styles[e.level]}`}>{levelLabels[e.level]}</span>
                  <div className={styles.eventBody}>
                    <p className={styles.eventTitle}>
                      {eventTitle(e)}
                      <time dateTime={e.at} title={kst(e.at, true)}>
                        {ago(e.at, now)}
                      </time>
                    </p>
                    {e.question && <p className={styles.eventQuestion}>{e.question}</p>}
                    {e.detail && <p className={styles.eventDetail}>{e.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.note}>이 기간에 이벤트가 없습니다.</p>
          )}
        </Panel>
      </div>

      <div className={styles.gridThree}>
        <Panel title="✅ 검증" sub="리포트를 만든 요청 (범위 밖 제외)">
          {v ? (
            <>
              <StackBar
                label={`통과 ${v.pass}건, 일부 실패 ${v.checked - v.pass}건`}
                parts={[
                  { value: v.pass, className: styles.ok, title: `통과 ${v.pass}건` },
                  { value: v.checked - v.pass, className: styles.warn, title: `일부 실패 ${v.checked - v.pass}건` },
                ]}
              />
              <dl className={styles.facts}>
                <div><dt>통과</dt><dd>{count(v.pass)} / {count(v.checked)}건</dd></div>
                <div><dt>다시 쓰기</dt><dd>{count(v.rewritten)}건</dd></div>
                <div><dt>확인 못 한 숫자</dt><dd>{count(v.unverified)} / {count(v.numbers)}개</dd></div>
                <div><dt>남은 권유 표현</dt><dd>{count(v.advice)}건</dd></div>
              </dl>
            </>
          ) : (
            <p className={styles.note}>검증을 거친 리포트가 없습니다.</p>
          )}
        </Panel>

        <Panel title="깊이별 비교" sub={`막대는 평균 응답, 눈금은 p90 · 끝은 60초. 아래 줄은 리포트당 평균`}>
          {s.byDepth.length ? (
            <ul className={styles.depths}>
              {s.byDepth.map((d) => (
                <li key={d.depth}>
                  <div className={styles.depthHead}>
                    <span>{depthLabels[d.depth] ?? d.depth}</span>
                    <span className={styles.depthNums}>
                      평균 {seconds(d.avgMs)} · p90 {seconds(d.p90Ms)} · {count(d.count)}건
                    </span>
                  </div>
                  <p className={styles.depthFacts}>
                    {d.numbers !== null ? `숫자 ${d.numbers}개 · 원인 ${d.why === null ? "-" : `${d.why}개`} · 다시 쓰기 ${percent(d.rewritten ?? 0, 1)}` : "검증 기록 없음"}
                    {d.tokens ? ` · 토큰 ${count(d.tokens.input)}/${count(d.tokens.output)}` : ""}
                  </p>
                  <div className={styles.depthTrack} aria-hidden="true">
                    <span className={`${styles.depthAvg} ${styles[`depth_${d.depth}`] ?? ""}`} style={{ width: `${Math.min(100, (d.avgMs / 60_000) * 100)}%` }} />
                    <span className={styles.depthP90} style={{ left: `${Math.min(100, (d.p90Ms / 60_000) * 100)}%` }} />
                    <span className={styles.depthBudget} style={{ left: `${(BUDGET_MS / 60_000) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>리포트를 만든 요청이 없습니다.</p>
          )}
        </Panel>

        <Panel title="질문 의도 · 토큰" sub="요청 수 · 리포트당 평균 토큰">
          {s.intents.length ? (
            <>
              <StackBar
                label={s.intents.map((x) => `${intentLabels[x.intent] ?? x.intent} ${x.count}`).join(", ")}
                parts={s.intents.map((x, i) => ({ value: x.count, className: styles[`intent${i % 5}`] ?? "", title: `${intentLabels[x.intent] ?? x.intent} ${x.count}건` }))}
              />
              <ul className={styles.legendList}>
                {s.intents.map((x, i) => (
                  <li key={x.intent}>
                    <span className={`${styles.swatch} ${styles[`intent${i % 5}`] ?? ""}`} aria-hidden="true" />
                    {intentLabels[x.intent] ?? x.intent} <b>{count(x.count)}</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.note}>의도 기록이 없습니다.</p>
          )}
          {s.tokens && (
            <dl className={styles.facts}>
              <div><dt>입력 토큰</dt><dd>{count(s.tokens.input)}</dd></div>
              <div><dt>출력 토큰</dt><dd>{count(s.tokens.output)}</dd></div>
            </dl>
          )}
        </Panel>
      </div>
    </>
  );
}
