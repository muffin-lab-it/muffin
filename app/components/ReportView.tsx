import { PrintOpenDetails, ReportResponsiveDetails } from "./ReportResponsiveDetails";
/// <reference types="next/image-types/global" />
import { fallbackReportTopics, supportedReportTopics } from "@/src/lib/report-topics";
import type { ReactNode } from "react";
import { reportChange, trustedChangeDetail } from "./reportChange";
import Image from "next/image";
import resultMuffin from "../result-muffin.png";
import { labelFor } from "@/src/agent/events";
import { whyEmptyNote } from "@/src/agent/report";
import { formatAge } from "@/src/lib/age";
import { ReportDisplay } from "./ReportDisplay";
import { ReportHelp } from "./ReportHelp";
import { ReportSources } from "./ReportSources";
import Link from "next/link";
import styles from "./ReportView.module.css";
import type { ToolStep } from "@/src/agent/context";
import type { Area, Evidence, Report } from "@/src/agent/schema";
import { ReportChart } from "./ReportChart";
import { ReportQuickMenu, type QuickItem } from "./ReportQuickMenu";
import { EvidenceOrigin, ReportEvidenceScope, ReasonEvidenceTarget, ReportSectionLink, ReportSectionTarget } from "./ReportEvidenceScope";
import { EvidenceReference, ReportVerification, SourceLink } from "./ReportEvidence";
import { formatDateKo, isBokRelease, isNewsEvidence, newsCountLine, newsNoun, prettyDates, prettyReport, publisherOf, repeatsClaim, valueTone } from "./format";
import { usedEvidenceIds } from "./ReportSources";
import { evidenceCategory } from "./reportCategory";
import { splitAreaPrefix } from "./home-form";

export const areaLabels: Record<Area, string> = {
  fx: "환율",
  etf: "ETF",
  news: "경제뉴스",
  rate: "금리",
  macro: "물가",
};
/** 영역 → 출처 묶음 이름 (reportCategory 와 같은 말) */
const areaCategory: Record<Area, string> = { fx: "환율", etf: "ETF", news: "뉴스", rate: "금리", macro: "물가" };
/** 고른 영역과 실제로 쓴 자료의 주제가 다르면 그 주제들을 돌려줍니다 (11/21 QA-08: ETF 를 골랐는데 물가 리포트가 ETF 배지로 나옴) */
export function topicMismatch(report: Report, area?: Area): string[] | null {
  if (!area) return null;
  const used = usedEvidenceIds(report);
  const categories = [...new Set(report.evidence.filter(entry => used.has(entry.id)).map(evidenceCategory))].filter(name => name !== "계산" && name !== "기타 자료");
  if (categories.length === 0 || categories.includes(areaCategory[area])) return null;
  return categories;
}

/**
 * 리포트 한 장. 홈과 리포트 상세가 같이 씁니다.
 * 프론트 팀은 이 컴포넌트를 기준으로 디자인을 올리면 됩니다. 데이터 모양은 src/agent/schema.ts.
 */
type ReportViewProps = {
  report: Report;
  header?: ReactNode;
  actions?: ReactNode;
  createdAt?: string;
  impactTitles?: string[];
  topicReasons?: string[];
  headline?: string;
  steps?: ToolStep[];
  area?: Area;
  question?: string;
  /** 리포트 한 장만 보는 화면(리포트 페이지 · 다시 보기)에서 따라다니는 목차를 붙입니다. 깊이별 비교처럼 여러 장이 나란하면 끕니다 */
  quickMenu?: boolean;
};

type NumberItem = Report["numbers"][number];

/** 안내문을 '투자 권유' 문장 앞에서 두 줄로 (11/25 사용자). 그 말이 없는 예전 안내문은 한 줄 그대로 */
export function disclosureLines(text: string): string[] {
  const at = text.indexOf("투자 권유");
  return at > 0 ? [text.slice(0, at).trim(), text.slice(at).trim()] : [text];
}

/** 숫자 카드용 짧은 출처 이름: 끝의 괄호 설명을 뗍니다 ("Frankfurter v2 일별 환율 (2026년 7월 27일~11월 23일)" → "Frankfurter v2 일별 환율") */
export function shortSourceName(name: string): string {
  const short = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return short.length >= 2 ? short : name;
}
const checkLabels = { verified: "값 대조", derived: "계산값", reported: "기사 보도", unverified: "원문 미대조" } as const;
/** 비교값 · 변화량 · 수익률처럼 본값에 딸린 숫자인지 (11/21 하니 4: 현재 값 · 비교 값 · 변동폭이 카드 셋으로 나뉘어 같은 숫자가 반복됨) */
export function isSubValue(number: Pick<NumberItem, "label" | "value">): boolean {
  return /^[+−-]/.test(number.value.trim()) || /비교|대비|변화|변동|차이|수익률|변화율|전일|전월|전년|\d+일\s*전/.test(number.label);
}
/** 같은 장부를 가리키는 딸린 숫자를 본값 카드 안으로 묶습니다. 본값이 없는 장부의 숫자는 그대로 따로 둡니다 */
export function groupNumbers(numbers: NumberItem[]): { main: NumberItem; index: number; subs: { n: NumberItem; index: number }[] }[] {
  const mainByRef = new Map<string, number>();
  numbers.forEach((number, index) => { if (number.ref && !isSubValue(number) && !mainByRef.has(number.ref)) mainByRef.set(number.ref, index); });
  const subsOf = new Map<number, number[]>();
  numbers.forEach((number, index) => {
    const main = number.ref ? mainByRef.get(number.ref) : undefined;
    if (main !== undefined && main !== index && isSubValue(number)) subsOf.set(main, [...(subsOf.get(main) ?? []), index]);
  });
  const consumed = new Set([...subsOf.values()].flat());
  return numbers.map((number, index) => ({ number, index })).filter(({ index }) => !consumed.has(index))
    .map(({ number, index }) => ({ main: number, index, subs: (subsOf.get(index) ?? []).map(sub => ({ n: numbers[sub], index: sub })) }));
}

/**
 * 딸린 숫자 줄의 보조 설명: 비교 기간(또는 변화 문구) · 본값과 다른 기준일. 라벨에 이미 있는 말은 뺍니다
 * (11/22 운영 확인: "한국 소비자물가지수 전월 대비 0.25%" 아래에 "전월 대비" 가 한 번 더 나옴).
 * 딸린 숫자의 비교 기간 · 다른 기준일은 그대로 남깁니다 (Codex 리뷰: 묶으면서 기간 · 날짜가 사라지지 않게).
 */
export function subRows(subs: { n: NumberItem; index: number }[], mainAsOf: string, skipped: boolean) {
  const squash = (text: string) => text.replace(/\s+/g, "");
  return subs.map(({ n, index }) => {
    const change = n.change && !/^이번\s*주$/.test(n.change.trim()) ? reportChange(n.change, n.changeDetail) : null;
    const detail = trustedChangeDetail(n.changeDetail);
    const period = detail?.from && detail.to ? `비교 기간 ${formatDateKo(detail.from)} → ${formatDateKo(detail.to)}` : change?.text;
    const parts = [
      period && !squash(n.label).includes(squash(period)) ? period : null,
      n.asOf && n.asOf !== mainAsOf ? `기준일 ${formatDateKo(n.asOf)}` : null,
    ].filter((part): part is string => !!part);
    return { index, label: n.label, value: n.value, check: skipped ? "unverified" as const : n.check, detail: parts.join(" · ") };
  });
}

/** 카드 값이 부호 있는 변화량이고 changeDetail 과 같은 숫자 · 단위면 true (11/23 운영: "+0.87%" 아래에 "30일 전과 비교해 0.87% 상승") */
export function repeatsValue(value: string, detail?: { value: number; unit: string }): boolean {
  if (!detail || !valueTone(value)) return false;
  const m = /^([+−-]?)([\d,]+(?:\.\d+)?)\s*(%p|%|bp|원)?$/.exec(value.trim());
  if (!m) return false;
  const number = Number(m[2]!.replaceAll(",", "")) * (m[1] === "-" || m[1] === "−" ? -1 : 1);
  return (!m[3] || m[3] === detail.unit) && Math.abs(number - detail.value) < 1e-9;
}

/** 원인 문장의 근거 링크. 뉴스는 기사로 바로 새 창, 데이터는 아래 출처 칸으로 (11/20 QA 3: "원본 보기" 가 기사인 줄 알았는데 아래로 내려가 두 번 눌러야 했음). */
function ReasonLinks({ refs, evidence }: { refs: string[]; evidence: Evidence[] }) {
  const items = refs.map(ref => ({ ref, entry: evidence.find(item => item.id === ref) }));
  const news = items.filter((item): item is { ref: string; entry: Evidence } => !!item.entry && isNewsEvidence(item.entry));
  const data = items.filter(item => !item.entry || !isNewsEvidence(item.entry));
  if (items.length === 0) return null;
  const article = ({ ref, entry }: { ref: string; entry: Evidence }) => {
    const url = entry.source.pageUrl ?? entry.source.url;
    let relay = false;
    try { relay = new URL(url).hostname === "news.google.com"; } catch { /* SourceLink 가 잘못된 주소를 링크로 만들지 않습니다. */ }
    return <SourceLink key={ref} url={url} name={`${publisherOf(entry)} ${isBokRelease(entry) ? "보도자료" : "기사"} 보기${relay ? " (Google News)" : ""} ↗`} className="reason-article" />;
  };
  return <div className="reason-originals">
    {news.length === 1 && article(news[0])}
    {news.length >= 2 && <PrintOpenDetails className="reason-news" summary={`${newsNoun(news.map(item => item.entry))} ${news.length}건 보기`}><ul>{news.map(item => <li key={item.ref}>{article(item)}</li>)}</ul></PrintOpenDetails>}
    {data.map(item => <EvidenceReference key={item.ref} evidenceId={item.ref} evidence={evidence} label={`출처로 이동 · ${item.ref}`}><span>출처로 이동 ↓ · {item.ref}</span></EvidenceReference>)}
  </div>;
}

export function ReportView({
  report: rawReport,
  steps,
  area,
  question,
  headline: rawHeadline = rawReport.headline ?? undefined,
  impactTitles: rawImpactTitles = rawReport.impactTitles ?? [],
  header,
  actions,
  createdAt,
  quickMenu = false,
}: ReportViewProps) {
  // 모델이 쓴 문장 속 "2026-10" · "2026-11-20" 을 "2026년 10월" · "2026년 11월 20일" 로 (11/22 운영). 원본 데이터 표는 그대로
  const report = prettyReport(rawReport);
  const headline = rawHeadline ? prettyDates(rawHeadline) : undefined;
  const impactTitles = rawImpactTitles.map(prettyDates);
  // 추천이 비면 영역에 맞는 기본 질문 둘을 두어 후속 탐색이 끊기지 않게 (11/21 QA-06)
  const supported = supportedReportTopics(report.nextTopics, area, question);
  const nextTopics = supported.length > 0 ? supported : fallbackReportTopics(area, question);
  const mismatch = topicMismatch(report, area);
  const whyNote = report.why.length === 0 ? whyEmptyNote(report) : null;
  // 11/25 가독성: 원인이 있으면 요약 문단은 머리말 · 원인과 겹쳐(녹화에서 낱말 53~77%) 한입 요약 안에 접어 둡니다. 원인이 없으면 요약이 주된 설명이라 그대로
  const foldSummary = !!headline && report.why.length > 0 && !!report.summary.trim();
  // 영역을 여러 개 고르면 화면이 질문 앞에 붙인 "관심 영역: …" 머리말은 떼서 배지로 보여 줍니다 (11/20 외부 G1 · 하니 2)
  const shown = splitAreaPrefix(question ?? "");
  const questionText = question ? shown.question : undefined;
  const areaChips = shown.areas.length > 0 ? <div className="chips report-area-chips">{shown.areas.map(name => <span key={name} className="category-chip" data-category={name === "경제뉴스" ? "뉴스" : name}>{name}</span>)}</div> : null;
  // 관심 영역 · 깊이 배지와 작성일은 질문 바로 아래 한 줄에 (11/20 하니 리뷰: 머리에 모아 두기, 보관함에서 다시 볼 때 날짜가 바로 보이게)
  const metaLine = (header || createdAt || areaChips)
    ? <div className="report-meta-line">{areaChips}{header}{createdAt && <span className="report-created-at">작성일 · <time dateTime={createdAt}>{new Date(createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></span>}{mismatch && <span className="report-area-note">질문에 맞춰 {mismatch.join(" · ")}를 중심으로 설명했어요</span>}</div>
    : null;
  // 판단 요청 고지("투자 판단을 대신하지 않아요 …")는 그 질문에 붙은 안내라 질문 카드 안에 둡니다 (11/22 운영 확인: 브랜드 제목 위에 떠 있었음)
  const questionNotice = report.notice && report.mode !== "research"
    ? <p className="report-notice report-question-notice"><span aria-hidden="true">ⓘ</span>{report.notice}</p>
    : null;
  const newsEntries = report.evidence.filter(isNewsEvidence);
  const cards = groupNumbers(report.numbers);
  // 도구 표는 리포트에서 빼고(11/20 QA 7 · 하니 5, 전체 표는 /admin) 저장본 · 실패 · 호출 생략만 주의점 옆에 메모로 남깁니다
  // 백엔드가 "확인하지 못한 것" 에 이미 적은 tool(저장된 응답 사용 줄, src/agent/report.ts)은 메모에서 뺍니다 (11/23 운영: 같은 말이 두 번)
  const mentioned = (tool: string) => [...report.caveats, ...report.dataGaps].some(line => line.startsWith(`${labelFor(tool)}:`));
  // 계산 도구 실패는 자료를 못 받은 게 아니라 내부 계산이 안 된 것이라 보여 주지 않습니다 (11/23 재점검: "계산: 확인하지 못했어요 (데이터를 확인하지 못했습니다.)")
  const toolNotes = (steps ?? []).filter(step => (step.status === "error" || step.fallbackAgeMs !== undefined || step.breaker === "open") && !mentioned(step.tool) && !/^calc_/.test(step.tool));
  // 주의점 칸 제목: 있는 것만 (11/25 가독성)
  const referenceParts = [report.caveats.length > 0 && "주의점", report.dataGaps.length > 0 && "확인하지 못한 것", toolNotes.length > 0 && "자료 확인 메모"].filter((part): part is string => !!part);
  const referenceTitle = referenceParts.length > 0 ? referenceParts.join(" · ") : "주의점과 확인하지 못한 것";
  const showReference = report.caveats.length > 0 || report.dataGaps.length > 0 || report.verification.removed.length > 0 || toolNotes.length > 0;
  const basisLabels = { data: "공개된 데이터를 바탕으로 설명해요", news: "기사 내용을 바탕으로 안내해요", none: "직접 뒷받침하는 자료가 없는 머핀랩의 AI 해석이에요" };
  const tags = { data: "데이터 인용", news: "보도 기반", none: "근거 부족" };
  // 보도 기반 원인의 근거가 한국은행 보도자료면 '보도자료 내용을 바탕으로' (11/25: 통화정책방향이 근거인데 '기사' 로 보였음)
  const basisLabel = (w: Report["why"][number]) => w.basis !== "news" ? basisLabels[w.basis]
    : `${newsNoun((w.refs ?? []).map(ref => report.evidence.find(entry => entry.id === ref)).filter(entry => !entry || isNewsEvidence(entry)))} 내용을 바탕으로 안내해요`;
  // 따라다니는 목차에 넣을 영역: 아래에서 실제로 그리는 영역만 (11/23 사용자 결정: 탭 대신 퀵메뉴)
  const quickItems: QuickItem[] = [
    { key: "summary", label: "요약" },
    ...(report.numbers.length > 0 ? [{ key: "numbers", label: "숫자" }] : newsEntries.length > 0 ? [{ key: "numbers", label: "기사" }] : []),
    ...(report.why.length > 0 || whyNote ? [{ key: "story", label: "이야기" }] : []),
    ...(report.impact.length > 0 ? [{ key: "impact", label: "영향" }] : []),
    ...(report.charts && report.charts.length > 0 ? [{ key: "chart", label: "차트" }] : []),
    ...(report.evidence.length > 0 || report.sources.length > 0 ? [{ key: "sources", label: "출처" }] : []),
    { key: "verify", label: "검증" },
  ];
  return (
    <div className={styles.reportContainer}>
    {quickMenu && <ReportQuickMenu items={quickItems} />}
    <ReportEvidenceScope>
    <ReportDisplay className={`report ${styles.report}`}>
      <header className="report-brand-header"><div><p>갓 구운 오늘의 리포트</p><h1>Today&apos;s Muffin</h1></div>{actions && <div className="report-actions">{actions}</div>}</header>
      {questionText && (
        <section className={styles.questionCard} aria-label="나의 질문">
          <h2>나의 질문</h2>
          <blockquote>{questionText}</blockquote>
          {metaLine}
          {questionNotice}
        </section>
      )}
      {!questionText && metaLine}
      {!questionText && questionNotice}
      <section className={styles.hero} data-quick="summary">
        <div className={styles.heroCopy}>
          <h2>갓 구운 한입 요약</h2>
          {headline && <h3 className={styles.headlinePlaceholder}>{headline}</h3>}
          {!headline && <p className={styles.summaryBody}>{report.summary}</p>}
          {foldSummary && <PrintOpenDetails className="hero-more" summary="요약 펼쳐 보기"><p className={styles.summaryBody}>{report.summary}</p></PrintOpenDetails>}
          {/* 답에 영향을 준 자료 부족은 요약 아래 짧게 (11/20 하니 5) */}
          {report.dataGaps.length > 0 && <p className="hero-gaps"><ReportSectionLink name="gaps" label={`확인하지 못한 자료 ${report.dataGaps.length}개 · 아래 주의점에 적었어요`} /></p>}
          {/* 11/25 사용자: '나에게' 줄 대신 아래로 이끄는 한 줄 */}
          <p className={styles.heroNudge}>자세한 내용은 아래에서 확인해 봐요 <span aria-hidden="true">↓</span></p>
        </div>
        {/* 갓 구운 머핀: 튀어 오르기 · 둥실 · 따뜻한 빛 · 반짝이 (11/25 사용자. 움직임 줄이기 설정 · 인쇄 때는 멈춤) */}
        <div className={styles.heroArt} aria-hidden="true">
          <Image src={resultMuffin} alt="" fill sizes="(max-width: 560px) 64px, 150px" />
          <span className={styles.sparkle} /><span className={styles.sparkle} /><span className={styles.sparkle} />
        </div>
      </section>

      {report.numbers.length > 0 ? (
      <section className={styles.metrics} data-quick="numbers">
        <div className="metrics-heading"><h2>오늘의 숫자</h2></div>
        <div className="numbers" data-count={cards.length}>
          {cards.map(card => {
            const n = card.main;
            const i = card.index;
            const change = n.change && !/^이번\s*주$/.test(n.change.trim())
              ? reportChange(n.change, n.changeDetail)
              : null;
            const detail = trustedChangeDetail(n.changeDetail);
            const showsChange = !!change && !repeatsValue(n.value, detail);
            const entry = report.evidence.find(item => item.id === n.ref);
            const source = entry?.source;
            const check = report.verification.status === "skipped" ? "unverified" : n.check;
            const tone = valueTone(n.value);
            const valueKey = n.match?.key.replace(/#text$/, "");
            const origin = `number-${i}`;
            return (
              <EvidenceOrigin name={origin} className="num" data-kind={check} key={i}>
                <div className="metric-label"><small>{n.label}</small></div>
                <EvidenceReference evidenceId={n.ref} evidence={report.evidence} label={`${n.label} ${n.value}의 원본 데이터 보기`} valueKey={valueKey} origin={origin}><b className={tone ?? undefined}>{n.value}</b></EvidenceReference>
                {showsChange && <i className={change.direction}><span aria-hidden="true">{change.direction === "up" ? "↑ " : change.direction === "down" ? "↓ " : ""}</span>{change.text}</i>}
                {/* 11/24 가독성: 카드는 값 · 변화 · 기준일과 출처 · 근거 보기만. 검사 배지 · 기준 안내는 근거 보기(출처 카드)에서 봅니다.
                    비교 기간은 값이 곧 변화량이라 변화 줄을 숨긴 카드에만 남깁니다 (그래야 무엇과 비교한 값인지 남음) */}
                {!showsChange && detail?.from && detail.to && <small className="metric-period">비교 기간 <span className="nowrap">{formatDateKo(detail.from)}</span> → <span className="nowrap">{formatDateKo(detail.to)}</span></small>}
                {card.subs.length > 0 && (() => {
                  const rows = subRows(card.subs, n.asOf, report.verification.status === "skipped");
                  const shared = rows.length >= 2 && rows.every(row => row.detail && row.detail === rows[0]!.detail) ? rows[0]!.detail : null;
                  return <>
                    <ul className="num-subs">{rows.map(row => <li key={row.index}><span className="num-sub-label">{row.label}</span><b className={valueTone(row.value) ?? undefined}>{row.value}</b>{!shared && row.detail && <small className="num-sub-detail">{row.detail}</small>}</li>)}</ul>
                    {shared && <small className="num-subs-shared">{shared}</small>}
                  </>;
                })()}
                <div className={styles.metricMeta}>
                  <span className={styles.metricDate}>{n.asOf ? `기준일 ${formatDateKo(n.asOf)}` : "자료 날짜 미제공"}</span>
                  {/* 카드에는 출처 이름 끝의 괄호 설명을 떼고 짧게 (전체 이름은 근거 보기에). 11/24 가독성: 카드마다 출처 줄이 두세 줄로 접혔음 */}
                  {source && <span className="metric-source" title={source.name}>{shortSourceName(source.name)}</span>}
                  {source && <span className={styles.metricActions}><EvidenceReference evidenceId={n.ref} evidence={report.evidence} label={`${n.label} 근거 보기 · ${check === "reported" && entry && isBokRelease(entry) ? "보도자료" : checkLabels[check]}`} valueKey={valueKey} origin={origin}><span>근거 보기</span></EvidenceReference></span>}
                </div>
              </EvidenceOrigin>
            );
          })}
        </div>
        <div className={styles.reportToolbar}><ReportHelp /></div>
      </section>
      ) : newsEntries.length > 0 ? (
      /* 기사로만 만든 리포트는 숫자 칸 대신 확인한 기사 수를 보여 줍니다 (11/20 QA 12) */
      <section className={styles.metrics} data-quick="numbers">
        <div className="metrics-heading"><h2>확인한 기사</h2></div>
        <p className="news-count">{newsCountLine(newsEntries)}</p>
        <p className="report-muted news-only-note">숫자 자료 없이 기사로 만든 리포트예요. 기사 원문은 아래 출처에서 바로 열 수 있어요.</p>
        <div className={styles.reportToolbar}><ReportHelp /></div>
      </section>
      ) : (
      /* 숫자도 기사도 없으면 "확보하지 못했습니다" 칸을 두지 않고 숨깁니다 (11/20 QA 11) */
      <div className={styles.toolbarRow}><ReportHelp /></div>
      )}

      <div className={styles.columns}>
        <div className={styles.story}>
          {/* 원인을 묻지 않은 질문은 원인이 없어도 빈 칸 안내를 띄우지 않고 칸을 숨깁니다 (11/20 QA) */}
          {(report.why.length > 0 || whyNote) && <section className={styles.why} data-quick="story">
            <h2>숫자 너머의 이야기</h2>
            {report.why.length === 0 ? (
              <p className="why-note">{whyNote}</p>
            ) : (
              <ol className="why-list">
                {report.why.map((w, i) => (
                  <li key={i}>
                    {/* 11/25 가독성: 등급 설명 문장은 배지 풍선 · 리포트 읽는 법으로. AI 해석이라는 '근거 부족' 만 문장을 그대로 둡니다 */}
                    <span className="basis-explanation"><strong className={`report-badge basis-${w.basis}`} title={basisLabel(w)}>{tags[w.basis]}</strong>{w.basis === "none" && <> {basisLabel(w)}</>}</span>{" "}
                    {/* 굵은 문장을 거의 되풀이하는 설명은 뺍니다 (숫자 · 날짜를 더하는 설명은 그대로) */}
                    <ReasonEvidenceTarget index={i}><h3>{w.claim}</h3>{w.evidence && w.evidence !== w.claim && !repeatsClaim(w.evidence, w.claim) && <p>{w.evidence}</p>}</ReasonEvidenceTarget>
                    <ReasonLinks refs={w.refs} evidence={report.evidence} />
                  </li>
                ))}
              </ol>
            )}

          </section>}
      {headline && !foldSummary && <p className={styles.summaryBody}>{report.summary}</p>}

          {report.impact.length > 0 && <section data-quick="impact">
            <h2>내 생활에 미치는 영향</h2>
            <div className="impact-grid">{report.impact.map((w, i) => <article className="impact-card" key={i}>{impactTitles[i] && <h3><span aria-hidden="true">{/여행|해외/.test(impactTitles[i]) ? "✈️" : /자산|보유/.test(impactTitles[i]) ? "💰" : /상품|비교/.test(impactTitles[i]) ? "🔎" : /예금|적금/.test(impactTitles[i]) ? "🏦" : /물가|장보기/.test(impactTitles[i]) ? "🛒" : /뉴스/.test(impactTitles[i]) ? "📰" : "💡"}</span> {impactTitles[i]}</h3>}<p>{w}</p></article>)}</div>
          </section>}

          {report.charts && report.charts.length > 0 && (
            <section data-quick="chart">
              <h2>{report.charts.every(c => c.kind === "bar") ? "숫자 한눈에 비교" : "숫자의 변화 추이"}</h2>
              {report.charts.map((c, i) => (
                <ReportChart key={i} chart={c} evidence={report.evidence} />
              ))}
            </section>
          )}
        </div>
      </div>

      {(report.evidence.length > 0 || report.sources.length > 0) && <ReportSources report={report} />}

      <ReportVerification report={report}>
        {report.notice && report.mode === "research" && <section className="verification-context"><h2>움직임 비교 · 참고 정보</h2><p className="report-notice">{report.notice}</p></section>}

      </ReportVerification>

      {showReference && <section className="report-verification report-reference" data-user-empty={report.caveats.length === 0 && report.dataGaps.length === 0 ? "true" : undefined} aria-label="주의점과 자료 범위">
        {/* 주의점 · 확인하지 못한 것은 접지 않고 항상 보여 줍니다 (11/20 하니 리뷰). details 는 제외 항목 링크의 대상 구조를 위해 두고 open 으로 고정 */}
        <details className="verification-toggle reference-toggle" open>
          <summary tabIndex={-1}>
            {/* 11/25 가독성: 개수 줄은 바로 아래 목록과 같은 말이라 빼고, 제목은 있는 것만 */}
            <span className="verification-summary-copy"><strong><span className="verification-icon" aria-hidden="true">i</span> {referenceTitle}</strong></span>
          </summary>
          <div className="verification-body" aria-label="자료 범위">
            {report.caveats.length > 0 && <section>{referenceParts.length > 1 && <h2>주의점</h2>}<ul>{report.caveats.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}
            {report.dataGaps.length > 0 && <section><ReportSectionTarget name="gaps">{referenceParts.length > 1 && <h2>확인하지 못한 것</h2>}<ul>{report.dataGaps.map((item, i) => <li key={i}>{item}</li>)}</ul></ReportSectionTarget></section>}
        {report.verification.removed.length > 0 && <section className="verification-only"><ReportSectionTarget name="removed"><h2>검사 후 제외한 항목</h2><ul>{report.verification.removed.map((item, i) => <li key={i}>{item}</li>)}</ul></ReportSectionTarget></section>}

        {toolNotes.length > 0 && <section className="report-tools">{referenceParts.length > 1 && <h2>자료 확인 메모</h2>}
          <ul>{toolNotes.map((step, i) => <li key={i}>{labelFor(step.tool)}: {step.status === "error"
            ? `자료를 받지 못했어요${/timeout|시간|초과/i.test(step.error ?? "") ? " (응답 시간 초과)" : ""}`
            : step.breaker === "open" ? "잠시 호출을 쉬고 있어 이번에는 부르지 않았어요"
            : `${formatAge(step.fallbackAgeMs ?? 0)} 전에 저장해 둔 응답을 썼어요`}</li>)}</ul>
        </section>}
          </div>
        </details>
      </section>}

      {/* 추천은 맨 끝에 두어 검증 · 주의점과 섞이지 않게 (11/20 외부 E2) */}
      {nextTopics.length > 0 && <section className={styles.nextTopics}>
        <ReportResponsiveDetails className="report-fold" summary={<h2>이어서 알아볼까요?</h2>}>
        <div className={styles.topicGrid}>{nextTopics.map((topic, i) => <Link key={i} href={`/?question=${encodeURIComponent(topic.question)}&area=${topic.area}`} className={styles.topicLink}><span><strong>{topic.question}</strong><small>{topic.reason}</small></span><span className="topic-action" aria-hidden="true">→</span></Link>)}</div>
        </ReportResponsiveDetails>
      </section>}
      {/* 추천이 있든 없든 이어서 물어볼 길을 항상 둡니다 (11/21 QA 최종리포트 마무리 문구 제안, Codex 리뷰: 추천이 비면 링크도 사라지던 것) */}
      <p className="report-continue"><Link href={area ? `/?area=${area}` : "/"}>더 궁금한 점이 있으면 홈에서 이어서 물어보세요 →</Link></p>

      {/* 11/25 사용자: '투자 권유' 문장 앞에서 줄을 바꿈 */}
      <p className="report-disclosure">{disclosureLines(report.disclosure).flatMap((line, i) => [...(i > 0 ? [" "] : []), <span key={i}>{line}</span>])}</p>
    </ReportDisplay>
    </ReportEvidenceScope>
    </div>
  );
}
