"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { formatDateKo, sourceLinkLabel } from "./format";
import type { Evidence, Report } from "@/src/agent/schema";
import { ReportEvidenceLink, ReportSectionLink, useEvidenceTarget } from "./ReportEvidenceScope";

/** 장부나 저장 기록에서 온 URL도 웹 주소인 경우에만 링크로 표시합니다. */
export function SourceLink({ url, name, className }: { url: string; name: string; className?: string }) {
  let safe = false;
  try {
    const parsed = new URL(url);
    safe = (parsed.protocol === "https:" || parsed.protocol === "http:");
  } catch {
    // 주소가 없거나 잘못되었어도 출처명과 기준일은 보존합니다.
  }
  return safe ? (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer">{name}</a>
  ) : (
    <span className={className}>{name}</span>
  );
}

export function EvidenceReference({ evidenceId, evidence, label = "자료 출처 자세히 보기", children }: {
  children?: ReactNode;
  label?: string;
  evidenceId: string | null;
  evidence: Evidence[];
}) {
  const entry = evidence.find((item) => item.id === evidenceId);
  const targetId = useEvidenceTarget(evidenceId ?? "missing");
  if (!entry) {
    return (
      <>
      {children}
      <p className="evidence-missing">
        {evidenceId ? "연결된 원본 자료를 찾을 수 없어요." : "연결된 원본 자료가 없어요."}
      </p>
      </>
    );
  }
  if (targetId) return <ReportEvidenceLink targetId={targetId} label={label} className={children ? "metric-value-link" : ""}>{children}</ReportEvidenceLink>;
  return (
    <details className="evidence-detail">
      <summary>출처와 자료 날짜 보기</summary>
      <EvidenceContent entry={entry} evidence={evidence} />
    </details>
  );
}

export function EvidenceRecord({ entry, evidence, displayedValue, displayedLabel, hideHeading = false }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string; displayedLabel?: string; hideHeading?: boolean }) {
  const id = useEvidenceTarget(entry.id);
  return <div className="evidence-record" data-evidence-id={entry.id} id={id ?? undefined} tabIndex={-1}><EvidenceContent entry={entry} evidence={evidence} displayedValue={displayedValue} displayedLabel={displayedLabel} hideHeading={hideHeading} /></div>;
}

/** 같은 리포트에 존재하는 입력 원본으로 이동하며, 원본을 재귀 렌더링하지 않습니다. */
function EvidenceInputLink({ evidenceId, evidence }: { evidenceId: string; evidence: Evidence[] }) {
  const entry = evidence.find((item) => item.id === evidenceId);
  const targetId = useEvidenceTarget(evidenceId);
  const label = `${evidenceId} · ${entry?.label ?? "연결된 자료 없음"}`;
  return entry && targetId
    ? <ReportEvidenceLink targetId={targetId} label={`${label} 원본 보기`}>{label}</ReportEvidenceLink>
    : <span>{label}</span>;
}

// tool 이 돌려준 키 이름을 사람이 읽는 라벨로. 없는 키는 원래 이름 그대로 (dt 의 title 에는 항상 원래 키를 남깁니다)
const valueLabels: Record<string, string> = {
  op: "계산 방식", result: "결과", unit: "단위", a: "입력 값 1", b: "입력 값 2",
  rate: "값", value: "값", pair: "통화", date: "자료 날짜", asOf: "자료 날짜", title: "기사 제목", formula: "계산식",
  comparisonRate: "비교 값", comparisonAsOf: "비교 날짜", change: "변화량", changePct: "변화율 (%)", changePp: "변화 (%p)",
  comparisonDate: "비교 날짜", "comparison.rate": "비교 값", "comparison.asOf": "비교 날짜", changeBp: "변화 (bp)", requestedDays: "요청 기간 (일)", observationCount: "관측 수",
  indicator: "지표", indicatorName: "지표 이름", seriesCode: "통계 코드", country: "국가", frequency: "주기", seasonalAdjustment: "계절조정", changeUnit: "변화량 단위", changeFormula: "변화율 계산식",
  "period.from": "기간 시작", "period.to": "기간 끝", "period.months": "기간 (개월)", "period.days": "기간 (일)", from: "시작", to: "끝", periodDays: "기간 (일)",
  movePct: "이번 변화율 (%)", typicalMovePct: "평소 변화 폭 (%)", zScore: "평소 대비 (표준편차 배수)", timesTypical: "평소 폭 대비 배수", level: "판정",
  baselineStart: "기준 구간 시작", baselineEnd: "기준 구간 끝", baselineCount: "기준 구간 관측 수",
  name: "이름", code: "코드", baseIndex: "기초지수", "latest.date": "최근 거래일", "latest.close": "종가", "latest.change": "전일 대비 변화", "latest.changePct": "전일 대비 변화율 (%)",
  "latest.nav": "순자산가치 (NAV)", "latest.premiumPct": "괴리율 (%)", "latest.open": "시가", "latest.high": "고가", "latest.low": "저가", "latest.volume": "거래량", "latest.tradeValue": "거래대금",
  "latest.netAssets": "순자산", "latest.indexClose": "기초지수 종가", "period.closeFrom": "기간 시작 종가", "period.indexCloseFrom": "기간 시작 지수", "period.returnPct": "기간 수익률 (%)",
  "period.indexReturnPct": "지수 수익률 (%)", "period.trackingDiffPp": "추적 차이 (%p)", "period.high": "기간 고가", "period.low": "기간 저가",
  "latest.month": "최근 월", "latest.value": "최근 값", "latest.previousMonth.month": "전월", "latest.previousMonth.value": "전월 값", "latest.previousMonth.change": "전월 대비 변화",
  "latest.previousYear.month": "전년 같은 달", "latest.previousYear.value": "전년 같은 달 값", "latest.previousYear.change": "전년 같은 달 대비 변화",
  publishedAt: "발행일", publisher: "언론사", body: "본문 상태", url: "주소",
  category: "품목군", weight: "가중치 (12개 합 1000)", index: "지수", previousYearIndex: "전년 같은 달 지수", yoyPct: "전년 같은 달 대비 (%)",
  contributionPp: "총지수 등락 기여도 (%p, 근사)", contributionSumPp: "12개 품목군 기여도 합 (%p)", month: "기준 월", previousYearMonth: "비교 월",
  previousMonth: "전월", previousMonthIndex: "전월 지수", momPct: "전월 대비 (%)", momContributionPp: "총지수 전월 대비 기여도 (%p, 근사)", momContributionSumPp: "12개 품목군 전월 기여도 합 (%p)",
};
/** 원본 값 표시. 소수가 긴 값(-0.2169840746809312)은 소수 넷째 자리까지, 큰 정수는 천 단위 쉼표. 연도 · 월 · 코드처럼 보이는 정수는 그대로 둡니다. */
export function formatEvidenceValue(key: string, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return Math.abs(value) >= 1000 && !/year|month|date|code|id$/i.test(key) ? value.toLocaleString("ko-KR") : String(value);
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}
const operationLabels: Record<string, string> = { spread: "차이", diff: "차이", pct_change: "변화율", pp_diff: "%p 차이" };

let displayTime: number | null = null;
let clockInterval: number | undefined;
const clockListeners = new Set<() => void>();
function subscribeClock(onChange: () => void) {
  clockListeners.add(onChange);
  if (clockListeners.size === 1) {
    displayTime = Date.now();
    clockInterval = window.setInterval(() => {
      displayTime = Date.now();
      clockListeners.forEach(listener => listener());
    }, 60_000);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0) window.clearInterval(clockInterval);
  };
}
const clockNow = () => displayTime;
const serverClock = () => null;

/** 날짜가 없는 저장 기록이나 달력상 존재하지 않는 날짜를 추정해서 보정하지 않습니다. */
export function newsDate(value: unknown, now: number | null = null) {
  if (typeof value !== "string" || !value.trim()) return { label: "발행일 미제공", dateTime: undefined, relative: null };
  const iso = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const timestamp = Date.parse(value);
  if (!iso.test(value) || !Number.isFinite(timestamp) || !Number.isFinite(midnight)
    || new Date(midnight).toISOString().slice(0, 10) !== date) {
    return { label: "발행일 확인 불가", dateTime: undefined, relative: null };
  }
  // 날짜만 있는 기록에는 발행 시각을 가정하지 않고, 브라우저의 달력 날짜끼리 비교합니다.
  const current = now === null ? null : new Date(now);
  const elapsed = current === null ? null : value.length === 10
    ? Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) - midnight
    : current.getTime() - timestamp;
  const days = elapsed === null ? null : Math.floor(elapsed / 86_400_000);
  const relative = elapsed === null || days === null ? null : elapsed < 0 ? "미래 발행일" : days === 0 ? "오늘" : `${days}일 전`;
  return { label: date, dateTime: value, relative };
}

function NewsEvidence({ entry }: { entry: Evidence }) {
  // 서버와 hydration의 첫 화면은 절대 날짜만 같게 표시하고, 마운트 이후 상대 날짜를 더합니다.
  const now = useSyncExternalStore(subscribeClock, clockNow, serverClock);
  const date = newsDate(entry.values.publishedAt ?? entry.source.asOf, now);
  const text = (value: string | number | undefined) => typeof value === "string" && value.trim() ? value : undefined;
  const title = text(entry.values.title) ?? entry.label;
  const publisher = text(entry.values.publisher) ?? entry.source.name;
  const url = entry.source.pageUrl ?? entry.source.url;
  let relay = false;
  try { relay = new URL(url).hostname === "news.google.com"; } catch { /* SourceLink가 잘못된 URL을 차단합니다. */ }
  const body = entry.values.body;
  const status = body === "unavailable" ? "제목만 확인" : body === "available" ? "본문 확보" : body === "not_requested" ? "본문 미요청" : "본문 확보 여부 미확인";
  return <>
    <p className="evidence-title">{title}</p>
    <div className="evidence-meta">
      <span aria-hidden="true">📰</span><span>{publisher}</span>
      <SourceLink url={url} name={relay ? "Google News 중계 링크" : "기사 보기"} />
      <span>{date.dateTime ? <time dateTime={date.dateTime}>{formatDateKo(date.label)}</time> : date.label}{date.relative && ` · ${date.relative}`}</span>
      <span>{status}</span>
    </div>
    {/* 기사마다 같은 안내 문단이 반복되던 것을 빼고(11/20 QA 13), 제목만 확인한 기사에만 한 줄 둡니다 */}
    {(body === "unavailable" || body === "not_requested") && <p className="report-muted">제목만 확인한 기사라 본문 내용은 반영되지 않았어요. 보도 내용은 공식 데이터로 독립 검증된 사실과 구분해 주세요.</p>}
  </>;
}

function EvidenceContent({ entry, evidence, displayedValue, displayedLabel, hideHeading = false }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string; displayedLabel?: string; hideHeading?: boolean }) {
  // A single raw value adds no context when its formatted equivalent is already above.
  // Keep differing values, calculations and multi-field records visible.
  const fields = Object.entries(entry.values);
  const formatted = displayedValue?.replaceAll(",", "");
  const duplicate = !entry.lineage && fields.length === 1 && ["value", "rate"].includes(fields[0][0])
    && typeof fields[0][1] === "number" && formatted !== undefined
    && /^[+-]?\d+(?:\.\d+)?(?:%p|%|원)?$/.test(formatted)
    && Number.parseFloat(formatted) === fields[0][1];
  const isNews = /news/i.test(entry.tool);
  return (
    <div className="evidence-content">
      {!hideHeading && <span className="evidence-id" aria-label={`근거 번호 ${entry.id}`}>{entry.id}</span>}
      {isNews ? <NewsEvidence entry={entry} /> : <>
      {(!hideHeading || displayedLabel !== entry.label) && <p className="evidence-title">{entry.label.replace(new RegExp(" · " + entry.source.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "")}</p>}
      <div className="evidence-meta">
        <span aria-hidden="true">{entry.lineage ? "🧮" : isNews ? "📰" : "📊"}</span>
        {entry.lineage ? <span>계산에 사용한 자료</span> : <><span>{entry.source.name}</span><SourceLink url={entry.source.pageUrl ?? entry.source.url} name={sourceLinkLabel(entry.source.pageUrl ?? entry.source.url)} /></>}
        <span>{entry.source.asOf ? `기준일 ${formatDateKo(entry.source.asOf)}` : "자료 날짜 미제공"}</span>
        {entry.lineage ? <span className="evidence-inputs">{entry.lineage.inputs.length > 0 ? entry.lineage.inputs.map((id, index) => (
          <span key={`${id}-${index}`}>
            {index > 0 && ", "}
            <EvidenceInputLink evidenceId={id} evidence={evidence} />
          </span>
        )) : "입력 자료 미제공"}</span> : null}
      </div>
      {duplicate ? null : Object.keys(entry.values).length > 0 ? (
        <dl className="evidence-values">
          {Object.entries(entry.values).map(([key, value]) => (
            <div key={key}><dt title={key}>{valueLabels[key] ?? key}</dt><dd>{key === "op" ? operationLabels[String(value)] ?? String(value) : formatEvidenceValue(key, value)}</dd></div>
          ))}
        </dl>
      ) : <p className="evidence-missing">공개된 원본 값이 없습니다.</p>}
      </>}
      {/* 뉴스 tool 의 note 는 모델에게 주는 지시문(본문 상태 · 추정 금지)이라 사용자에게는 위의 본문 상태 줄로 대신합니다 (11/19 페르소나 테스트 14/20 지적) */}
      {entry.note && !isNews && <p className="evidence-note">{entry.note}</p>}
    </div>
  );
}

/** 검증 문장 속 근거 번호도 자료 패널의 같은 원본으로 이동합니다. */
function VerificationRef({ id, evidence }: { id: string; evidence: Evidence[] }) {
  const targetId = useEvidenceTarget(id);
  if (!targetId || !evidence.some(entry => entry.id === id)) return <span>{id}</span>;
  return <ReportEvidenceLink targetId={targetId} label={`원본 보기 · ${id}`} className="verification-ref">{id}</ReportEvidenceLink>;
}

function LinkedCheckDetail({ number, evidence }: { number: Report["numbers"][number]; evidence: Evidence[] }) {
  return <>{numberCheckDetail(number, evidence).split(/(\b(?:E\d+(?:-\d+)?|C\d+)\b)/g).map((part, i) =>
    /^(?:E\d+(?:-\d+)?|C\d+)$/.test(part) ? <VerificationRef key={i} id={part} evidence={evidence} /> : part
  )}</>;
}

const checkLabels = { verified: "값 대조", derived: "계산값", reported: "기사 보도", unverified: "미검증" } as const;
const policyLabels = { exact: "정확히 일치", rounded: "표기 반올림과 일치", scaled: "단위를 환산해 일치", tolerance: "허용 오차 0.1% 안에서 일치" } as const;

/** 장부 키(comparison.rate)를 화면 라벨("비교 값")로. 모르는 키는 그대로 둡니다 (11/20 서영 3: 영문 키가 그대로 보임) */
function keyLabel(key: string): string {
  const plain = key.replace(/#text$/, "");
  return valueLabels[plain] ?? plain;
}

/** 숫자 카드 하나를 검증이 어떻게 확인했는지 한 줄 */
export function numberCheckDetail(n: Report["numbers"][number], evidence: Evidence[]): string {
  const entry = evidence.find((e) => e.id === n.ref);
  const ref = n.ref ?? "근거 번호 없음";
  if (n.check === "verified") return n.match ? `${ref} 의 "${keyLabel(n.match.key)}" 항목과 ${policyLabels[n.match.policy]}` : `${ref} 의 장부 값과 일치`;
  if (n.check === "derived") {
    const lineage = entry?.lineage;
    return lineage ? `${ref} 계산값 (${operationLabels[lineage.op] ?? lineage.op} ← ${lineage.inputs.join(", ")})${n.match ? ` · "${keyLabel(n.match.key)}" 항목과 ${policyLabels[n.match.policy]}` : ""}` : `${ref} 계산값`;
  }
  if (n.check === "reported") {
    const where = n.match ? `${ref} 의 "${keyLabel(n.match.key)}" 와 ${policyLabels[n.match.policy]}` : `${ref} 기사 제목에 나온 숫자`;
    return `${where} (보도일 뿐 공식 데이터로 확인한 것이 아님)`;
  }
  return "검증기를 거치지 않았거나 대조하지 못함";
}

/**
 * 검증이 한 일을 풀어 보여 줍니다 (숫자마다 어느 장부 값과 어떤 규칙으로 맞았는지 · 원인의 근거 종류 · 다시 쓰기 · 제외한 항목 수).
 * 데이터는 모두 검증기(src/agent/verify.ts)가 리포트에 적어 둔 것이고 화면은 읽기만 합니다.
 */
export function VerificationDetail({ report }: { report: Report }) {
  const v = report.verification;
  return (
    <div className="verification-detail">
      <h3>검증이 한 일 보기 · 숫자 대조 내역</h3>
      <div className="evidence-content">
        <p className="report-muted">규칙: 숫자는 tool 이 돌려준 장부 값과 하나하나 대조하고, 장부에 없는 숫자와 투자 권유 표현은 뺍니다. 계산값은 계산 도구의 결과(C 번호)이고, 기사 보도는 기사 제목의 숫자라 공식 데이터는 아닙니다.</p>
        {report.numbers.length > 0 ? (
          <ol className="verification-list">
            {report.numbers.map((n, i) => (
              <li key={i}>
                <b>{n.label}</b> {n.value} → <span className={`report-badge check-${n.check}`}>{checkLabels[n.check]}</span> <LinkedCheckDetail number={n} evidence={report.evidence} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="report-muted">숫자 카드가 없습니다.</p>
        )}
        <p>원인 {report.why.length}개: 데이터 인용 {v.why.data} · 보도 기반 {v.why.news} · 근거 부족 {v.why.none}</p>
        <p>
          다시 쓰기 {v.revisions}회{v.revisionSkipped ? " · 마감이 가까워 다시 쓰지 않고 걸린 항목을 바로 뺐습니다" : ""} · {v.removed.length > 0 ? <ReportSectionLink name="removed" label={`검사 후 제외 ${v.removed.length}개 (주의점과 확인하지 못한 것에서 확인)`} /> : "검사 후 제외 0개"}
        </p>
      </div>
    </div>
  );
}

export function ReportVerification({ report, children }: { report: Report; children?: ReactNode }) {
  const verification = report.verification;
  const skipped = verification.status === "skipped";
  const labels = { skipped: "검사 미실행", partial: "일부 확인 필요", pass: "검사 통과" };
  return (
    <section className="report-verification" aria-label="리포트 검증 상태">
      {/* 기본은 접힌 한 줄. 펼쳐야 내역이 보입니다 (11/20 서영 2-2 · 3, 외부 E1, 하니 2) */}
      <details className="verification-toggle" aria-label="리포트 상세 정보">
        <summary>
          <span className="verification-summary-copy"><strong><span className="verification-icon" aria-hidden="true">✓</span> 검증이 한 일<span className={`report-badge status-${verification.status}`}>{labels[verification.status]}</span></strong><span>{skipped ? "검사를 실행하지 않은 리포트예요" : `숫자 ${verification.numbers.total}개 중 값 대조 ${verification.numbers.verified}개 · 계산값 ${verification.numbers.derived}개 · 권유 표현 ${verification.advice}건`}</span></span>
          <span className="verification-summary-action"><span className="verification-toggle-label">자세히 보기</span><span className="verification-chevron" aria-hidden="true">⌄</span></span>
        </summary>
        <div className="verification-body">
      {skipped ? (
        <p>이 리포트는 검증기를 거치지 않았습니다. 숫자와 원인 설명을 출처에서 직접 확인해 주세요.</p>
      ) : (
        <>
          <p>숫자 {verification.numbers.total}개 중 값 대조 {verification.numbers.verified}개 · 계산값 {verification.numbers.derived}개 · 기사 보도 {verification.numbers.reported ?? 0}개 · 미검증 {verification.numbers.unverified}개</p>
          <p className="report-muted">값 대조는 인용한 원본 값과의 일치 검사입니다. 날짜·단위·지표의 의미와 원인 관계 전체의 정확성을 보장하지 않습니다.</p>
          <p className="report-muted">권유 표현 패턴 감지 {verification.advice}건 · 수정 {verification.revisions}회 · 제외 항목 {verification.removed.length}개</p>
          <VerificationDetail report={report} />
        </>
      )}
          {children}
        </div>
      </details>
    </section>
  );
}
