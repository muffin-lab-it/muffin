/**
 * "etf 요즘 뭐가 좋아?" 처럼 종목을 정하지 않은 ETF 질문 (리더, 11/21).
 *
 * 11/20 베타: 조사가 KODEX 200 하나만 보고 "다른 ETF 와 비교 자료는 없습니다" 라고 답해 "비교 자료 없다는 말이 왜 나오지?" 라는 말을 들었습니다.
 * 좋은 ETF 를 골라 주는 것은 투자 권유라 하지 않지만, 자산군별 대표 ETF 의 최근 수익률을 나란히 보여 줄 수는 있습니다.
 * 종목 없는 ETF 질문이면 코드가 아래 고정 목록을 조회해 장부에 올리고, 작성에 [대표 ETF 비교] 로 알립니다. 목록은 수익률과 무관하게 자산군별로 미리 정해 둔 것입니다.
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import type { Chart, Evidence, WriterOutput } from "./schema";
import type { InvokableTool } from "./supplement";

/** 자산군별 대표 ETF (고정). 수익률로 고른 것이 아니라 자산군마다 하나씩 정해 둔 것입니다 */
export const ETF_BASKET = [
  { code: "069500", name: "KODEX 200", group: "국내 대형주" },
  { code: "229200", name: "KODEX 코스닥150", group: "국내 코스닥" },
  { code: "360750", name: "TIGER 미국S&P500", group: "미국 대형주" },
  { code: "133690", name: "TIGER 미국나스닥100", group: "미국 기술주" },
  { code: "365780", name: "ACE 국고채10년", group: "국내 국채" },
  { code: "411060", name: "ACE KRX금현물", group: "금" },
] as const;

const ETF_WORD = /ETF|이티에프|상장지수펀드/i;
/** 종목 · 테마를 이미 말한 질문의 낱말. 있으면 조사가 그 대상을 찾으므로 보태지 않습니다 */
const SPECIFIC =
  /KODEX|코덱스|TIGER|타이거|RISE|라이즈|KBSTAR|ACE|에이스|PLUS|SOL|KIWOOM|키움|HANARO|하나로|1Q|KOACT|\d{6}|나스닥|S&P|에스앤피|코스피|코스닥|다우|반도체|배당|채권|국채|금\s|금현물|2차전지|바이오|리츠|레버리지|인버스|\b(QQQ|SPY|VOO|SCHD)\b/i;
/** 개념을 묻는 질문 ("etf가 뭐야?"). 수익률 비교로 답할 질문이 아닙니다 */
// "무엇을 사지" 는 고르는 질문이라 개념 질문이 아닙니다 (11/22 QA: "앞으로 etf는 뭘 사면 좋을까? … 보통 무엇을 사지?" 에 대표 ETF 가 빠짐)
const CONCEPT = /뭐야|뭔가요|무엇인가|무엇이야|무엇인지|무슨\s*뜻|뜻이|차이가|어떻게\s*(거래|계산)/;

/** 기간을 정한 질문 ("최근 1년 ETF 어때?"). 대표 목록은 30일로만 비교하므로, 기간을 정한 질문은 조사에 맡깁니다 (#128 Codex 리뷰) */
const PERIOD = /\d+\s*(년|개월|달|주|일)|올해|작년|지난해|연초|분기|반기/;
export const BASKET_DAYS = 30;

/** 종목 · 기간을 정하지 않고 ETF 를 묻는 질문인지 ("etf 요즘 뭐가 좋아?", "요즘 ETF 어때?") */
export function isGeneralEtfQuestion(question: string): boolean {
  return ETF_WORD.test(question) && !SPECIFIC.test(question) && !CONCEPT.test(question) && !PERIOD.test(question);
}

const spanDays = (e: Evidence) => (Date.parse(String(e.values["period.to"])) - Date.parse(String(e.values["period.from"]))) / 86_400_000;
/** 비교 기간이 30일 안팎인 ETF 결과만 씁니다. 조사가 다른 기간으로 받은 결과를 섞으면 서로 다른 기간의 수익률을 나란히 놓게 됩니다 */
const isEtf = (e: Evidence) => e.tool === areaTools.etf && typeof e.values["period.returnPct"] === "number" && Math.abs(spanDays(e) - BASKET_DAYS) <= 5;

/** 장부에서 고정 목록에 든 ETF 결과를 목록 순서대로 */
export function basketRows(evidence: Evidence[]): { item: (typeof ETF_BASKET)[number]; e: Evidence }[] {
  const rows = ETF_BASKET.flatMap((item) => {
    const e = evidence.find((x) => isEtf(x) && x.values.name === item.name);
    return e ? [{ item, e }] : [];
  });
  // 가장 많은 항목이 쓰는 비교 기간으로 맞춥니다 (휴장일 차이로 시작일이 다른 항목은 나란히 놓지 않음)
  const span = (e: Evidence) => `${e.values["period.from"]}~${e.values["period.to"]}`;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(span(r.e), (counts.get(span(r.e)) ?? 0) + 1);
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return rows.filter((r) => span(r.e) === main);
}

/** 종목 없는 ETF 질문이면 고정 목록 중 장부에 없는 것을 조회합니다. 대상이 아니면 부르지 않고, 일부가 실패해도 이어 갑니다 (error step 만 남음) */
export async function ensureEtfBasket(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<boolean> {
  const etf = tools.find((t) => t.name === areaTools.etf);
  if (!etf || !isGeneralEtfQuestion(question)) return false;
  const have = new Set(basketRows(ctx.evidence).map((r) => r.item.code));
  const rc = new RunContext(ctx);
  await Promise.all(ETF_BASKET.filter((b) => !have.has(b.code)).map((b) => etf.invoke(rc, JSON.stringify({ query: b.code, days: BASKET_DAYS })).catch(() => undefined)));
  return true;
}

const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

/** 작성 입력에 붙이는 [대표 ETF 비교]. 둘 이상 받았을 때만 */
export function basketNote(evidence: Evidence[]): string {
  const rows = basketRows(evidence);
  if (rows.length < 2) return "";
  const first = rows[0]!.e.values;
  const sorted = [...rows].sort((a, b) => (b.e.values["period.returnPct"] as number) - (a.e.values["period.returnPct"] as number));
  return [
    `[대표 ETF 비교] 질문이 종목을 정하지 않아, 자산군별 대표 ETF ${rows.length}개의 가격 수익률을 조회했습니다 (${first["period.from"]} → ${first["period.to"]}). 수익률과 무관하게 자산군마다 하나씩 미리 정해 둔 목록입니다.`,
    ...rows.map(({ item, e }) => `- ${item.name} (${item.group}, ref ${e.id}): ${pct(e.values["period.returnPct"] as number)}`),
    `이 기간 가장 높은 것은 ${sorted[0]!.item.name}(${pct(sorted[0]!.e.values["period.returnPct"] as number)}), 가장 낮은 것은 ${sorted.at(-1)!.item.name}(${pct(sorted.at(-1)!.e.values["period.returnPct"] as number)})입니다.`,
    `요약의 첫 문장은 이 비교로 씁니다: 어느 자산군이 올랐고 어느 자산군이 내렸는지. "다른 ETF 와 비교 자료가 없다" 고 쓰지 않습니다.`,
    `어느 ETF 가 좋다 · 낫다 · 유망하다고 쓰지 않고, 사라 · 팔라는 표현도 쓰지 않습니다. 지난 수익률이 앞으로의 수익률을 뜻하지 않는다는 점과, 이 목록이 머핀이 정해 둔 대표 목록이라는 점을 주의점에 한 번 씁니다.`,
    `숫자 카드는 코드가 넣으므로 이 ETF 들의 카드는 쓰지 않아도 됩니다.`,
  ].join("\n");
}

/** 대표 ETF 의 수익률 카드를 목록 순서대로 맨 앞에 넣고, 작성이 같은 항목으로 쓴 카드는 뺍니다 (종가 · 괴리율 카드가 섞이지 않게). 둘 미만이면 그대로 */
export function withBasketNumbers(output: WriterOutput, evidence: Evidence[]): WriterOutput {
  const rows = basketRows(evidence);
  if (rows.length < 2) return output;
  const ids = new Set(rows.map((r) => r.e.id));
  const cards: WriterOutput["numbers"] = rows.map(({ item, e }) => ({
    label: `${item.name} (${item.group})`,
    value: pct(e.values["period.returnPct"] as number),
    change: `${e.values["period.from"]}~${e.values["period.to"]}`,
    asOf: String(e.values["period.to"]),
    ref: e.id,
  }));
  return { ...output, numbers: [...cards, ...output.numbers.filter((n) => !(n.ref && ids.has(n.ref)))] };
}

/**
 * 대표 ETF 수익률 막대 차트 (11/23 리더 결정: 물가 추이 · ETF 비교 차트 중 ETF 막대만 먼저). 막대 하나가 series 하나이고,
 * 점은 하나(t: 기간 끝 날짜, v: 기간 수익률 %)입니다. ref 가 ETF 마다 달라 막대마다 근거를 가리킬 수 있습니다. 순서는 목록 순서(수익률 순 아님).
 * 화면(ReportChart, #149)은 series 가 둘 이상인 막대 차트에서 series 마다 마지막 점을 막대 하나로 그리고, unit "%" 면 오름 · 내림 색을 씁니다.
 */
export function basketChart(evidence: Evidence[]): Chart | null {
  const rows = basketRows(evidence);
  if (rows.length < 2) return null;
  const first = rows[0]!.e.values;
  return {
    kind: "bar",
    title: `대표 ETF 최근 ${BASKET_DAYS}일 가격 수익률 (${first["period.from"]}~${first["period.to"]})`,
    unit: "%",
    series: rows.map(({ item, e }) => ({ label: `${item.name} (${item.group})`, ref: e.id, points: [{ t: String(e.values["period.to"]), v: e.values["period.returnPct"] as number }] })),
  };
}

