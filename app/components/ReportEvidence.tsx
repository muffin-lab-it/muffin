"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { formatDateKo, sourceLinkLabel } from "./format";
import { PrintOpenDetails } from "./ReportResponsiveDetails";
import type { Evidence, Report } from "@/src/agent/schema";
import { ReportEvidenceLink, ReportSectionLink, useEvidenceSelection, useEvidenceTarget } from "./ReportEvidenceScope";

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

export function EvidenceReference({ evidenceId, evidence, label = "자료 출처 자세히 보기", children, valueKey, origin }: {
  children?: ReactNode;
  label?: string;
  evidenceId: string | null;
  evidence: Evidence[];
  /** 장부에서 색칠하고 내려갈 값 키 (숫자 카드가 대조한 키) */
  valueKey?: string;
  /** 돌아올 자리 이름 (EvidenceOrigin 의 name) */
  origin?: string;
}) {
  const entry = evidence.find((item) => item.id === evidenceId);
  const targetId = useEvidenceTarget(evidenceId ?? "missing");
  const originId = useEvidenceTarget(origin ?? "none");
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
  if (targetId) return <ReportEvidenceLink targetId={targetId} label={label} className={children ? "metric-value-link" : ""} valueKey={valueKey} originId={origin ? originId ?? undefined : undefined}>{children}</ReportEvidenceLink>;
  return (
    <details className="evidence-detail">
      <summary>출처와 자료 날짜 보기</summary>
      <EvidenceContent entry={entry} evidence={evidence} />
    </details>
  );
}

export function EvidenceRecord({ entry, evidence, displayedValue, displayedLabel, hideHeading = false, usedKeys, inList = false }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string; displayedLabel?: string; hideHeading?: boolean; usedKeys?: string[]; inList?: boolean }) {
  const id = useEvidenceTarget(entry.id);
  const scope = useEvidenceSelection();
  // 근거 보기로 내려왔을 때만 돌아가기 버튼 (11/21 QA 2 · 외부 F8)
  const arrived = !!scope?.origin && scope.target === entry.id;
  return <div className="evidence-record" data-evidence-id={entry.id} id={id ?? undefined} tabIndex={-1}>
    {arrived && <button type="button" className="evidence-return" onClick={() => scope?.returnToOrigin()}>↩ 읽던 곳으로 돌아가기</button>}
    <EvidenceContent entry={entry} evidence={evidence} displayedValue={displayedValue} displayedLabel={displayedLabel} hideHeading={hideHeading} usedKeys={usedKeys}  inList={inList} />
  </div>;
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
  op: "계산 방식", result: "결과", unit: "단위", a: "입력 값 1", b: "입력 값 2", scaled: "환산 결과", amount: "환산할 금액",
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
  close: "종가", open: "시가", high: "고가", low: "저가", volume: "거래량", prevClose: "전일 종가", closeFrom: "기간 시작 종가", returnPct: "기간 수익률 (%)",
  category: "품목군", weight: "가중치 (12개 합 1000)", index: "지수", previousYearIndex: "전년 같은 달 지수", yoyPct: "전년 같은 달 대비 (%)",
  contributionPp: "총지수 등락 기여도 (%p, 근사)", contributionSumPp: "12개 품목군 기여도 합 (%p)", month: "기준 월", previousYearMonth: "비교 월",
  previousMonth: "전월", previousMonthIndex: "전월 지수", momPct: "전월 대비 (%)", momContributionPp: "총지수 전월 대비 기여도 (%p, 근사)", momContributionSumPp: "12개 품목군 전월 기여도 합 (%p)",
};
/** 거래대금 · 순자산처럼 큰 원화 금액은 조 · 억 단위로 (11/21 QA 4: "1,532,179,713,324" 가 단위 없이 그대로 보였음) */
function formatCompactWon(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e12) {
    const jo = Math.floor(abs / 1e12);
    const eok = Math.round((abs - jo * 1e12) / 1e8);
    return `${sign}${jo.toLocaleString("ko-KR")}조${eok > 0 ? ` ${eok.toLocaleString("ko-KR")}억` : ""} 원`;
  }
  return `${sign}${Math.round(abs / 1e8).toLocaleString("ko-KR")}억 원`;
}
/** 원본 값 표시. 소수가 긴 값(-0.2169840746809312)은 소수 넷째 자리까지, 큰 정수는 천 단위 쉼표. 연도 · 월 · 코드처럼 보이는 정수는 그대로 둡니다. */
export function formatEvidenceValue(key: string, value: unknown): string {
  // 계산 방식(op)은 화면 이름으로 ("scale" → "금액 환산")
  if (key === "op" && typeof value === "string") return operationLabels[value] ?? value;
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (/tradeValue|netAssets|marketCap/i.test(key) && Math.abs(value) >= 1e8) return formatCompactWon(value);
  if (Number.isInteger(value)) return Math.abs(value) >= 1000 && !/year|month|date|code|id$/i.test(key) ? value.toLocaleString("ko-KR") : String(value);
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}
// 11/23 운영 검수: 검증 상세에 "계산값 (zscore ← E3)" 처럼 계산 방식이 영문으로 보임
const operationLabels: Record<string, string> = { spread: "차이", diff: "차이", pct_change: "변화율", pp_diff: "%p 차이", zscore: "평소 움직임과 비교", scale: "금액 환산", example: "가상 예시 계산", "prevClose+change": "전일 종가 + 변화" };

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
  // 시각이 있는 기록은 한국 시간 날짜로 봅니다 (11/21 QA-10: UTC 날짜라 원문 게시일보다 하루 앞서 보였음)
  const dateOnly = value.length === 10;
  const seoulDay = (ms: number) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const shownDate = dateOnly ? date : seoulDay(timestamp);
  const current = now === null ? null : new Date(now);
  const elapsed = current === null ? null : dateOnly
    ? Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) - midnight
    : Date.parse(`${seoulDay(current.getTime())}T00:00:00Z`) - Date.parse(`${shownDate}T00:00:00Z`);
  const days = elapsed === null ? null : Math.floor(elapsed / 86_400_000);
  const relative = elapsed === null || days === null ? null : elapsed < 0 ? "미래 발행일" : days === 0 ? "오늘" : `${days}일 전`;
  return { label: shownDate, dateTime: value, relative };
}

function NewsEvidence({ entry, inList = false }: { entry: Evidence; inList?: boolean }) {
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
  // 본문을 못 받은 것(unavailable)과 요청하지 않은 것(not_requested)은 읽는 사람에게 같은 뜻이라 둘 다 '제목만 확인' (11/23 운영 검수: '본문 미요청' 이 내부 말로 보임)
  const status = body === "unavailable" || body === "not_requested" ? "제목만 확인" : body === "available" ? "본문 확보" : "본문 확보 여부 미확인";
  return <>
    <p className="evidence-title">{title}</p>
    <div className="evidence-meta">
      <span aria-hidden="true">📰</span><span>{publisher}</span>
      <SourceLink url={url} name={relay ? "Google News 중계 링크" : "기사 보기"} />
      <span>{date.dateTime ? <time dateTime={date.dateTime}>{formatDateKo(date.label)}</time> : date.label}{date.relative && ` · ${date.relative}`}</span>
      <span>{status}</span>
    </div>
    {/* 기사마다 같은 안내 문단이 반복되던 것을 빼고(11/20 QA 13), 제목만 확인한 기사에만 한 줄 둡니다 */}
    {/* 출처 목록에서는 뉴스 묶음 위에 한 번만 둡니다 (11/23 운영 검수: 기사 11건에 같은 문장이 11번) */}
    {!inList && (body === "unavailable" || body === "not_requested") && <p className="report-muted">제목만 확인한 기사라 본문 내용은 반영되지 않았어요. 보도 내용은 공식 데이터로 독립 검증된 사실과 구분해 주세요.</p>}
  </>;
}

// 카드에서 먼저 보여 줄 값의 우선순위. 숫자 카드가 대조한 키(usedKeys)가 가장 앞 (11/21 QA 4 · 하니 4: 10~25줄 표가 다 펼쳐져 있었음)
const PRIMARY_KEYS = ["rate", "value", "index", "latest.close", "latest.value", "result", "scaled", "changePct", "change", "changePp", "changeBp", "yoyPct", "momPct", "period.returnPct", "latest.changePct", "comparisonRate", "comparisonDate", "comparisonAsOf", "amount", "from", "to", "unit", "date", "asOf", "latest.date", "month"];
const MAX_PRIMARY = 4;
/** 이보다 줄이 많으면 쓴 값 몇 줄만 두고 나머지는 "원본 값 전체 보기" 로 접습니다 */
const MAX_PLAIN_ROWS = 6;
export function primaryKeys(values: Evidence["values"], usedKeys: string[] = []): string[] {
  const keys = Object.keys(values);
  const chosen: string[] = [];
  for (const key of [...usedKeys, ...PRIMARY_KEYS]) {
    if (chosen.length >= MAX_PRIMARY) break;
    if (keys.includes(key) && !chosen.includes(key)) chosen.push(key);
  }
  if (chosen.length === 0) chosen.push(...keys.slice(0, MAX_PRIMARY));
  return chosen;
}
/** 계산 장부는 note 첫 문장이 계산식입니다 ("E3.rate 3.88 − E2.rate 3.00 = 0.88%p"). 식으로 보여 줍니다 (11/21 QA 4) */
export function formulaOf(entry: Pick<Evidence, "lineage" | "note">): string | null {
  if (!entry.lineage || !entry.note) return null;
  const first = entry.note.split(/\.\s+/)[0]?.trim();
  // 식 속 장부 키("E1.change")는 화면 라벨로 ("E1 변화량"). 11/23 운영 검수: "계산식 E1.change -3.77 × 100 ÷ 100" 이 그대로 보임
  return first && first.includes("=") ? first.replace(/\b([EC]\d+(?:-\d+)?)\.([A-Za-z][\w.]*)/g, (_all, ref: string, key: string) => `${ref} ${keyLabel(key)}`) : null;
}

function EvidenceContent({ entry, evidence, displayedValue, displayedLabel, hideHeading = false, usedKeys = [], inList = false }: { entry: Evidence; evidence: Evidence[]; displayedValue?: string; displayedLabel?: string; hideHeading?: boolean; usedKeys?: string[]; inList?: boolean }) {
  // A single raw value adds no context when its formatted equivalent is already above.
  // Keep differing values, calculations and multi-field records visible.
  const fields = Object.entries(entry.values);
  const formatted = displayedValue?.replaceAll(",", "");
  const duplicate = !entry.lineage && fields.length === 1 && ["value", "rate"].includes(fields[0][0])
    && typeof fields[0][1] === "number" && formatted !== undefined
    && /^[+-]?\d+(?:\.\d+)?(?:%p|%|원)?$/.test(formatted)
    && Number.parseFloat(formatted) === fields[0][1];
  const isNews = /news/i.test(entry.tool);
  const formula = formulaOf(entry);
  // 계산식은 화면 라벨로 바꿔 길이가 달라지므로, 나머지 설명은 note 의 원래 첫 문장 뒤에서 자릅니다
  const rawFirst = entry.note?.split(/\.\s+/)[0]?.trim() ?? "";
  const noteRest = formula && entry.note ? entry.note.slice(entry.note.indexOf(rawFirst) + rawFirst.length).replace(/^\.\s*/, "") : entry.note;
  const row = ([key, value]: [string, string | number]) => (
    <div key={key} data-key={key}><dt title={key}>{valueLabels[key] ?? key}</dt><dd>{key === "op" ? operationLabels[String(value)] ?? String(value) : formatEvidenceValue(key, value)}</dd></div>
  );
  const primary = primaryKeys(entry.values, usedKeys);
  const folded = fields.length > MAX_PLAIN_ROWS;
  return (
    <div className="evidence-content">
      {!hideHeading && <span className="evidence-id" aria-label={`근거 번호 ${entry.id}`}>{entry.id}</span>}
      {isNews ? <NewsEvidence entry={entry} inList={inList} /> : <>
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
      {formula && <p className="evidence-formula"><span>계산식</span> {formula}</p>}
      {duplicate ? null : fields.length > 0 ? (
        folded ? <>
          <dl className="evidence-values">{primary.map(key => row([key, entry.values[key]]))}</dl>
          <PrintOpenDetails className="evidence-more" summary={`원본 값 전체 보기 (${fields.length}개)`}>
            <dl className="evidence-values evidence-values-all">{fields.map(row)}</dl>
          </PrintOpenDetails>
        </> : <dl className="evidence-values">{fields.map(row)}</dl>
      ) : <p className="evidence-missing">공개된 원본 값이 없어요.</p>}
      </>}
      {/* 뉴스 tool 의 note 는 모델에게 주는 지시문(본문 상태 · 추정 금지)이라 사용자에게는 위의 본문 상태 줄로 대신합니다 (11/19 페르소나 테스트 14/20 지적) */}
      {noteRest && !isNews && <p className="evidence-note">{noteRest}</p>}
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
        <p className="report-muted">규칙: 숫자는 자료에서 받은 값과 하나하나 맞춰 보고, 자료에 없는 숫자와 투자 권유 표현은 빼요. 계산값은 계산 도구의 결과(C 번호)이고, 기사 보도는 기사 제목의 숫자라 공식 데이터가 아니에요.</p>
        {report.numbers.length > 0 ? (
          <ol className="verification-list">
            {report.numbers.map((n, i) => (
              <li key={i}>
                <b>{n.label}</b> {n.value} → <span className={`report-badge check-${n.check}`}>{checkLabels[n.check]}</span> <LinkedCheckDetail number={n} evidence={report.evidence} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="report-muted">숫자 카드가 없어요.</p>
        )}
        <p>원인 {report.why.length}개: 데이터 인용 {v.why.data} · 보도 기반 {v.why.news} · 근거 부족 {v.why.none}</p>
        <p>
          다시 쓰기 {v.revisions}회{v.revisionSkipped ? " · 마감이 가까워 다시 쓰지 않고 걸린 항목을 바로 뺐어요" : ""} · {v.removed.length > 0 ? <ReportSectionLink name="removed" label={`검사 후 제외 ${v.removed.length}개 (주의점과 확인하지 못한 것에서 확인)`} /> : "검사 후 제외 0개"}
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
    <section className="report-verification" aria-label="리포트 검증 상태" data-quick="verify">
      {/* 기본은 접힌 한 줄. 펼쳐야 내역이 보입니다 (11/20 서영 2-2 · 3, 외부 E1, 하니 2). 인쇄 때는 PrintOpenDetails 가 잠시 펼칩니다 */}
      <PrintOpenDetails className="verification-toggle" label="리포트 상세 정보" summary={<>
          <span className="verification-summary-copy"><strong><span className="verification-icon" aria-hidden="true">✓</span> 검증이 한 일<span className={`report-badge status-${verification.status}`}>{labels[verification.status]}</span></strong><span>{skipped ? "검사를 실행하지 않은 리포트예요" : `숫자 ${verification.numbers.total}개 중 값 대조 ${verification.numbers.verified}개 · 계산값 ${verification.numbers.derived}개 · 권유 표현 ${verification.advice}건`}</span></span>
          <span className="verification-summary-action"><span className="verification-toggle-label">자세히 보기</span><span className="verification-chevron" aria-hidden="true">⌄</span></span>
        </>}>
        <div className="verification-body">
      {skipped ? (
        <p>이 리포트는 검증을 거치지 않았어요. 숫자와 원인 설명은 출처에서 직접 확인해 주세요.</p>
      ) : (
        <>
          <p>숫자 {verification.numbers.total}개 중 값 대조 {verification.numbers.verified}개 · 계산값 {verification.numbers.derived}개 · 기사 보도 {verification.numbers.reported ?? 0}개 · 미검증 {verification.numbers.unverified}개</p>
          <p className="report-muted">값 대조는 인용한 숫자가 원본 값과 맞는지 보는 검사예요. 날짜 · 단위 · 지표의 의미나 원인 관계까지 맞다고 보장하지는 않아요.</p>
          <p className="report-muted">권유 표현 패턴 감지 {verification.advice}건 · 수정 {verification.revisions}회 · 제외 항목 {verification.removed.length}개</p>
          <VerificationDetail report={report} />
        </>
      )}
          {children}
        </div>
      </PrintOpenDetails>
    </section>
  );
}
