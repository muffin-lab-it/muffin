/**
 * 물가와 금리의 관계를 묻는 질문 (리더, 11/21).
 *
 * 11/20 베타: "물가와 금리, cpi 상관관계 알려줘" 에 "실제 상관관계는 확인할 수 없으며, 기준금리는 3.00% 입니다" 가 나와 "이게 무슨 소리?" 라는 말을 들었습니다.
 * 상관계수를 계산할 자료는 없지만, 두 지표가 지난 1년 동안 어느 쪽으로 움직였는지는 나란히 보여 줄 수 있습니다. 관계를 묻는 질문이면 코드가
 * 1년 전 물가 상승률과 1년 전 기준금리를 장부에 채우고, 작성에 [두 지표 나란히] 로 알려 "확인할 수 없다" 대신 비교로 답하게 합니다.
 */
import { RunContext } from "@openai/agents";
import type { ResearchContext } from "./context";
import { areaTools } from "./plan";
import type { Evidence, WriterOutput } from "./schema";
import type { InvokableTool } from "./supplement";

/** 다른 나라를 말한 질문. 이 보강은 한국 물가 · 한국은행 기준금리만 비교하므로, 다른 나라나 나라 사이 비교는 조사 결과를 그대로 둡니다 (#128 Codex 리뷰) */
const OTHER_COUNTRY = /미국|연준|\bFed\b|일본|중국|영국|유럽|유로존|독일|캐나다|호주|스위스|브라질|해외|글로벌|세계|각국|주요국/i;

/** 한국 물가와 금리의 관계를 묻는 질문인지 */
export function isRateInflationQuestion(question: string): boolean {
  // 과거 연도 · 기간을 정한 질문은 대상이 아닙니다. 이 보강은 "최근 1년" 만 비교하므로, 2020년 물가에 지금 금리를 나란히 놓게 됩니다 (#128 Codex 리뷰)
  if (/(19|20)\d{2}\s*년|\d+\s*년\s*(전|간|동안)|작년|지난해|재작년/.test(question)) return false;
  return /상관|관계|연관|영향|같이\s*움직|따라\s*움직/.test(question) && /물가|인플레|\bcpi\b|소비자물가/i.test(question) && /금리/.test(question) && !OTHER_COUNTRY.test(question);
}

const yoy = (e: Evidence) => e.values["latest.previousYear.change"];
const isKrCpi = (e: Evidence) => e.tool === areaTools.macro && e.values.indicator === "cpi" && e.values.country === "KR" && typeof yoy(e) === "number" && /^\d{6}$/.test(String(e.values["latest.month"] ?? ""));
const isBokYear = (e: Evidence) => e.tool === areaTools.rate && e.values.indicator === "한국은행 기준금리" && Number(e.values.requestedDays) === 365;

/** 가장 최근 관측 월의 한국 CPI 와, 그 12개월 전 관측 월의 한국 CPI */
export function cpiPair(evidence: Evidence[]): { now?: Evidence; before?: Evidence } {
  const rows = evidence.filter(isKrCpi).sort((a, b) => String(a.values["latest.month"]).localeCompare(String(b.values["latest.month"])));
  const now = rows.at(-1);
  if (!now) return {};
  const target = String(Number(now.values["latest.month"]) - 100);
  return { now, before: rows.find((e) => String(e.values["latest.month"]) === target) };
}

/**
 * 관계 질문이면 모자란 자료를 채웁니다: 최신 한국 CPI, 12개월 전 CPI, 한국은행 기준금리 365일. 대상 질문이 아니면 아무것도 부르지 않고,
 * 실패해도 리포트는 이어집니다 (error step 만 남음). 분류가 고르지 않은 tool 도 부르므로 tools 는 레지스트리 전체를 받습니다.
 */
export async function ensureRateInflation(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<boolean> {
  if (!isRateInflationQuestion(question)) return false;
  const macro = tools.find((t) => t.name === areaTools.macro);
  const rate = tools.find((t) => t.name === areaTools.rate);
  if (!macro || !rate) return false;
  const rc = new RunContext(ctx);
  const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
  if (!cpiPair(ctx.evidence).now) await quiet(macro.invoke(rc, JSON.stringify({ country: "KR", indicator: "cpi", endMonth: null, months: 1 })));
  const { now, before } = cpiPair(ctx.evidence);
  await Promise.all([
    now && !before ? quiet(macro.invoke(rc, JSON.stringify({ country: "KR", indicator: "cpi", endMonth: String(Number(now.values["latest.month"]) - 100), months: 1 }))) : undefined,
    ctx.evidence.some(isBokYear) ? undefined : quiet(rate.invoke(rc, JSON.stringify({ series: "BOK", days: 365 }))),
  ]);
  return true;
}

/** [두 지표 나란히] 에 쓰는 항목들. 셋이 다 있어야 비교가 됩니다 */
export function relationRows(evidence: Evidence[]): { now: Evidence; before: Evidence; bok: Evidence } | null {
  const { now, before } = cpiPair(evidence);
  const bok = evidence.find(isBokYear);
  if (!now || !before || !bok) return null;
  // 두 지표의 시점이 맞을 때만 나란히 놓습니다: 최신 물가 관측 월이 금리 기준일에서 넉 달 안이어야 합니다 (물가는 한두 달 늦게 발표됨)
  const cpiMonth = Number(String(now.values["latest.month"]).slice(0, 4)) * 12 + Number(String(now.values["latest.month"]).slice(4, 6));
  const rateMonth = Number(String(bok.values.asOf).slice(0, 4)) * 12 + Number(String(bok.values.asOf).slice(5, 7));
  return Math.abs(rateMonth - cpiMonth) <= 4 ? { now, before, bok } : null;
}

const month = (m: unknown) => `${String(m).slice(0, 4)}-${String(m).slice(4, 6)}`;
const way = (d: number) => (Math.abs(d) < 0.005 ? "그대로" : d > 0 ? "높아짐" : "낮아짐");

/** 작성 입력에 붙이는 [두 지표 나란히]. 값을 직접 적어 정제가 뺐더라도 작성이 볼 수 있게 합니다 (검증은 장부 전체로 대조) */
export function relationNote(evidence: Evidence[]): string {
  const rows = relationRows(evidence);
  if (!rows) return "";
  const { now, before, bok } = rows;
  const cpiNow = yoy(now) as number;
  const cpiBefore = yoy(before) as number;
  const rateNow = Number(bok.values.rate);
  const rateBefore = Number(bok.values.comparisonRate);
  const cpiWay = way(cpiNow - cpiBefore);
  const rateWay = way(rateNow - rateBefore);
  const same = cpiWay === rateWay ? "두 지표가 같은 방향으로 움직였습니다" : cpiWay === "그대로" || rateWay === "그대로" ? "한 지표만 움직였습니다" : "두 지표가 반대 방향으로 움직였습니다";
  return [
    `[두 지표 나란히] 질문은 물가와 금리의 관계를 물었습니다. 상관계수는 계산하지 않았지만, 지난 1년 두 지표의 움직임을 나란히 볼 수 있습니다.`,
    `- 소비자물가 상승률(전년 같은 달 대비): ${month(before.values["latest.month"])} ${cpiBefore.toFixed(2)}% (ref ${before.id}) → ${month(now.values["latest.month"])} ${cpiNow.toFixed(2)}% (ref ${now.id}). 1년 사이 ${cpiWay}`,
    `- 한국은행 기준금리: ${bok.values.comparisonDate} ${rateBefore}% → ${bok.values.asOf} ${rateNow}% (ref ${bok.id}). 1년 사이 ${rateWay}`,
    `- 방향: ${same}.`,
    `요약의 첫 문장은 이 비교를 두 시점의 값과 함께 씁니다 (물가 상승률 ${cpiBefore.toFixed(2)}% → ${cpiNow.toFixed(2)}%, 기준금리 ${rateBefore}% → ${rateNow}%). "상관관계는 확인할 수 없습니다" 로 시작하지 않습니다.`,
    `두 시점을 비교한 것이라 통계적 상관관계나 인과관계를 뜻하지 않는다는 점은 주의점에 한 번만 쓰고, 요약 · 확인하지 못한 것에서 되풀이하지 않습니다. 숫자 카드는 코드가 넣으므로 이 세 항목의 카드는 쓰지 않아도 됩니다.`,
    `중앙은행이 물가가 오르면 금리를 올려 대응하는 일이 많다는 것은 일반적인 설명입니다. 쓸 때는 "일반적으로" 라고 밝히고, 이번 움직임의 원인이라고 쓰지 않습니다.`,
  ].join("\n");
}

const pp = (d: number) => (Math.abs(d) < 0.005 ? "변동 없음" : `${d > 0 ? "+" : ""}${d.toFixed(2)}%p`);

/**
 * 두 시점의 물가 상승률과 기준금리를 "오늘의 숫자" 맨 앞에 넣습니다. 작성이 이 항목들로 쓴 카드(지수 수준 · 30일 비교 등)는 빼서
 * 같은 지표가 다른 기준으로 겹쳐 나오지 않게 합니다. 값은 장부 그대로라 검증을 통과합니다. 비교할 자료가 모자라면 받은 그대로 돌려줍니다.
 */
export function withRelationNumbers(output: WriterOutput, evidence: Evidence[]): WriterOutput {
  const rows = relationRows(evidence);
  if (!rows) return output;
  const { now, before, bok } = rows;
  const same = new Set(evidence.filter((e) => isKrCpi(e) || (e.tool === areaTools.rate && e.values.indicator === "한국은행 기준금리")).map((e) => e.id));
  const asOf = (e: Evidence) => month(e.values["latest.month"]);
  const cards: WriterOutput["numbers"] = [
    { label: `물가 상승률 (${asOf(now)}, 전년 같은 달 대비)`, value: `${(yoy(now) as number).toFixed(2)}%`, change: "", asOf: asOf(now), ref: now.id },
    { label: `물가 상승률 (1년 전, ${asOf(before)})`, value: `${(yoy(before) as number).toFixed(2)}%`, change: "", asOf: asOf(before), ref: before.id },
    { label: "한국은행 기준금리", value: `${Number(bok.values.rate)}%`, change: `1년 ${pp(Number(bok.values.changePp))}`, asOf: String(bok.values.asOf), ref: bok.id },
  ];
  // 이 항목들로 만든 계산(C 번호)도 뺍니다: 1년 전 물가 상승률과 지금 금리의 차이처럼 시점이 다른 값을 뺀 카드가 나왔습니다 (11/21 실측)
  for (const e of evidence) if (e.lineage?.inputs.some((id) => same.has(id))) same.add(e.id);
  return { ...output, numbers: [...cards, ...output.numbers.filter((n) => !(n.ref && same.has(n.ref)))] };
}

/**
 * 환율과 금리의 관계 질문 (11/22). 11/21 점검: "환율이랑 금리 관계 알려줘" 에 30일 비교만 있어 금리가 둘 다 "변동 없음" 이라
 * "인과관계는 확인되지 않아요" 가 한 줄 요약이 됐습니다. 물가 · 금리와 같은 방식으로 1년 전 값과 나란히 놓습니다:
 * 원/달러 환율 1년 변화, 한국은행 기준금리와 미국 실효 연방기금금리의 1년 변화, 두 금리의 차이.
 */
export function isFxRateQuestion(question: string): boolean {
  if (/(19|20)\d{2}\s*년|\d+\s*년\s*(전|간|동안)|작년|지난해|재작년/.test(question)) return false;
  return /상관|관계|연관|영향|같이\s*움직|따라\s*움직/.test(question) && /환율|달러|원화/.test(question) && /금리/.test(question) && !/엔화|유로|위안|일본|유럽|중국/.test(question);
}

const isUsdYear = (e: Evidence) => e.tool === areaTools.fx && e.values.pair === "USD/KRW" && typeof e.values.changePct === "number" && daysBetween(e.values["comparison.asOf"], e.values.asOf) >= 330;
const isDffYear = (e: Evidence) => e.tool === areaTools.rate && e.values.indicator === "미국 실효 연방기금금리" && Number(e.values.requestedDays) === 365;
function daysBetween(from: unknown, to: unknown): number {
  return (Date.parse(String(to)) - Date.parse(String(from))) / 86_400_000;
}

/** 환율 · 금리 관계 질문이면 1년 비교 자료 중 없는 것을 채웁니다 (원/달러 365일, 한국 · 미국 정책금리 365일) */
export async function ensureFxRate(ctx: ResearchContext, question: string, tools: readonly InvokableTool[]): Promise<boolean> {
  if (!isFxRateQuestion(question)) return false;
  const fx = tools.find((t) => t.name === areaTools.fx);
  const rate = tools.find((t) => t.name === areaTools.rate);
  if (!fx || !rate) return false;
  const rc = new RunContext(ctx);
  const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
  await Promise.all([
    ctx.evidence.some(isUsdYear) ? undefined : quiet(fx.invoke(rc, JSON.stringify({ currency: "USD", days: 365 }))),
    ctx.evidence.some(isBokYear) ? undefined : quiet(rate.invoke(rc, JSON.stringify({ series: "BOK", days: 365 }))),
    ctx.evidence.some(isDffYear) ? undefined : quiet(rate.invoke(rc, JSON.stringify({ series: "DFF", days: 365 }))),
  ]);
  return true;
}

/** [환율과 금리 나란히] 에 쓰는 항목들. 셋이 다 있어야 비교가 됩니다 */
export function fxRateRows(evidence: Evidence[]): { fx: Evidence; bok: Evidence; dff: Evidence } | null {
  const fx = evidence.find(isUsdYear);
  const bok = evidence.find(isBokYear);
  const dff = evidence.find(isDffYear);
  return fx && bok && dff ? { fx, bok, dff } : null;
}

const won = (n: unknown) => Number(n).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 작성 입력에 붙이는 [환율과 금리 나란히] */
export function fxRateNote(evidence: Evidence[]): string {
  const rows = fxRateRows(evidence);
  if (!rows) return "";
  const { fx, bok, dff } = rows;
  const gapNow = Number(dff.values.rate) - Number(bok.values.rate);
  const gapBefore = Number(dff.values.comparisonRate) - Number(bok.values.comparisonRate);
  const gapWay = Math.abs(gapNow - gapBefore) < 0.005 ? "그대로입니다" : gapNow > gapBefore ? "벌어졌습니다" : "좁혀졌습니다";
  const fxPct = Number(fx.values.changePct);
  return [
    `[환율과 금리 나란히] 질문은 환율과 금리의 관계를 물었습니다. 상관계수는 계산하지 않았지만, 지난 1년 두 지표의 움직임을 나란히 볼 수 있습니다.`,
    `- 원/달러 환율: ${fx.values["comparison.asOf"]} ${won(fx.values["comparison.rate"])}원 → ${fx.values.asOf} ${won(fx.values.rate)}원, 1년 변화 ${fxPct > 0 ? "+" : ""}${fxPct.toFixed(2)}% (ref ${fx.id}). ${fxPct > 0 ? "환율이 올라 원화가 약해진" : "환율이 내려 원화가 강해진"} 방향입니다.`,
    `- 한국은행 기준금리: ${bok.values.comparisonDate} ${bok.values.comparisonRate}% → ${bok.values.asOf} ${bok.values.rate}% (ref ${bok.id})`,
    `- 미국 실효 연방기금금리: ${dff.values.comparisonDate} ${dff.values.comparisonRate}% → ${dff.values.asOf} ${dff.values.rate}% (ref ${dff.id})`,
    `- 미국 금리가 한국보다 높은 폭은 1년 사이 ${gapWay}. 이 폭을 숫자로 쓰려면 장부의 계산 항목(C 번호)이 있을 때만 씁니다.`,
    `요약의 첫 문장은 이 1년 비교를 값과 함께 씁니다. "인과관계는 확인되지 않아요" 로 시작하거나 한 줄 요약을 그 말로 끝내지 않습니다.`,
    `일반적으로 미국 금리가 한국보다 높아질수록 달러를 가지려는 수요가 늘어 환율이 오르기 쉽다는 것은 일반적인 설명입니다. 쓸 때는 "일반적으로" 라고 밝히고, 이번 1년이 그 설명대로 움직였는지 반대였는지를 위 값으로 말합니다.`,
    `두 시점을 비교한 것이라 인과관계를 뜻하지 않는다는 점은 주의점에 한 번만 씁니다. 숫자 카드는 코드가 넣습니다.`,
  ].join("\n");
}

/** 환율 · 두 금리의 1년 비교 카드를 맨 앞에 넣고, 작성이 같은 지표로 쓴 카드는 뺍니다 */
export function withFxRateNumbers(output: WriterOutput, evidence: Evidence[]): WriterOutput {
  const rows = fxRateRows(evidence);
  if (!rows) return output;
  const { fx, bok, dff } = rows;
  const same = new Set(evidence.filter((e) => (e.tool === areaTools.fx && e.values.pair === "USD/KRW") || (e.tool === areaTools.rate && (e.values.indicator === "한국은행 기준금리" || e.values.indicator === "미국 실효 연방기금금리"))).map((e) => e.id));
  // 이 항목들로 만든 계산(C 번호)도 뺍니다 (30일 비교 카드가 1년 비교와 나란히 나오지 않게)
  for (const e of evidence) if (e.lineage?.inputs.some((id) => same.has(id))) same.add(e.id);
  const fxPct = Number(fx.values.changePct);
  const cards: WriterOutput["numbers"] = [
    { label: "달러당 원화 환율", value: `${won(fx.values.rate)}원`, change: `1년 ${fxPct > 0 ? "+" : ""}${fxPct.toFixed(2)}%`, asOf: String(fx.values.asOf), ref: fx.id },
    { label: "한국은행 기준금리", value: `${Number(bok.values.rate)}%`, change: `1년 ${pp(Number(bok.values.changePp))}`, asOf: String(bok.values.asOf), ref: bok.id },
    { label: "미국 실효 연방기금금리", value: `${Number(dff.values.rate)}%`, change: `1년 ${pp(Number(dff.values.changePp))}`, asOf: String(dff.values.asOf), ref: dff.id },
  ];
  return { ...output, numbers: [...cards, ...output.numbers.filter((n) => !(n.ref && same.has(n.ref)))] };
}

const NEGATIVE_HEADLINE = /확인되지\s*않|확인할\s*수\s*없|단정할\s*수|판단할\s*수\s*없|알기\s*어려|단정하기\s*어려/;

/**
 * 관계 질문의 한 줄 요약이 없거나 "…인과관계는 단정할 수 없어요" 로 끝나면, 코드가 장부 값으로 만든 한 줄로 바꿉니다
 * (11/22 실측: 1년 비교를 주고도 한 줄이 "금리 차이는 환율에 영향을 줄 수 있지만 … 단정할 수는 없어요"). 값은 숫자 카드와 같습니다.
 */
export function relationHeadline(headline: string | null | undefined, evidence: Evidence[]): string | null | undefined {
  // 부정 문장이거나 숫자가 하나도 없는 일반론("금리 차이는 환율에 영향을 줄 수 있어요")이면 장부 값으로 만든 한 줄로 바꿉니다
  if (headline && !NEGATIVE_HEADLINE.test(headline) && /\d/.test(headline)) return headline;
  const fxRate = fxRateRows(evidence);
  if (fxRate) {
    const p = Number(fxRate.fx.values.changePct);
    const part = (name: string, d: number, last: boolean) =>
      Math.abs(d) < 0.005 ? `${name} 금리는 그대로${last ? "였어요" : "였고"}` : `${name} 금리는 ${Math.abs(d).toFixed(2)}%p ${d > 0 ? (last ? "올랐어요" : "올랐고") : last ? "내렸어요" : "내렸고"}`;
    return `지난 1년 원/달러 환율은 ${Math.abs(p).toFixed(2)}% ${p > 0 ? "올랐고" : "내렸고"}, ${part("한국", Number(fxRate.bok.values.changePp), false)}, ${part("미국", Number(fxRate.dff.values.changePp), true)}.`;
  }
  const rows = relationRows(evidence);
  if (rows) {
    return `지난 1년 물가 상승률은 ${(yoy(rows.before) as number).toFixed(2)}%에서 ${(yoy(rows.now) as number).toFixed(2)}%로, 기준금리는 ${Number(rows.bok.values.comparisonRate)}%에서 ${Number(rows.bok.values.rate)}%로 움직였어요.`;
  }
  return headline;
}
