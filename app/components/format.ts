import type { Evidence } from "@/src/agent/schema";

/** 날짜 표기 통일 (11/20 외부 F13): "2026-11-20" → "2026. 11. 20.". 시간이 붙은 ISO 는 날짜만 쓰고, 그 밖의 값은 그대로 둡니다. */
export function formatDateKo(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value;
  return `${match[1]}. ${Number(match[2])}. ${Number(match[3])}.`;
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
