/**
 * Tool 없음 기준선의 순수 부분 (리더). run.ts 가 CLI 로 감쌉니다.
 * 같은 질문을 같은 모델에게 tool · 장부 · 검증 없이 물어본 답(기준선)과 Muffin 리포트를 같은 잣대로 잽니다:
 * 숫자 수 · 근거로 확인된 숫자 · 출처 링크 수와 실제로 열리는 비율 · 가장 최근 기준일 · 권유 문장 · "확인 못 했다" 고 밝힌 수 · 시간 · 토큰.
 */
import { findAdvice, hasAdvice } from "../../src/agent/guard";
import type { Depth, Report } from "../../src/agent/schema";
import { extractNumbers, isDataNumber } from "../../src/agent/verify";

export const BASELINE_NAME = "Tool 없음 기준선";

/** 기준선 지시문. Muffin 작성 단계와 같은 역할 · 같은 구성 · 같은 권유 금지 규칙이고, 다른 점은 tool 데이터(장부)가 없다는 것뿐입니다 */
export function baselineInstructions(depth: Depth): string {
  const depthLine = { easy: "쉽게 핵심만 짧게 씁니다.", standard: "핵심과 배경을 균형 있게 씁니다.", deep: "배경과 맥락까지 깊이 있게 씁니다." }[depth];
  return [
    "너는 한국의 개인 투자자에게 금융 정보를 설명하는 리서치 도우미다. 질문에 한국어로 답한다.",
    depthLine,
    "답에는 구체적인 숫자(환율 · 가격 · 금리 · 지표)와 그 숫자의 기준일, 참고한 출처(이름과 링크)를 함께 적는다.",
    "구성: 한입 요약 · 오늘의 숫자 · 왜 그럴까요 · 나에게 미치는 영향 · 주의점 · 출처.",
    "매수 · 매도 · 비중 조절 같은 투자 권유 표현은 쓰지 않는다. 사실과 원인, 영향만 쓴다.",
  ].join("\n");
}

export type Tokens = { input: number; output: number };
export type SideMetrics = {
  chars: number;
  /** 사용자가 보는 글에서 서로 다른 데이터 숫자 수 (값 + 단위 기준, 연도 · 기준 단위 · 링크 속 숫자 제외). 양쪽 같은 잣대 */
  numbers: number;
  /** 근거 장부로 확인된 숫자 카드 수 (기준선은 장부가 없어 항상 0) */
  verifiable: number;
  /** 숫자 카드 수 (Muffin 의 "오늘의 숫자"). 기준선은 카드가 없어 0 */
  cards: number;
  urls: string[];
  /** 글에 적힌 기준일들 (ISO) */
  dates: string[];
  latestDate: string | null;
  /** 오늘에서 가장 최근 기준일까지 며칠 전인지. 날짜가 없으면 null */
  daysOld: number | null;
  /** 권유 문장 수 */
  advice: number;
  /** "확인할 수 없다" 처럼 모른다고 밝힌 수 (Muffin 은 dataGaps) */
  admitted: number;
  ms: number;
  tokens: Tokens | null;
  model: string;
};

const URL_RE = /https?:\/\/[^\s<>"'()\[\]）」』]+/g;
const HEDGE_RE = /(실시간|최신|현재|오늘)\s*(정보|데이터|값|시세|환율|가격)[^.。\n]{0,20}(알\s*수\s*없|확인(할|하기)\s*(수\s*없|어렵)|제공(할|하기)\s*(수\s*없|어렵)|접근(할|하기)\s*(수\s*없))|확인(할|하기)\s*(수\s*없|어렵)|알\s*수\s*없습니다|정확하지\s*않을\s*수|달라졌을\s*수/;

const DATE_FULL = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g;
const DATE_MONTH = /(\d{4})\s*년\s*(\d{1,2})\s*월/g;
const DATE_DAY = /(?<![\d.])(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;

/** 날짜 표기를 모두 지웁니다 ("10월 25일" 의 10 · 25 가 데이터 숫자로 세어지지 않게) */
export function stripDates(text: string): string {
  return text.replace(DATE_FULL, " ").replace(DATE_MONTH, " ").replace(DATE_DAY, " ");
}

/** 링크 · 날짜를 뺀 글에서 서로 다른 데이터 숫자 (값 + 단위) */
export function distinctNumbers(text: string): number {
  const stripped = stripDates(text.replace(URL_RE, " "));
  return new Set(extractNumbers(stripped).filter(isDataNumber).map((n) => `${n.value}${n.unit}`)).size;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** ISO 날짜 하나로. 달력에 없는 날(2월 31일)은 null */
function iso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 글 속 날짜: 2026-10-25 · 2026.10.25 · 2026년 10월 25일 · 2026년 10월(1일로) · 10월 25일(올해, 미래면 작년) */
export function extractDates(raw: string, today: string): string[] {
  const year = Number(today.slice(0, 4));
  const found = new Set<string>();
  // 링크 경로의 날짜(…/2026/11/05/news)는 글의 기준일이 아닙니다
  const text = raw.replace(URL_RE, " ");
  for (const m of text.matchAll(DATE_FULL)) {
    const d = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) found.add(d);
  }
  const stripped = text.replace(DATE_FULL, " ");
  for (const m of stripped.matchAll(DATE_MONTH)) {
    const d = iso(Number(m[1]), Number(m[2]), 1);
    if (d) found.add(d);
  }
  const stripped2 = stripped.replace(DATE_MONTH, " ");
  for (const m of stripped2.matchAll(DATE_DAY)) {
    let d = iso(year, Number(m[1]), Number(m[2]));
    if (d && d > today) d = iso(year - 1, Number(m[1]), Number(m[2]));
    if (d) found.add(d);
  }
  return [...found].sort();
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 기준선 답(자유 글)을 잽니다 */
export function analyzeAnswer(text: string, { today, ms, tokens, model }: { today: string; ms: number; tokens: Tokens | null; model: string }): SideMetrics {
  const urls = [...new Set([...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?]+$/, "")))];
  const dates = extractDates(text, today);
  const latestDate = dates.length ? dates[dates.length - 1]! : null;
  const sents = sentences(text);
  return {
    chars: text.length,
    numbers: distinctNumbers(text),
    verifiable: 0,
    cards: 0,
    urls,
    dates,
    latestDate,
    daysOld: latestDate ? daysBetween(latestDate, today) : null,
    advice: sents.filter(hasAdvice).length,
    admitted: sents.filter((s) => HEDGE_RE.test(s)).length,
    ms,
    tokens,
    model,
  };
}

/** Muffin 리포트를 같은 잣대로 잽니다 */
export function analyzeReport(report: Report, { today, ms, tokens, model }: { today: string; ms: number; tokens: Tokens | null; model: string }): SideMetrics {
  const dates = [...new Set([...report.sources.map((s) => s.asOf), ...report.numbers.map((n) => n.asOf)].flatMap((d) => extractDates(d, today)))].sort();
  const latestDate = dates.length ? dates[dates.length - 1]! : null;
  // 기준선과 같은 범위: 사용자가 보는 글 전부 (상단 안내 · 숫자 카드의 값 · 변화 · 확인하지 못한 것 포함)
  const text = [report.notice ?? "", report.summary, ...report.numbers.flatMap((n) => [n.label, n.value, n.change]), ...report.why.map((w) => `${w.claim} ${w.evidence}`), ...report.impact, ...report.caveats, ...report.dataGaps].join("\n");
  return {
    chars: text.length,
    numbers: distinctNumbers(text),
    verifiable: report.verification.numbers.verified + report.verification.numbers.derived,
    cards: report.numbers.length,
    urls: [...new Set(report.sources.map((s) => s.url).filter(Boolean))],
    dates,
    latestDate,
    daysOld: latestDate ? daysBetween(latestDate, today) : null,
    advice: findAdvice(report).length,
    admitted: report.dataGaps.length,
    ms,
    tokens,
    model,
  };
}

export type UrlCheck = { url: string; status: "live" | "dead" | "unknown"; code?: number; note?: string };

/**
 * 모델이 적은 주소라 아무 데나 요청하면 안 됩니다. http(s) 공개 호스트만 허용하고 localhost · 사설망 · 링크 로컬 · 메타데이터 주소는 거릅니다
 * (호스트 이름이 사설 IP 로 풀리는 경우까지는 막지 못합니다 — 로컬 개발 머신에서 돌리는 스크립트라 그 정도로 둡니다)
 */
export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224) return false;
    return true;
  }
  if (host.includes(":")) {
    // IPv6: 루프백 · 고유 로컬 · 링크 로컬 · 미지정 · IPv4 매핑은 거름
    return !(host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:"));
  }
  return true;
}

const MAX_HOPS = 3;

/**
 * 링크가 실제로 열리는지. 2xx 살아 있음, 404 · 410 · 주소 없음(DNS) 죽음, 403 · 429 · 5xx · 시간 초과는 모름 (봇 차단일 수 있어서).
 * 리디렉션은 자동으로 따라가지 않고 목적지를 안전 검사한 뒤 최대 3번만 따라갑니다. 안전하지 않은 주소는 요청하지 않고 "모름"
 */
export async function checkUrls(urls: string[], fetchImpl: typeof fetch = fetch, { timeoutMs = 6_000, concurrency = 4 } = {}): Promise<UrlCheck[]> {
  const out: UrlCheck[] = new Array(urls.length);
  let next = 0;
  const classify = (code: number): UrlCheck["status"] => (code < 400 ? "live" : code === 404 || code === 410 ? "dead" : "unknown");
  /** 최종 응답. 리디렉션이 MAX_HOPS 안에 끝나지 않으면 null (살아 있다고 볼 수 없음) */
  const request = async (url: string, method: "HEAD" | "GET"): Promise<Response | null> => {
    let current = url;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const res = await fetchImpl(current, { method, redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Mozilla/5.0 muffin-baseline" } });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) return res;
      const target = new URL(location, current).toString();
      if (!isSafeUrl(target)) throw new Error(`unsafe redirect: ${target.slice(0, 60)}`);
      current = target;
    }
    return null;
  };
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i]!;
      if (!isSafeUrl(url)) {
        out[i] = { url, status: "unknown", note: "unsafe url (not requested)" };
        continue;
      }
      try {
        let res = await request(url, "HEAD");
        // HEAD 를 막는 서버가 있어 2xx 가 아니면 GET 으로 한 번 더
        if (res && res.status >= 400) res = await request(url, "GET");
        out[i] = res ? { url, status: classify(res.status), code: res.status } : { url, status: "unknown", note: "redirect not resolved" };
      } catch (err) {
        const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        const dead = /ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_INVALID_URL|Invalid URL/i.test(message) || (err instanceof Error && "cause" in err && /ENOTFOUND|EAI_AGAIN/i.test(String((err as { cause?: unknown }).cause)));
        out[i] = { url, status: dead ? "dead" : "unknown", note: message.slice(0, 80) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, worker));
  return out;
}

export type Row = {
  id: string;
  question: string;
  area?: string;
  depth: Depth;
  baseline: SideMetrics & { text: string; urlChecks: UrlCheck[] };
  muffin: (SideMetrics & { urlChecks: UrlCheck[]; toolsOk: number; toolsFailed: number; fallbacks: number }) | null;
  error?: string;
};

export type Aggregate = {
  questions: number;
  numbersAvg: number;
  /** 확인된 카드 / 카드 */
  verifiableRatio: number | null;
  verifiable: number;
  cards: number;
  urlsAvg: number;
  liveRatio: number | null;
  urlsUnknown: number;
  daysOldMedian: number | null;
  noDate: number;
  adviceTotal: number;
  admittedAvg: number;
  msAvg: number;
  tokensAvg: Tokens | null;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export function aggregate(sides: (SideMetrics & { urlChecks: UrlCheck[] })[]): Aggregate {
  const cards = sides.reduce((n, s) => n + s.cards, 0);
  const verifiable = sides.reduce((n, s) => n + s.verifiable, 0);
  const checks = sides.flatMap((s) => s.urlChecks);
  const live = checks.filter((c) => c.status === "live").length;
  const dead = checks.filter((c) => c.status === "dead").length;
  const withTokens = sides.filter((s) => s.tokens);
  return {
    questions: sides.length,
    numbersAvg: avg(sides.map((s) => s.numbers)),
    verifiableRatio: cards ? verifiable / cards : null,
    verifiable,
    cards,
    urlsAvg: avg(sides.map((s) => s.urls.length)),
    liveRatio: live + dead ? live / (live + dead) : null,
    urlsUnknown: checks.filter((c) => c.status === "unknown").length,
    daysOldMedian: median(sides.flatMap((s) => (s.daysOld === null ? [] : [s.daysOld]))),
    noDate: sides.filter((s) => s.daysOld === null).length,
    adviceTotal: sides.reduce((n, s) => n + s.advice, 0),
    admittedAvg: avg(sides.map((s) => s.admitted)),
    msAvg: avg(sides.map((s) => s.ms)),
    tokensAvg: withTokens.length ? { input: Math.round(avg(withTokens.map((s) => s.tokens!.input))), output: Math.round(avg(withTokens.map((s) => s.tokens!.output))) } : null,
  };
}

const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** 발표용 요약 표 + 질문별 표 + 기준선 답 전문 */
export function renderMarkdown(rows: Row[], { today, label, muffinModel, baselineModel }: { today: string; label: string; muffinModel: string; baselineModel: string }): string {
  const done = rows.filter((r) => r.muffin);
  const b = aggregate(done.map((r) => r.baseline));
  const m = aggregate(done.map((r) => r.muffin!));
  const days = (a: Aggregate) => (a.daysOldMedian === null ? "날짜 없음" : `${n1(a.daysOldMedian)}일 전${a.noDate ? ` (날짜 없음 ${a.noDate}건)` : ""}`);
  const lines = [
    `# Tool 없음 기준선 vs Muffin · ${label}`,
    "",
    `${today} 기준 · 질문 ${done.length}개 · 같은 모델(${baselineModel} / Muffin 작성 ${muffinModel}) · 기준선은 tool · 증거 장부 · 검증 없이 같은 질문에 답한 것입니다. 링크 확인은 실제 접속(HEAD/GET)이고 403 · 5xx · 시간 초과는 "모름" 으로 뺐습니다.`,
    "",
    "| 지표 | Tool 없음 | Muffin |",
    "| --- | --- | --- |",
    `| 글에 쓴 데이터 숫자 (서로 다른 값, 답마다 평균) | ${n1(b.numbersAvg)}개 | ${n1(m.numbersAvg)}개 |`,
    `| 근거 장부로 확인된 숫자 카드 | 0 (장부 없음) | ${m.verifiable}/${m.cards}개 (${pct(m.verifiableRatio)}) |`,
    `| 출처 링크 (답마다 평균) | ${n1(b.urlsAvg)}개 | ${n1(m.urlsAvg)}개 |`,
    `| 실제로 열리는 링크 | ${pct(b.liveRatio)}${b.urlsUnknown ? ` (모름 ${b.urlsUnknown})` : ""} | ${pct(m.liveRatio)}${m.urlsUnknown ? ` (모름 ${m.urlsUnknown})` : ""} |`,
    `| 가장 최근 기준일 (중앙값) | ${days(b)} | ${days(m)} |`,
    `| 권유 문장 (전체) | ${b.adviceTotal}건 | ${m.adviceTotal}건 |`,
    `| "확인 못 했다" 고 밝힌 것 (답마다 평균) | ${n1(b.admittedAvg)}개 | ${n1(m.admittedAvg)}개 |`,
    `| 응답 시간 (평균) | ${(b.msAvg / 1000).toFixed(1)}초 | ${(m.msAvg / 1000).toFixed(1)}초 |`,
    `| 토큰 (평균 입력/출력) | ${b.tokensAvg ? `${b.tokensAvg.input}/${b.tokensAvg.output}` : "-"} | ${m.tokensAvg ? `${m.tokensAvg.input}/${m.tokensAvg.output}` : "-"} |`,
    "",
    "## 질문별",
    "",
    "| 질문 | 숫자 (기준선 / Muffin, 확인 카드) | 링크 열림 (기준선 / Muffin) | 최근 기준일 (기준선 / Muffin) | 권유 | tool | 시간 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const live = (s: { urlChecks: UrlCheck[] }) => {
    const l = s.urlChecks.filter((c) => c.status === "live").length;
    const d = s.urlChecks.filter((c) => c.status === "dead").length;
    return `${l}/${l + d}`;
  };
  for (const r of rows) {
    if (!r.muffin) {
      lines.push(`| ${r.question} | (실패: ${r.error ?? "?"}) | | | | | |`);
      continue;
    }
    lines.push(
      `| ${r.question} | ${r.baseline.numbers} / ${r.muffin.numbers} (${r.muffin.verifiable}/${r.muffin.cards}) | ${live(r.baseline)} / ${live(r.muffin)} | ${r.baseline.latestDate ?? "없음"} / ${r.muffin.latestDate ?? "없음"} | ${r.baseline.advice} / ${r.muffin.advice} | ${r.muffin.toolsOk}✓${r.muffin.toolsFailed ? ` ${r.muffin.toolsFailed}✗` : ""}${r.muffin.fallbacks ? ` 저장${r.muffin.fallbacks}` : ""} | ${(r.baseline.ms / 1000).toFixed(0)}s / ${(r.muffin.ms / 1000).toFixed(0)}s |`,
    );
  }
  lines.push("", "## 기준선 답 전문 (발표 예시용)", "");
  for (const r of rows) {
    lines.push(`### ${r.question}`, "", `링크: ${r.baseline.urlChecks.map((c) => `${c.url} (${c.status}${c.code ? ` ${c.code}` : ""})`).join(" · ") || "없음"}`, "", r.baseline.text.trim().replace(/^/gm, "> "), "");
  }
  return lines.join("\n");
}
