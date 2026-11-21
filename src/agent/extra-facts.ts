/**
 * 코드가 채운 장부 항목을 작성의 사실 목록에 넣기 (리더, 11/21).
 *
 * 작성은 정제가 고른 사실과 그 사실이 인용한 장부 항목만 봅니다 (write.ts writerInput). 코드가 조사 뒤에 채운 항목(지수 종가, 1년 전 금리 · 물가,
 * 대표 ETF, 주제어로 찾은 기사)을 정제가 고르지 않으면, 작성 입력의 안내문에 값이 적혀 있어도 장부에는 그 번호가 없어 작성이 인용하지 않습니다
 * (11/21 실측: "조사 메모의 지난해 비교 수치는 증거 장부에 해당 항목이 없어 숫자로 인용하지 못했습니다" 가 리포트에 나옴).
 * 그래서 코드가 채운 항목은 사실 한 줄로 만들어 사실 목록 뒤에 붙입니다. 정제가 이미 고른 항목은 그대로 둡니다.
 */
import { areaTools } from "./plan";
import type { Evidence, FactsOutput } from "./schema";

const INDEX_TOOLS = new Set(["get_kr_stock_index", "get_us_stock_index"]);
const pct = (n: unknown) => `${Number(n) > 0 ? "+" : ""}${Number(n).toFixed(2)}%`;
const pp = (n: unknown) => (Math.abs(Number(n)) < 0.005 ? "변동 없음" : `${Number(n) > 0 ? "+" : ""}${Number(n).toFixed(2)}%p`);
const points = (n: unknown) => Number(n).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const month = (m: unknown) => `${String(m).slice(0, 4)}-${String(m).slice(4, 6)}`;

/** 장부 항목 하나를 사실 한 줄로. 모양을 모르는 항목은 null (사실 목록에 넣지 않음) */
export function factOf(e: Evidence): string | null {
  const v = e.values;
  if (INDEX_TOOLS.has(e.tool)) {
    return `${v.index} 종가 ${points(v["latest.close"])} (${v["latest.date"]}), 전일 대비 ${pct(v["latest.changePct"])}, ${v["period.from"]} 종가 ${points(v["period.closeFrom"])} 대비 ${pct(v["period.returnPct"])}`;
  }
  if (e.tool === "calc_index_today") return `${v.index} 종가 ${points(v.close)} (${v.date}, ${e.source.name} 보도 · 공식 전일 종가로 검산), 전일 대비 ${pct(v.changePct)}`;
  if (e.tool === areaTools.rate && typeof v.rate === "number") return `${v.indicator} ${v.rate}% (${v.asOf}), ${v.comparisonDate} ${v.comparisonRate}% 대비 ${pp(v.changePp)}`;
  if (e.tool === areaTools.macro && v.indicator === "cpi" && typeof v["latest.previousYear.change"] === "number") {
    return `${v.country === "KR" ? "한국" : "미국"} 소비자물가 상승률(전년 같은 달 대비) ${Number(v["latest.previousYear.change"]).toFixed(2)}% (${month(v["latest.month"])})`;
  }
  if (e.tool === areaTools.etf && typeof v["period.returnPct"] === "number") return `${v.name} 가격 수익률 ${pct(v["period.returnPct"])} (${v["period.from"]} → ${v["period.to"]})`;
  if (e.tool === areaTools.news && typeof v.title === "string") return `${e.source.name} 기사 제목: ${v.title}`;
  return null;
}

/**
 * ids(코드가 채운 장부 번호) 중 정제가 고르지 않은 것을 사실 목록 뒤에 붙인 사실 목록. 정제가 실패했거나(null) 사실이 하나도 없으면
 * 작성이 장부 전체를 보므로 받은 그대로 돌려줍니다. 붙일 것이 없어도 그대로.
 */
export function withEnsuredFacts(facts: FactsOutput | null, evidence: Evidence[], ids: Iterable<string>): FactsOutput | null {
  if (!facts || facts.facts.length === 0) return facts;
  const have = new Set(facts.facts.map((f) => f.ref));
  const wanted = new Set(ids);
  const extra = evidence.filter((e) => wanted.has(e.id) && !have.has(e.id)).flatMap((e) => {
    const fact = factOf(e);
    return fact ? [{ ref: e.id, fact }] : [];
  });
  return extra.length ? { ...facts, facts: [...facts.facts, ...extra] } : facts;
}
