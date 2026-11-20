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

/** 한국 물가와 금리의 관계를 묻는 질문인지 */
export function isRateInflationQuestion(question: string): boolean {
  return /상관|관계|연관|영향|같이\s*움직|따라\s*움직/.test(question) && /물가|인플레|\bcpi\b|소비자물가/i.test(question) && /금리/.test(question) && !/미국|연준|\bFed\b/i.test(question);
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
  return now && before && bok ? { now, before, bok } : null;
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
