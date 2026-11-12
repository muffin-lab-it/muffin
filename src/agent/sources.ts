/**
 * 출처의 "사람이 읽는 주소" (리더, 11/10). tool 이 남긴 url 이 API 주소면 공식 페이지 주소를 pageUrl 로 덧붙입니다. 이미 페이지면 붙이지 않습니다.
 * tool 은 바꾸지 않고 여기 표만 늘립니다. 화면은 `pageUrl ?? url` 을 엽니다. 리포트를 만들 때(assembleReport)와 저장된 리포트를 읽을 때(normalizeReport) 둘 다 거칩니다.
 */
type Rule = { host: RegExp; page: (u: URL) => string | undefined };

const RULES: Rule[] = [
  // Frankfurter (ECB 고시 환율 API). 환율 tool 과 유의성 게이트의 일별 환율
  { host: /(^|\.)frankfurter\.(dev|app)$/, page: () => "https://frankfurter.dev/" },
  // ECB 환율 원자료 (게이트의 ECB 폴백은 eurofxref 파일 주소)
  {
    host: /(^|\.)ecb\.europa\.eu$/,
    page: (u) => (/eurofxref/.test(u.pathname) ? "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" : undefined),
  },
  // 한국은행 ECOS API → ECOS 홈 (통계표 주소는 통계 코드마다 달라 홈으로)
  { host: /^ecos\.bok\.or\.kr$/, page: (u) => (u.pathname.startsWith("/api/") ? "https://ecos.bok.or.kr/" : undefined) },
  // FRED API → 시계열 페이지 (series_id)
  {
    host: /^api\.stlouisfed\.org$/,
    page: (u) => {
      const id = u.searchParams.get("series_id");
      return id ? `https://fred.stlouisfed.org/series/${id}` : "https://fred.stlouisfed.org/";
    },
  },
  // 공공데이터포털 API → 데이터 상품 페이지 (ETF 시세는 금융위원회 증권상품시세정보)
  { host: /^apis\.data\.go\.kr$/, page: (u) => (/GetSecuritiesProductInfoService/i.test(u.pathname) ? "https://www.data.go.kr/data/15094806/openapi.do" : "https://www.data.go.kr/") },
];

/** url 이 표에 있는 API 주소면 공식 페이지 주소, 아니면 undefined (이미 페이지거나 모르는 주소) */
export function pageUrlFor(url: string): string | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  for (const r of RULES) if (r.host.test(u.hostname)) return r.page(u);
  return undefined;
}

/** pageUrl 이 url 과 다를 때만 붙입니다. 이미 있으면 그대로 */
export function withPageUrl<T extends { url: string; pageUrl?: string }>(source: T): T {
  if (source.pageUrl) return source;
  const page = pageUrlFor(source.url);
  return page && page !== source.url ? { ...source, pageUrl: page } : source;
}

/** 리포트의 출처 목록과 증거 장부에 pageUrl 을 채웁니다. 저장된 리포트를 읽을 때 씁니다 */
export function withPageUrls<T extends { sources: { url: string; pageUrl?: string }[]; evidence: { source: { url: string; pageUrl?: string } }[] }>(report: T): T {
  return { ...report, sources: report.sources.map(withPageUrl), evidence: report.evidence.map((e) => ({ ...e, source: withPageUrl(e.source) })) };
}
