/**
 * ETF 이름 → 종목코드. 공공데이터포털에서 받아 둔 목록(`etf-list.json`)에서 API 없이 찾습니다.
 * 이름 조회는 API 를 최대 3번(정확 일치 → 부분 일치 후보 → 코드) 불러야 해서, 목록에서 코드를 먼저 찾으면 1번으로 줄어듭니다.
 *
 * 사람이 쓰는 표기를 목록 이름에 맞춥니다.
 *  - 공백 · 대소문자 무시: `KODEX200`, `kodex 200` → `KODEX 200`
 *  - 한글 · 예전 브랜드: `코덱스 200` → KODEX, `KBSTAR` → RISE, `KINDEX` → ACE, `ARIRANG` → PLUS
 *  - 앞에 붙은 운용사: `삼성 KODEX 200` → `KODEX 200`
 *  - 끝에 붙은 ETF: `KODEX 200 ETF` → `KODEX 200`
 *  - 해외 지수 ETF 의 "미국" 생략: `TIGER S&P500` → `TIGER 미국S&P500`
 * 목록에 없으면(새로 상장 등) 지금처럼 API 이름 조회로 넘어갑니다. 목록은 `pnpm tool src/tools/etf/build-list.ts` 로 새로 받습니다.
 */
import list from "./etf-list.json";

export type EtfListFile = { updatedAt: string; source: string; items: [code: string, name: string][] };

/** 한글 · 예전 이름 → 지금 브랜드 (정규화한 모양, 대문자 · 공백 없음) */
const BRAND_ALIASES: Record<string, string> = {
  코덱스: "KODEX",
  타이거: "TIGER",
  라이즈: "RISE",
  KBSTAR: "RISE",
  케이비스타: "RISE",
  에이스: "ACE",
  KINDEX: "ACE",
  킨덱스: "ACE",
  플러스: "PLUS",
  ARIRANG: "PLUS",
  아리랑: "PLUS",
  쏠: "SOL",
  솔: "SOL",
  키움: "KIWOOM",
  KOSEF: "KIWOOM",
  코세프: "KIWOOM",
  하나로: "HANARO",
  원큐: "1Q",
  코액트: "KOACT",
  타임: "TIME",
  타임폴리오: "TIME",
  TIMEFOLIO: "TIME",
};

/** 브랜드 앞에 붙여 쓰는 운용사 이름 */
const ISSUERS = [
  "삼성자산운용",
  "미래에셋자산운용",
  "KB자산운용",
  "한국투자신탁운용",
  "신한자산운용",
  "NH아문디",
  "한화자산운용",
  "키움자산운용",
  "미래에셋",
  "한국투자",
  "삼성",
  "한투",
  "신한",
  "한화",
  "KB",
  "NH",
];

/** 상품명 안의 영어 · 한글 표기 맞추기 */
const WORD_ALIASES: [RegExp, string][] = [
  [/NASDAQ/g, "나스닥"],
  [/에스앤피|에스엔피|SNP/g, "S&P"],
];

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/(ETF|이티에프)$/, "");
}

const items = (list as EtfListFile).items;
const entries = items.map(([code, name]) => ({ code, name, key: normalize(name) }));
const byKey = new Map(entries.map((e) => [e.key, e]));
// 별칭 · 브랜드 · 운용사는 모두 긴 것부터 비교합니다. 짧은 것이 먼저 걸리면 `타임폴리오` 가 `타임` + `폴리오` 로 잘립니다.
const longestFirst = (a: string, b: string) => b.length - a.length;
const brands = [...new Set(entries.map((e) => normalize(e.name.split(" ")[0])))].sort(longestFirst);
const aliases = Object.entries(BRAND_ALIASES).sort(([a], [b]) => longestFirst(a, b));
const issuers = ISSUERS.map(normalize).sort(longestFirst);

/** 질문 표기를 목록 표기로: 운용사 떼기 → 브랜드 별칭 → 상품명 단어 맞추기 */
function canonical(query: string): { key: string; brand?: string; rest: string } {
  let key = normalize(query);
  for (const [word, to] of WORD_ALIASES) key = key.replace(word, to);

  const brandAt = (k: string) => {
    for (const [alias, to] of aliases) if (k.startsWith(alias)) return { brand: to, rest: k.slice(alias.length) };
    const brand = brands.find((b) => k.startsWith(b));
    return brand ? { brand, rest: k.slice(brand.length) } : undefined;
  };

  let hit = brandAt(key);
  if (!hit) {
    const issuer = issuers.find((i) => key.startsWith(i));
    const stripped = issuer ? brandAt(key.slice(issuer.length)) : undefined;
    if (stripped) hit = stripped;
  }
  return hit ? { key: hit.brand + hit.rest, brand: hit.brand, rest: hit.rest } : { key, rest: key };
}

export type NameLookup = { code: string; name: string } | { candidates: { code: string; name: string }[] } | null;

/**
 * 하나로 정해지면 { code, name }, 여러 개면 { candidates }(이름이 짧은 순), 없으면 null.
 * 정확히 같은 이름이 먼저이고, 그다음 "미국" 을 뺀 해외 지수 표기, 마지막으로 같은 브랜드 안의 부분 일치입니다.
 */
export function lookupName(query: string): NameLookup {
  const { key, brand, rest } = canonical(query);
  if (!key) return null;
  const exact = byKey.get(key);
  if (exact) return { code: exact.code, name: exact.name };

  if (brand && rest) {
    const overseas = byKey.get(`${brand}미국${rest}`);
    if (overseas) return { code: overseas.code, name: overseas.name };
  }

  const pool = brand ? entries.filter((e) => e.key.startsWith(brand) && e.key.slice(brand.length).includes(rest)) : entries.filter((e) => e.key.includes(key));
  if (pool.length === 0) return null;
  if (pool.length === 1) return { code: pool[0].code, name: pool[0].name };
  return { candidates: [...pool].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)).map(({ code, name }) => ({ code, name })) };
}

export const listUpdatedAt = (list as EtfListFile).updatedAt;
