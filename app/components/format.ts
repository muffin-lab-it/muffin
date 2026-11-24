import type { Evidence } from "@/src/agent/schema";

/** 날짜 표기 통일 (11/20 외부 F13): "2026-11-20" → "2026. 11. 20.". 시간이 붙은 ISO 는 날짜만 쓰고, 그 밖의 값은 그대로 둡니다. */
export function formatDateKo(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match) return `${match[1]}. ${Number(match[2])}. ${Number(match[3])}.`;
  // 월 단위 지표(CPI · 실업률)의 기준일 "2026-10" 은 "2026. 10." (11/22 운영: 물가 카드에 "기준일 2026-10" 이 그대로 나옴)
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
  if (month) return `${month[1]}. ${Number(month[2])}.`;
  return value;
}

const DAY = String.raw`(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])`;
const MONTH = String.raw`(\d{4})-(0[1-9]|1[0-2])`;
// 앞뒤가 숫자 · 영문 · 주소 기호면 날짜가 아닌 것으로 봅니다 (주소 · "2026-11-20T09:00" · "2026-13")
const NOT_BEFORE = String.raw`(?<![\dA-Za-z/.:-])`;
const NOT_AFTER = String.raw`(?![\dA-Za-z/:-])`;
const md = (m: string, d: string) => `${Number(m)}월 ${Number(d)}일`;
const RANGE_RE = new RegExp(String.raw`${NOT_BEFORE}${DAY}\s*([~–])\s*${DAY}${NOT_AFTER}`, "g");
const DAY_RE = new RegExp(`${NOT_BEFORE}${DAY}${NOT_AFTER}`, "g");
const MONTH_WOL_RE = new RegExp(`${NOT_BEFORE}${MONTH}월`, "g");
const MONTH_RE = new RegExp(`${NOT_BEFORE}${MONTH}${NOT_AFTER}`, "g");

/**
 * 모델이 쓴 문장 속 날짜를 한국어로 (11/22 운영: "2026-10월 2.5%예요"). 장부의 "2026-10" · "2026-11-20" 을 그대로 옮겨 생깁니다.
 * "2026-10월" · "2026-10" → "2026년 10월", "2026-11-20" → "2026년 11월 20일", 해가 같은 기간 "2026-10-20~2026-11-19" → "2026년 10월 20일~11월 19일".
 * 화면에 보일 때만 바꿉니다. 검증은 이미 끝났고, 원본 데이터 표는 원본 그대로 둡니다.
 */
export function prettyDates(text: string): string {
  return text
    .replace(RANGE_RE, (_all, y1: string, m1: string, d1: string, sep: string, y2: string, m2: string, d2: string) =>
      `${y1}년 ${md(m1, d1)}${sep}${y1 === y2 ? "" : `${y2}년 `}${md(m2, d2)}`)
    .replace(DAY_RE, (_all, y: string, m: string, d: string) => `${y}년 ${md(m, d)}`)
    .replace(MONTH_WOL_RE, (_all, y: string, m: string) => `${y}년 ${Number(m)}월`)
    .replace(MONTH_RE, (_all, y: string, m: string) => `${y}년 ${Number(m)}월`);
}

/** 화면에 보일 리포트 문장에 prettyDates 를 적용한 사본. 값 · 기준일 · 장부(원본 데이터)는 건드리지 않습니다 */
export function prettyReport<R extends {
  summary: string; headline?: string | null; notice?: string | null;
  why: { claim: string; evidence: string }[]; impact: string[]; impactTitles?: string[];
  caveats: string[]; dataGaps: string[];
  numbers: { label: string; change: string; asOf?: string | null; ref?: string | null }[];
  verification: { removed: string[] };
  evidence?: { id: string; tool: string; label: string; source: { name: string; url?: string; asOf?: string | null } }[];
  sources?: { name: string; url?: string; asOf?: string | null }[];
}>(report: R): R {
  const p = prettyDates;
  // 물가 · 고용 지표는 월 단위라 "2026-10-01" 도 "2026. 10." 로 (11/23 운영 검수: 같은 물가 카드가 "기준일 2026. 10." · "2026. 10. 1." 로 섞임)
  const monthly = new Set((report.evidence ?? []).filter(e => /macro|cpi/i.test(e.tool)).map(e => e.id));
  const monthOf = (value: string) => /^\d{4}-\d{2}-01$/.test(value) ? value.slice(0, 7) : value;
  // 자료 목록(sources)은 장부와 주소 · 이름 · 기준일로 짝을 맞추므로, 월 단위 장부와 같은 자료면 기준일도 같이 바꿉니다 (Codex 리뷰: 한쪽만 바꾸면 '참고 문서' 에 같은 출처가 한 번 더 나옴)
  const sourceKey = (source: { name: string; url?: string; asOf?: string | null }) => `${source.url ?? ""}|${source.name}|${source.asOf ?? ""}`;
  const monthlySources = new Set((report.evidence ?? []).filter(e => monthly.has(e.id)).map(e => sourceKey(e.source)));
  return {
    ...report,
    summary: p(report.summary),
    ...(report.headline ? { headline: p(report.headline) } : {}),
    ...(report.notice ? { notice: p(report.notice) } : {}),
    why: report.why.map(w => ({ ...w, claim: p(w.claim), evidence: p(w.evidence) })),
    impact: report.impact.map(p),
    ...(report.impactTitles ? { impactTitles: report.impactTitles.map(p) } : {}),
    caveats: report.caveats.map(p),
    dataGaps: report.dataGaps.map(p),
    numbers: report.numbers.map(n => ({ ...n, label: p(n.label), change: p(n.change), ...(n.ref && monthly.has(n.ref) && n.asOf ? { asOf: monthOf(n.asOf) } : {}) })),
    verification: { ...report.verification, removed: report.verification.removed.map(p) },
    // 출처 이름 · 장부 라벨의 기간도 (11/23 운영 검수: 계산 카드 아래 "Frankfurter v2 일별 환율 (2026-07-27 ~ 2026-11-23)" 이 휴대폰에서 날짜 중간에 줄바꿈).
    // 자료 목록(sources)도 같이 바꿔야 출처 묶음이 이름으로 장부와 짝을 맞춥니다
    ...(report.evidence ? { evidence: report.evidence.map(e => ({ ...e, label: p(e.label), source: { ...e.source, name: p(e.source.name), ...(monthly.has(e.id) && e.source.asOf ? { asOf: monthOf(e.source.asOf) } : {}) } })) as R["evidence"] } : {}),
    ...(report.sources ? { sources: report.sources.map(s => ({ ...s, name: p(s.name), ...(s.asOf && monthlySources.has(sourceKey(s)) ? { asOf: monthOf(s.asOf) } : {}) })) as R["sources"] } : {}),
  };
}

/** 본값이 변화량(+2.82% · −0.56%p)인 숫자 카드는 오름 빨강 · 내림 파랑 (11/20 외부 F10). 수준값(3.00%)은 색을 두지 않습니다. */
export function valueTone(value: string): "tone-up" | "tone-down" | null {
  const text = value.trim();
  if (!/%p?$/.test(text)) return null;
  if (/^[+＋]/.test(text)) return "tone-up";
  if (/^[-−]/.test(text)) return "tone-down";
  return null;
}

export function isNewsEvidence(entry: Pick<Evidence, "tool">): boolean {
  return /news/i.test(entry.tool);
}

/** 환율 카드 아래 기준 설명 한 줄 (11/20 서영 1-1 · 외부 G2: 은행 고시와 달라 보여 틀린 줄 알았던 것). 환율 tool 장부에만 붙습니다. */
export function fxBasisNote(tool: string, sourceName: string): string | null {
  if (!/fx/i.test(tool)) return null;
  if (/frankfurter|ecb|유럽중앙은행/i.test(sourceName)) return "유럽중앙은행 고시 기준 · 하루 1회 갱신 · 은행 환율과 다를 수 있어요";
  if (/ecos|한국은행/i.test(sourceName)) return "한국은행 고시 기준 · 하루 1회 갱신 · 은행 환율과 다를 수 있어요";
  return "일별 기준 환율 · 은행 환율과 다를 수 있어요";
}

/** ETF 카드 아래 한 줄: 무엇을 따라가는 상품인지 (11/21 QA-02: 상품명만 있고 설명이 없어 숫자 카드만 읽는 사람은 모름) */
export function etfBasisNote(entry: Pick<Evidence, "tool" | "values">): string | null {
  if (!/etf/i.test(entry.tool)) return null;
  const base = entry.values.baseIndex;
  if (typeof base !== "string" || !base.trim()) return null;
  return `${base.trim()} 지수를 따라가는 국내 상장 ETF`;
}

/** 출처 링크 라벨. API 응답 주소는 눌러도 JSON 이라 그렇다고 말해 줍니다 (11/20 서영 2-1). */
export function sourceLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (/^api\./i.test(parsed.hostname) || /\/api\/|\/v\d+\//.test(parsed.pathname) || /serviceKey|format=json|\.json$/i.test(path)) return "원본 응답(JSON) ↗";
  } catch {
    // 주소가 아니면 SourceLink 가 링크로 만들지 않습니다.
  }
  return "출처 사이트 ↗";
}

function publisherOf(entry: Evidence): string {
  const value = entry.values.publisher;
  return typeof value === "string" && value.trim() ? value : entry.source.name;
}

/** 기사로만 만든 리포트의 숫자 칸 대신 보여 주는 한 줄 (11/20 QA 12): "기사 5건 · 2026. 11. 20. · 연합뉴스" */
export function newsCountLine(entries: Evidence[]): string {
  const dates = entries
    .map(entry => (typeof entry.values.publishedAt === "string" ? entry.values.publishedAt : entry.source.asOf) ?? "")
    .map(value => value.slice(0, 10))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  const publishers = [...new Set(entries.map(publisherOf))];
  const named = publishers.length > 3 ? `${publishers.slice(0, 3).join(" · ")} 외 ${publishers.length - 3}곳` : publishers.join(" · ");
  const range = dates.length === 0 ? "날짜 미제공" : dates[0] === dates[dates.length - 1] ? formatDateKo(dates[0]) : `${formatDateKo(dates[0])} ~ ${formatDateKo(dates[dates.length - 1])}`;
  return `기사 ${entries.length}건 · ${range} · ${named}`;
}

export { publisherOf };

/** 기사 제목 끝의 " - 언론사" 는 언론사를 따로 보일 때 뗍니다 (Google News 제목 꼴. 11/24: 제목과 언론사가 두 번 보임) */
export function titleWithoutPublisher(title: string, publisher?: string): string {
  if (!publisher) return title;
  const escaped = publisher.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = title.replace(new RegExp(`\\s+[-–—|]\\s+${escaped}\\s*$`), "").trim();
  return stripped.length > 0 ? stripped : title;
}
