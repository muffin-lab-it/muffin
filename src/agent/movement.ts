/**
 * 유의성 게이트 · 원인 지도 (2단계). 리더 관리.
 *
 * 원인 질문("환율이 왜 내렸어?")에서 이번 움직임이 평소 범위인지 코드로 잽니다. 평소 범위의 움직임에는 원인을 지어내지 않고,
 * 큰 움직임만 원인 후보마다 장부 근거를 보게 하려는 것입니다.
 *
 *  - 대상: 질문의 주제가 환율일 때(isFxQuestion)만, 조사가 받은 환율 결과(get_fx_krw_rate) 중 질문에 나온 통화의 것.
 *    질문에 통화가 없으면 장부의 환율 결과가 한 통화일 때만 그것을 잽니다.
 *    ETF 원인 질문에서 조사가 환율을 보조로 받아 와도 재지 않습니다. ETF · 금리 · 물가는 아직 재지 않습니다.
 *  - 계산: 같은 출처(Frankfurter)에서 이번 기간 직전 90일의 일별 환율을 받아 하루 변화율의 표준편차를 구합니다.
 *    평소 폭 = 표준편차 × √(이번 기간의 관측 수), z-score = 이번 변화 ÷ 평소 폭 (metrics.ts 의 movementZ).
 *  - 판정: |z| 가 1 미만이면 normal(평소 범위), 2 미만이면 notable(평소보다 큼), 그 이상이면 extreme(드물게 큼).
 *  - 쓰임 (muffin.ts): 장부에 C 번호로 올리고, 작성 입력 끝에 [움직임 크기] 를 붙이고, 리포트의 notice · movement 에 넣습니다.
 *    따로 받은 일별 환율 주소를 그 C 번호의 출처로 남겨, 원본 보기에서 계산에 쓴 데이터를 열어 볼 수 있습니다.
 *    notable · extreme 이면 원인 지도(causeMap)의 후보마다 장부 근거를 보게 합니다.
 *  - 실패(응답 오류 · 데이터 부족)하면 게이트만 건너뛰고 리포트는 그대로 나갑니다. 실행 기록에는 calc_movement 로 남습니다.
 *
 * 환율 tool(서영)은 바꾸지 않고 같은 출처를 한 번 더 부릅니다. 정제 단계와 동시에 돌아서 응답 시간이 늘지 않습니다.
 */
import { fetchJson } from "../lib/http";
import { movementZ, round } from "../tools/calc/metrics";
import type { ToolStep } from "./context";
import { labelFor } from "./events";
import { areaTools } from "./plan";
import type { Area, Evidence, Report } from "./schema";

/** 실행 기록 · 장부에 쓰는 이름. 화면 라벨은 events.ts 의 toolLabels. */
export const MOVEMENT_TOOL = "calc_movement";
/** 평소 폭을 정하는 기준 기간(이번 기간 직전, 달력 일수). 리포트 movement.window 와 같습니다. */
export const BASELINE_DAYS = 90;
/** 평소 폭의 이 배수부터 평소보다 큰 움직임(notable), EXTREME_Z 부터 드물게 큰 움직임(extreme)입니다. */
export const NOTABLE_Z = 1;
export const EXTREME_Z = 2;
/** 기준 기간의 하루 변화가 이보다 적으면 평소 폭을 믿기 어려워 재지 않습니다. */
export const MIN_DAILY_CHANGES = 30;
/** 일별 환율 응답을 기다리는 최대 시간. 정제와 동시에 돌므로 보통은 기다리지 않습니다. */
const TIMEOUT_MS = 4_000;
const SERIES_URL = "https://api.frankfurter.dev/v2/rates";

export type MovementLevel = NonNullable<Report["movement"]>["level"];

/** 게이트가 잰 결과. 퍼센트 값은 소수 둘째 자리입니다. */
export type Movement = {
  /** 잰 대상의 장부 id (환율 결과의 E 번호) */
  ref: string;
  /** "USD/KRW", "JPY(100)/KRW" */
  pair: string;
  /** 이번 기간: 비교 기준일 → 최신 기준일. days 는 달력 일수 */
  period: { from: string; to: string; days: number };
  /** 이번 변화율 (%) */
  movePct: number;
  /** 평소 폭 (%) */
  typicalPct: number;
  /** 이번 변화 ÷ 평소 폭. 부호는 변화 방향입니다 */
  zScore: number;
  level: MovementLevel;
  /** 평소 폭을 정한 기준 기간 · 하루 변화 수와 일별 환율을 받은 주소 */
  baseline: { from: string; to: string; changes: number; url: string };
};

/** 게이트 한 번의 결과. 잴 대상이 없으면 step 이 없고, 재다가 실패하면 movement 가 null 이고 step 이 error 입니다. */
export type MovementResult = { movement: Movement | null; step?: ToolStep };

/** 원인 지도의 후보 하나. */
export type CauseCandidate = {
  /** 원인 후보. 작성 입력에 그대로 보입니다 */
  factor: string;
  /** 이 후보의 근거가 되는 장부 항목의 tool */
  tool: string;
  /** true 면 잰 대상과 다른 통화쌍이면서 같은 기간인 환율 결과만 근거로 봅니다 (잰 대상 자신은 근거가 아님) */
  otherPair?: true;
  /** 장부에 근거가 없을 때 무엇이 있으면 확인할 수 있는지 */
  needs: string;
};

/**
 * 원인 지도: 영역별로 큰 움직임의 원인을 확인할 후보와 그 근거가 되는 데이터입니다. 지금은 환율만 있습니다.
 * 근거는 이번 기간에 맞는 것만 씁니다 (fitsPeriod: 기간 안의 기사, 같은 기간의 다른 통화쌍, 기간 시작 이후의 금리).
 * 평소보다 큰 움직임이면 작성이 후보마다 장부 근거를 보고, 뒷받침하면 why · 맞지 않으면 caveats · 근거가 없으면 dataGaps 에 적습니다.
 */
export const causeMap: Partial<Record<Area, CauseCandidate[]>> = {
  fx: [
    { factor: "한미 금리 차이 (정책금리 · 국채 금리)", tool: areaTools.rate, needs: "한국 기준금리와 미국 정책금리" },
    { factor: "국내외 경제 뉴스 (정책 · 지표 발표, 시장 이벤트)", tool: areaTools.news, needs: "같은 기간의 경제 뉴스" },
    {
      factor: "다른 통화 대비 흐름 (달러 전반의 강세 · 약세인지, 원화만의 움직임인지)",
      tool: areaTools.fx,
      otherPair: true,
      needs: "같은 기간 다른 통화(EUR · JPY)의 원화 환율",
    },
  ],
};

type Target = { ref: string; pair: string; currency: string; from: string; to: string; fromRate: number; toRate: number };
type DailyRate = { date: string; rate: number };

const DAY_MS = 86_400_000;
const isDate = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** 환율이 주제인 질문의 낱말. "원달러" · "원/달러" 도 "달러" 로 걸립니다. */
const FX_WORDS = /환율|달러|엔화|엔저|엔고|유로|위안|원화|USD|JPY|EUR|KRW/i;
/** 환율 낱말이 있어도 주제가 다른 질문 (ETF 의 지수 추적 차이, 금리 · 물가가 주제인 질문). */
const OTHER_SUBJECT = /ETF|KODEX|TIGER|KBSTAR|ARIRANG|HANARO|지수|금리|국채|물가|CPI|실업|주가|코스피|코스닥|나스닥|S&P/;

/**
 * 질문의 주제가 환율인지. 관심 영역이 환율이면 그렇고, ETF · 금리 · 물가면 아닙니다 (조사가 환율을 보조로 받아도 재지 않음).
 * 영역이 없거나 경제뉴스면 질문 글로 봅니다: 환율 낱말이 있고 다른 주제 낱말이 없을 때만 (모호하면 재지 않는 쪽이 안전).
 */
export function isFxQuestion(question: string, area?: Area): boolean {
  if (area === "fx") return true;
  if (area && area !== "news") return false;
  return FX_WORDS.test(question) && !OTHER_SUBJECT.test(question);
}

const CURRENCY_WORDS: [string, RegExp][] = [
  ["USD", /달러|USD/i],
  // "엔" 한 글자는 낱말일 때만 ("엔 환율" · "엔이" · "원/엔"). "엔진" · "아이엔" 은 아님
  ["JPY", /엔화|엔저|엔고|일본\s*엔|\d\s*엔|원\s*[/·]?\s*엔|(?:^|[^가-힣])엔(?=$|[\s/·,.?!]|이|가|은|는|도|환율)|JPY/i],
  ["EUR", /유로|EUR/i],
  // 환율 tool 에 없는 통화. 물으면 다른 통화를 대신 재지 않게 따로 알아봅니다 ("호주 달러" 는 달러보다 먼저 걸림)
  ["CNY", /위안|CNY/i],
  ["GBP", /파운드|GBP/i],
  ["OTHER", /(?:호주|캐나다|홍콩|대만|싱가포르|뉴질랜드)\s*달러|AUD|CAD|HKD|TWD|SGD|NZD/i],
];

/** 질문이 가리키는 통화. 여럿이면 질문에서 먼저 나온 것("엔화가 달러보다 …" 는 JPY), 없으면 undefined. */
export function currencyOf(question: string): string | undefined {
  return CURRENCY_WORDS.map(([currency, re]) => ({ currency, at: question.search(re) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.currency;
}

/** 장부의 환율 결과 중 잴 수 있는 것. 필요한 값이 모자라면(환율 tool 의 모양이 바뀌면) 그 항목은 건너뜁니다. */
function targets(evidence: Evidence[]): Target[] {
  const out: Target[] = [];
  for (const e of evidence) {
    if (e.tool !== areaTools.fx) continue;
    const v = e.values;
    const pair = typeof v.pair === "string" ? v.pair : "";
    const currency = /^(USD|EUR|JPY)\b/.exec(pair)?.[1];
    const [from, to] = [v["comparison.asOf"], v.asOf];
    const [fromRate, toRate] = [Number(v["comparison.rate"]), Number(v.rate)];
    if (!currency || !isDate(from) || !isDate(to) || from >= to || !(fromRate > 0) || !(toRate > 0)) continue;
    out.push({ ref: e.id, pair, currency, from, to, fromRate, toRate });
  }
  return out;
}

/** 환율 tool 과 같은 출처 · 주소 규칙의 일별 환율 주소입니다. */
export function seriesUrl(currency: string, from: string, to: string): string {
  const url = new URL(SERIES_URL);
  url.searchParams.set("base", currency.toLowerCase());
  url.searchParams.set("quotes", "krw");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  return url.toString();
}

/** 일별 환율. 응답 모양이 다르면 throw 합니다. */
async function fetchDaily(url: string, currency: string): Promise<DailyRate[]> {
  const rows = await fetchJson<unknown>(url, { timeoutMs: TIMEOUT_MS });
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("일별 환율이 없습니다");
  const seen = new Set<string>();
  const out: DailyRate[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const ok = row && row.base === currency && row.quote === "KRW" && isDate(row.date) && typeof row.rate === "number" && Number.isFinite(row.rate) && row.rate > 0;
    if (!ok || seen.has(row.date as string)) throw new Error("Frankfurter 응답 형식이 예상과 다릅니다");
    seen.add(row.date as string);
    out.push({ date: row.date as string, rate: row.rate as number });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function levelOf(zScore: number): MovementLevel {
  const size = Math.abs(zScore);
  return size < NOTABLE_Z ? "normal" : size < EXTREME_Z ? "notable" : "extreme";
}

/**
 * z-score 를 소수 둘째 자리로 보이고, 보이는 값으로 판정합니다. 0.996 은 "1.00배" 로 보이므로 평소보다 큰 움직임입니다
 * ("1.00배인데 평소 범위" 처럼 안내 문구와 판정이 어긋나지 않게).
 */
export function judge(z: number): { zScore: number; level: MovementLevel } {
  const zScore = round(z, 2);
  return { zScore, level: levelOf(zScore) };
}

/** 일별 환율로 이번 변화가 평소 폭의 몇 배인지 잽니다. 기준 기간의 하루 변화가 모자라면 throw 합니다. */
function measure(target: Target, rows: DailyRate[], url: string): Movement {
  // 기준 기간은 이번 기간 시작일(비교 기준일)까지의 직전 90일입니다. 이번 기간의 변화는 넣지 않습니다.
  const baselineStart = shiftDate(target.from, -BASELINE_DAYS);
  const baseline = rows.filter((r) => r.date > baselineStart && r.date <= target.from);
  const daily = baseline.slice(1).map((r, i) => (r.rate / baseline[i]!.rate - 1) * 100);
  if (daily.length < MIN_DAILY_CHANGES) {
    throw new Error(`직전 ${BASELINE_DAYS}일의 하루 변화가 ${daily.length}개뿐이라 평소 폭을 정하지 않았습니다 (최소 ${MIN_DAILY_CHANGES}개)`);
  }
  // 이번 기간의 관측 수: 비교 기준일 다음부터 최신 기준일까지 받은 일별 환율 수 (빠진 날이 있으면 그만큼 적음)
  const steps = rows.filter((r) => r.date > target.from && r.date <= target.to).length;
  if (steps === 0) throw new Error(`${target.from} 이후의 일별 환율이 없습니다`);
  // 이번 변화는 장부의 두 값으로 구해 리포트의 숫자와 같게 합니다.
  const move = (target.toRate / target.fromRate - 1) * 100;
  const { z, typical } = movementZ(move, daily, steps);
  return {
    ref: target.ref,
    pair: target.pair,
    period: { from: target.from, to: target.to, days: dayNumber(target.to) - dayNumber(target.from) },
    movePct: round(move, 2),
    typicalPct: round(typical, 2),
    ...judge(z),
    baseline: { from: baseline[0]!.date, to: baseline.at(-1)!.date, changes: daily.length, url },
  };
}

/**
 * 원인 질문에서 muffin.ts 가 정제와 동시에 부릅니다. 주제가 환율이 아니거나 장부에 잴 환율 결과가 없으면 아무것도 부르지 않고,
 * 재다가 실패해도 throw 하지 않고 error step 을 돌려줍니다 (게이트 없이 리포트를 이어 가도록).
 */
export async function measureMovement(evidence: Evidence[], { question, area }: { question: string; area?: Area }): Promise<MovementResult> {
  if (!isFxQuestion(question, area)) return { movement: null };
  const found = targets(evidence);
  const currency = currencyOf(question);
  // 질문이 통화를 말했는데 그 통화의 결과가 없으면(유로를 물었는데 달러만 있음, 위안처럼 tool 에 없는 통화) 다른 통화를 대신 재지 않습니다.
  // 통화를 말하지 않았으면 장부의 환율 결과가 한 통화일 때만 잽니다 (여러 통화면 어느 것을 물었는지 모름).
  const target = currency ? found.find((t) => t.currency === currency) : new Set(found.map((t) => t.currency)).size === 1 ? found[0] : undefined;
  if (!target) return { movement: null };
  const started = Date.now();
  const step = (status: ToolStep["status"], error?: string): ToolStep => ({ tool: MOVEMENT_TOOL, status, ms: Date.now() - started, ...(error ? { error } : {}) });
  try {
    const url = seriesUrl(target.currency, shiftDate(target.from, -BASELINE_DAYS), target.to);
    return { movement: measure(target, await fetchDaily(url, target.currency), url), step: step("ok") };
  } catch (err) {
    return { movement: null, step: step("error", err instanceof Error ? err.message : String(err)) };
  }
}

const signedPct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
const times = (zScore: number) => Math.abs(zScore).toFixed(2);
const nameOf = (m: Movement) => `${m.pair} ${m.period.days}일 변화의 크기 (직전 ${BASELINE_DAYS}일 기준)`;

const LEVEL_TEXT: Record<MovementLevel, string> = {
  normal: "평소 범위 안의 움직임",
  notable: "평소보다 큰 움직임",
  extreme: "평소보다 훨씬 큰, 드문 움직임",
};

/**
 * 장부에 올리는 C 번호 항목. 값의 키 이름은 검증기의 단위 규칙을 따릅니다: …Pct 는 %, zScore · timesTypical 은 단위 없는 수,
 * periodDays · baselineCount 는 기간 · 개수라 대조하지 않습니다. 그래서 작성이 "±1.69%" · "0.63배" 를 쓰면 이 항목과 맞습니다.
 */
export function movementEvidence(m: Movement, id: string): Evidence {
  return {
    id,
    tool: MOVEMENT_TOOL,
    label: `${labelFor(MOVEMENT_TOOL)} · ${nameOf(m)}`,
    values: {
      movePct: m.movePct,
      typicalMovePct: m.typicalPct,
      zScore: m.zScore,
      timesTypical: Math.abs(m.zScore),
      level: m.level,
      periodDays: m.period.days,
      baselineStart: m.baseline.from,
      baselineEnd: m.baseline.to,
      baselineCount: m.baseline.changes,
    },
    // 기준 기간 데이터는 조사의 환율 결과(E 번호)에 없어서 따로 받은 주소를 출처로 남깁니다 (원본 보기 · 출처 목록에서 열림).
    source: { name: `Frankfurter v2 일별 환율 (${m.baseline.from} ~ ${m.period.to})`, url: m.baseline.url, asOf: m.period.to },
    note:
      `직전 ${BASELINE_DAYS}일(${m.baseline.from}~${m.baseline.to}) 하루 변화 ${m.baseline.changes}개의 표준편차 × √(이번 기간 관측 수) = 평소 폭 ±${m.typicalPct.toFixed(2)}%. ` +
      `이번 변화 ${signedPct(m.movePct)} 는 평소 폭의 ${times(m.zScore)}배입니다`,
    lineage: { op: "zscore", inputs: [m.ref] },
  };
}

/** 리포트의 movement 칸. */
export function movementSummary(m: Movement): NonNullable<Report["movement"]> {
  return { ref: m.ref, zScore: m.zScore, window: BASELINE_DAYS, level: m.level };
}

/** 리포트 상단 안내(notice). 코드가 계산한 값만 씁니다. */
export function movementNotice(m: Movement): string {
  const line = `${m.pair} ${m.period.days}일 변화(${signedPct(m.movePct)})는 직전 ${BASELINE_DAYS}일 기준 평소 폭(±${m.typicalPct.toFixed(2)}%)의 ${times(m.zScore)}배로, ${LEVEL_TEXT[m.level]}입니다.`;
  return m.level === "normal" ? `${line} 이 정도 움직임은 뚜렷한 원인 없이도 생길 수 있습니다.` : line;
}

/** 실제 방향. X/KRW 는 오르면 원화 약세, 내리면 원화 강세입니다. */
function directionText(m: Movement): string {
  const currency = m.pair.split("/")[0]!.replace(/\(\d+\)/, "");
  if (m.movePct > 0) return `${signedPct(m.movePct)} 올랐습니다. 같은 ${currency} 를 사는 데 드는 원화가 늘어난 원화 약세입니다`;
  if (m.movePct < 0) return `${signedPct(m.movePct)} 내렸습니다. 같은 ${currency} 를 사는 데 드는 원화가 줄어든 원화 강세입니다`;
  return "거의 변하지 않았습니다";
}

/**
 * 원인 후보의 근거가 이번 기간과 맞는지. 기간 밖의 근거로 이번 움직임을 설명하지 않게 합니다.
 *  - 다른 통화쌍: 같은 기간(비교 기준일 · 최신 기준일)일 때만 이번 움직임과 견줄 수 있습니다.
 *  - 뉴스: 기간 안에 나온 기사만. 끝은 시차를 생각해 하루 여유를 둡니다 (기사 시각은 UTC, 환율 기준일은 유럽 기준).
 *  - 그 밖(금리): 기준일이 기간 시작 이후인 최신 값만. 날짜가 없으면 막지 않습니다.
 */
function fitsPeriod(e: Evidence, c: CauseCandidate, m: Movement, target?: Evidence): boolean {
  if (c.otherPair) {
    return e.values.pair !== target?.values.pair && e.values.asOf === target?.values.asOf && e.values["comparison.asOf"] === target?.values["comparison.asOf"];
  }
  if (c.tool === areaTools.news) {
    const day = String(e.values.publishedAt ?? "").slice(0, 10);
    return isDate(day) && day >= m.period.from && day <= shiftDate(m.period.to, 1);
  }
  const day = String(e.values.asOf ?? e.source.asOf).slice(0, 10);
  return !isDate(day) || day >= m.period.from;
}

/**
 * 비교 기간이 이번 기간과 다른 근거(금리 tool 은 30 · 90 · 365일만)에 붙이는 안내. 그 변화폭은 이번 움직임과 기간이 달라
 * 원인으로 쓰지 않고, 지금 수준(예: 한미 금리 차이)만 근거로 쓰게 합니다. 비교 시작일이 사흘 넘게 다르면 다른 기간으로 봅니다.
 */
function windowNote(refs: Evidence[], m: Movement): string {
  const other = refs.filter((e) => {
    const start = Object.entries(e.values).find(([k]) => /comparisonDate$/i.test(k))?.[1];
    return isDate(start) && Math.abs(dayNumber(start) - dayNumber(m.period.from)) > 3;
  });
  return other.length ? ` (${other.map((e) => e.id).join(" · ")} 는 비교 기간이 이번 기간과 달라 변화폭이 아니라 지금 수준만 근거로 씁니다)` : "";
}

/** 작성 입력의 [증거 장부] 와 같은 모양의 한 항목. */
function ledgerLine(e: Evidence): string {
  const lines = [`- ${e.id} · ${e.label} · 기준일 ${e.source.asOf}`, `  values: ${JSON.stringify(e.values)}`];
  if (e.note) lines.push(`  note: ${e.note}`);
  return lines.join("\n");
}

/**
 * 작성 입력 끝에 붙는 [움직임 크기] (muffin.ts). 실제 방향과 크기를 먼저 알리고, 평소 범위면 원인을 단정하지 않게,
 * 크면 원인 지도의 후보마다 장부 근거를 보게 합니다.
 * shown 은 작성이 [증거 장부] 에서 이미 보는 id 입니다 (null 이면 장부 전체). 게이트의 C 번호 항목과 후보의 근거 중
 * 거기 없는 항목은 값을 붙여 보여 줍니다 (작성은 [증거 장부] 의 값만 숫자로 쓰므로).
 * dropped 는 정제가 질문과 무관하다고 뺀 id 이고, 원인 후보의 근거로 다시 넣지 않습니다.
 */
export function movementNote(m: Movement, calcId: string, evidence: Evidence[], shown: Set<string> | null, dropped: Set<string> = new Set()): string {
  const size = LEVEL_TEXT[m.level];
  const lines = [
    `[움직임 크기] 코드가 계산한 값입니다 (${calcId}). 원인을 쓰기 전에 먼저 봅니다.`,
    `- ${m.pair} 는 ${m.period.from} → ${m.period.to} (${m.period.days}일) 동안 ${directionText(m)} (${m.ref}).`,
    `- 직전 ${BASELINE_DAYS}일의 하루 변화로 보면 이 기간에는 보통 ±${m.typicalPct.toFixed(2)}% 안팎 움직입니다. 이번 변화는 그 ${times(m.zScore)}배라 ${size}입니다.`,
    `- summary 의 첫 문장에서 실제 방향과 크기("${size}")를 먼저 말합니다. 머핀이 직접 계산한 사실이라 "분석에 따르면" 같은 말을 붙이지 않습니다. 질문이 반대 방향을 전제했으면 실제 방향으로 바로잡습니다.`,
  ];
  let candidateRefs: Evidence[] = [];
  if (m.level === "normal") {
    lines.push(
      "- 이 정도 움직임은 뚜렷한 원인 없이도 생깁니다. why 에는 장부 근거가 있는 요인만 쓰고, 그 요인이 이번 변화를 일으켰다고 단정하지 않습니다. 근거가 없으면 why 를 비웁니다.",
    );
  } else {
    const target = evidence.find((e) => e.id === m.ref);
    const candidates = (causeMap.fx ?? []).map((c) => ({
      ...c,
      refs: evidence.filter((e) => e.tool === c.tool && e.id !== m.ref && !dropped.has(e.id) && fitsPeriod(e, c, m, target)),
    }));
    candidateRefs = candidates.flatMap((c) => c.refs);
    lines.push(
      "- 아래 [원인 후보] 를 하나씩 봅니다.",
      "",
      "[원인 후보] 환율이 크게 움직일 때 확인하는 것입니다 (원인 지도).",
      "- 장부 근거가 이번 움직임을 뒷받침하면 why 에 쓰고 refs 에 그 id 를 적습니다.",
      "- 근거가 이번 움직임과 맞지 않으면(예: 금리 차이가 그대로) caveats 에 그 근거와 함께 \"이 요인으로는 설명되지 않음\" 을 적습니다.",
      "- 장부에 근거가 없는 후보는 why 에 쓰지 않고 dataGaps 에 무엇이 있어야 확인할 수 있는지 적습니다.",
      ...candidates.map((c) => `- ${c.factor}: ${c.refs.length ? c.refs.map((e) => e.id).join(" · ") + windowNote(c.refs, m) : `장부에 없음 (필요한 것: ${c.needs})`}`),
    );
  }
  const own = evidence.filter((e) => e.id === calcId);
  const unseen = shown ? [...own, ...candidateRefs].filter((e) => !shown.has(e.id)) : [];
  if (unseen.length) {
    lines.push("", "[덧붙인 장부 항목] 정제가 사실 목록에 넣지 않은 항목입니다. 움직임 크기와 원인 후보의 숫자는 이 값을 씁니다.", ...unseen.map(ledgerLine));
  }
  return lines.join("\n");
}
