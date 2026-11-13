"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { Evidence, Report } from "@/src/agent/schema";
import { ReportEvidenceLink, ReportSectionLink, useEvidenceTarget } from "./ReportEvidenceScope";

/** 장부나 저장 기록에서 온 URL도 웹 주소인 경우에만 링크로 표시합니다. */
export function SourceLink({ url, name }: { url: string; name: string }) {
  let safe = false;
  try {
    const parsed = new URL(url);
    safe = (parsed.protocol === "https:" || parsed.protocol === "http:");
  } catch {
    // 주소가 없거나 잘못되었어도 출처명과 기준일은 보존합니다.
  }
  return safe ? (
    <a href={url} target="_blank" rel="noopener noreferrer">{name}</a>
  ) : (
    <span>{name}</span>
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

export function EvidenceRecord({ entry, evidence, displayedValue }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string }) {
  const id = useEvidenceTarget(entry.id);
  return <div className="evidence-record" id={id ?? undefined} tabIndex={-1}><EvidenceContent entry={entry} evidence={evidence} displayedValue={displayedValue} /></div>;
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

const valueLabels: Record<string, string> = {
  op: "계산 방식", result: "결과", unit: "단위", a: "입력 값 1", b: "입력 값 2",
  rate: "값", value: "값", pair: "통화", date: "자료 날짜", asOf: "자료 날짜", title: "기사 제목", formula: "계산식",
  comparisonRate: "비교 값", comparisonAsOf: "비교 날짜", change: "변화량", changePct: "변화율 (%)", changePp: "변화 (%p)",
};
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
  const relative = elapsed === null ? null : elapsed < 0 ? "미래 발행일" : `${Math.floor(elapsed / 86_400_000)}일 전`;
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
      <span>{date.dateTime ? <time dateTime={date.dateTime}>{date.label}</time> : date.label}{date.relative && ` · ${date.relative}`}</span>
      <span>{status}</span>
    </div>
    <p className="report-muted">{body === "unavailable" || body === "not_requested"
      ? "보도 제목에서 확인된 정보입니다. 본문 내용이나 원인 관계를 확인한 근거는 아닙니다."
      : body === "available" ? "본문을 확보한 기사입니다. 이 원본 정보에는 본문 전문이 포함되어 있지 않습니다."
        : "저장된 정보로는 본문 확보 여부를 확인할 수 없습니다."} 보도 내용은 공식 데이터로 독립 검증된 사실과 구분해 주세요.</p>
  </>;
}

function EvidenceContent({ entry, evidence, displayedValue }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string }) {
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
      <span className="evidence-id" aria-label={`근거 번호 ${entry.id}`}>{entry.id}</span>
      {isNews ? <NewsEvidence entry={entry} /> : <>
      <p className="evidence-title">{entry.label.replace(new RegExp(" · " + entry.source.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "")}</p>
      <div className="evidence-meta">
        <span aria-hidden="true">{entry.lineage ? "🧮" : isNews ? "📰" : "📊"}</span>
        {entry.lineage ? <span>계산에 사용한 자료</span> : <SourceLink url={entry.source.pageUrl ?? entry.source.url} name={entry.source.name} />}
        <span>{entry.source.asOf ? `기준일 ${entry.source.asOf}` : "자료 날짜 미제공"}</span>
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
            <div key={key}><dt title={key}>{valueLabels[key] ?? key}</dt><dd>{key === "op" ? operationLabels[String(value)] ?? String(value) : String(value)}</dd></div>
          ))}
        </dl>
      ) : <p className="evidence-missing">공개된 원본 값이 없습니다.</p>}
      </>}
      {entry.note && <p className="evidence-note">{entry.note}</p>}
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

/** 숫자 카드 하나를 검증이 어떻게 확인했는지 한 줄 */
export function numberCheckDetail(n: Report["numbers"][number], evidence: Evidence[]): string {
  const entry = evidence.find((e) => e.id === n.ref);
  const ref = n.ref ?? "근거 번호 없음";
  if (n.check === "verified") return n.match ? `${ref} 의 ${n.match.key} 값과 ${policyLabels[n.match.policy]}` : `${ref} 의 장부 값과 일치`;
  if (n.check === "derived") {
    const lineage = entry?.lineage;
    return lineage ? `${ref} 계산값 (${lineage.op} ← ${lineage.inputs.join(", ")})${n.match ? ` · ${n.match.key} 와 ${policyLabels[n.match.policy]}` : ""}` : `${ref} 계산값`;
  }
  if (n.check === "reported") {
    const where = n.match ? `${ref} 의 ${n.match.key.replace(/#text$/, "")} 와 ${policyLabels[n.match.policy]}` : `${ref} 기사 제목에 나온 숫자`;
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
      <details className="verification-toggle" aria-label="리포트 상세 정보">
        <summary>
          <span className="verification-summary-copy"><strong><span className="verification-icon" aria-hidden="true">✓</span> 검증이 한 일<span className={`report-badge status-${verification.status}`}>{labels[verification.status]}</span></strong><span>{skipped ? "검사를 실행하지 않은 리포트예요" : `숫자 대조 · 근거 분류 · 권유 표현 검사`}</span></span>
          <span className="verification-summary-action"><span className="verification-toggle-label">리포트 상세 정보</span><span className="verification-chevron" aria-hidden="true">⌄</span></span>
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
