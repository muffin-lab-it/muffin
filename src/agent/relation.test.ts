import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import { cpiPair, ensureRelation, relationHeadline, relationHidden, relationNote, relationPlan, relationRefs, relationRows, trimRelationRepeats, withRelationNumbers, type RelationPlan } from "./relation";
import type { Evidence, WriterOutput } from "./schema";
import { verify } from "./verify";

const cpi = (id: string, monthKey: string, change: number | null, country = "KR"): Evidence => ({
  id,
  tool: "get_macro_indicators",
  label: "물가·고용 지표 확인",
  values: { country, indicator: "cpi", "latest.month": monthKey, "latest.value": 120.73, ...(change === null ? {} : { "latest.previousYear.change": change }), changeUnit: "percent" },
  source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: `${monthKey.slice(0, 4)}-${monthKey.slice(4)}-01` },
});
const rate = (id: string, indicator: string, days: number, now: number, before: number, asOf = "2026-11-18"): Evidence => ({
  id,
  tool: "get_rate_data",
  label: "금리 확인",
  values: { indicator, rate: now, asOf, comparisonDate: days === 365 ? "2025-11-18" : "2026-10-19", comparisonRate: before, changePp: Math.round((now - before) * 1e6) / 1e6, requestedDays: days, unit: "%" },
  source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf },
});
const bok = (id: string, days: number, comparisonRate: number) => rate(id, "한국은행 기준금리", days, 3, comparisonRate);
const now = cpi("E1", "202610", 2.818941);
const before = cpi("E4", "202510", 2.38033);
const year = bok("E3", 365, 2.5);
const output = (numbers: WriterOutput["numbers"]): WriterOutput => ({ summary: "", numbers, why: [], impact: [], caveats: [], dataGaps: [], nextTopics: [] });
const keys = (q: string) => relationPlan(q)?.nodes.map((n) => n.key) ?? null;
const plan = (q: string) => relationPlan(q)!;

const fx: Evidence = { id: "E5", tool: "get_fx_krw_rate", label: "환율", values: { pair: "USD/KRW", rate: 1335.94, asOf: "2026-11-22", "comparison.rate": 1472.42, "comparison.asOf": "2025-11-22", changePct: -9.27 }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-11-22" } };
const fx30: Evidence = { ...fx, id: "E6", values: { ...fx.values, "comparison.rate": 1324.45, "comparison.asOf": "2026-10-23", changePct: 0.87 } };
const dff = rate("E7", "미국 실효 연방기금금리", 365, 3.88, 3.88, "2026-11-19");
const kospi: Evidence = { id: "E8", tool: "get_kr_stock_index", label: "코스피", values: { index: "코스피", "latest.date": "2026-11-19", "latest.close": 5137.89, "latest.change": -12.3, "latest.changePct": -0.24, "period.from": "2025-11-19", "period.to": "2026-11-19", "period.closeFrom": 3953.62, "period.change": 1184.27, "period.returnPct": 29.95 }, source: { name: "금융위원회", url: "https://www.data.go.kr/data/15094807/openapi.do", asOf: "2026-11-19" } };
const kospi30: Evidence = { ...kospi, id: "E9", values: { ...kospi.values, "period.from": "2026-10-20", "period.closeFrom": 5552.8, "period.returnPct": -7.47 } };
const jobs: Evidence = { id: "E10", tool: "get_macro_indicators", label: "실업률", values: { country: "KR", indicator: "unemployment", "latest.month": "202610", "latest.value": 2.5, "latest.previousYear.month": "202510", "latest.previousYear.value": 2.7, "latest.previousYear.change": -0.2, changeUnit: "percentage_points", unit: "%" }, source: { name: "한국은행 ECOS", url: "https://ecos.bok.or.kr", asOf: "2026-10-01" } };

describe("관계 질문 찾기 (11/23 공통 틀)", () => {
  it("질문이 말한 지표를 나온 순서대로 찾는다. 나라는 지표 앞의 나라 이름, 없으면 질문 전체의 나라, 그것도 없으면 한국", () => {
    expect(keys("물가와 금리, cpi 상관관계 알려줘")).toEqual(["cpi:KR", "rate:BOK"]);
    expect(keys("금리랑 코스피 관계 알려줘")).toEqual(["rate:BOK", "stock:코스피"]);
    expect(keys("환율이 오르면 코스피는 어떻게 돼?")).toEqual(["fx:USD", "stock:코스피"]);
    expect(keys("미국 금리와 나스닥 관계는?")).toEqual(["rate:DFF", "stock:나스닥 종합"]);
    expect(keys("물가랑 실업률 관계 알려줘")).toEqual(["cpi:KR", "jobs:KR"]);
    expect(keys("미국 물가와 미국 금리 관계는?")).toEqual(["cpi:US", "rate:DFF"]);
    expect(keys("미국 금리와 물가의 관계는?")).toEqual(["rate:DFF", "cpi:US"]);
    expect(keys("한국 물가와 일본 금리 관계 알려줘")).toEqual(["cpi:KR", "rate:JP"]);
    expect(keys("미국 국채 10년물 금리와 S&P 500 관계")).toEqual(["rate:DGS10", "stock:S&P 500"]);
    expect(keys("미국 금리 인상하면 한국 주식은?")).toEqual(["rate:DFF", "stock:코스피"]);
    expect(keys("미국 S&P 500 ETF에 투자할 때 환율 변동이 수익률에 어떤 영향을 주는지 설명해줘.")).toEqual(["stock:S&P 500", "fx:USD"]);
  });

  it("환율과 금리를 함께 물으면 한국 기준금리와 그 통화 나라의 정책금리를 다 본다", () => {
    expect(keys("환율이랑 금리 관계 알려줘")).toEqual(["fx:USD", "rate:BOK", "rate:DFF"]);
    expect(keys("미국 기준금리 변화가 원/달러 환율에 미치는 영향을 최근 상황을 고려해 설명해줘.")).toEqual(["rate:DFF", "fx:USD", "rate:BOK"]);
    expect(keys("엔화 환율이랑 일본 금리 관계는?")).toEqual(["fx:JPY", "rate:JP", "rate:BOK"]);
    expect(keys("한미 금리차와 코스피 관계")).toEqual(["rate:BOK", "rate:DFF", "stock:코스피"]);
    expect(relationPlan("유로 환율과 금리 관계")?.missing).toEqual(["유럽 정책금리"]);
  });

  it("받을 지표가 하나여도, 머핀이 받지 않는 것과 함께 물었으면 대상이다 (환율–수입물가)", () => {
    expect(relationPlan("환율과 수입물가의 관계")).toEqual({ nodes: [expect.objectContaining({ key: "fx:USD" })], missing: ["수입물가"] });
    expect(relationPlan("한국은행 기준금리가 내려가면 은행 적금 금리에는 어떤 영향을 미치나요?")).toEqual({ nodes: [expect.objectContaining({ key: "rate:BOK" })], missing: ["예적금 금리"] });
  });

  it("관계 질문이 아니거나, 기간 · 가상 숫자를 정했거나, 현물 지표가 아니면 대상이 아니다", () => {
    expect(keys("요즘 물가 상승률 얼마야?")).toBeNull();
    expect(keys("금리 인상이 경제에 미치는 영향은?")).toBeNull();
    expect(keys("원달러 환율의 최근 흐름이 미국 여행 경비에 어떤 영향을 줄 수 있는지 설명해줘.")).toBeNull();
    expect(keys("오늘 환율에 영향을 줄 수 있는 주요 경제 뉴스가 있으면 요약해줘.")).toBeNull();
    expect(keys("2020년 한국 물가와 금리 관계 분석해줘")).toBeNull();
    expect(keys("최근 30일 환율과 코스피 관계")).toBeNull();
    expect(keys("한미 금리차와 선물환율의 관계를 가정과 함께 설명해 주세요.")).toBeNull();
    expect(keys("금리가 3%에서 4%가 되면 대출 이자는 어떻게 돼?")).toBeNull();
    expect(keys("실질금리가 오를 때 채권 듀레이션은 수익률에 어떤 영향을 주나요?")).toBeNull();
    expect(keys("환율이 내 해외주식에 영향 있어?")).toBeNull();
    // 받지 않는 나라를 한국 자료로 바꾸지 않는다 (#144 Codex 리뷰)
    expect(keys("독일 물가와 금리 관계")).toBeNull();
    expect(relationPlan("독일 물가와 한국 금리 관계")).toEqual({ nodes: [expect.objectContaining({ key: "rate:BOK" })], missing: ["독일 물가"] });
    expect(relationPlan("일본 주가와 금리 관계")).toEqual({ nodes: [expect.objectContaining({ key: "rate:JP" })], missing: ["일본 주가"] });
    expect(keys("글로벌 금리와 코스피 관계")).toEqual(["stock:코스피"]);
    // 취업자 수 · 고용은 실업률로 바꾸지 않는다
    expect(relationPlan("취업자 수와 기준금리 관계")).toEqual({ nodes: [expect.objectContaining({ key: "rate:BOK" })], missing: ["취업자 수 · 고용"] });
    // 지수 이름의 숫자는 기간이 아니다
    expect(keys("S&P 500 주가와 금리 관계")).toEqual(["stock:S&P 500", "rate:BOK"]);
  });
});

describe("1년 비교 자료 채우기", () => {
  const tools = () => {
    const calls: Record<string, string[]> = {};
    const make = (name: string) => ({ name, invoke: vi.fn(async (_rc: unknown, input: string) => void (calls[name] ??= []).push(input)) });
    return { calls, list: [make("get_fx_krw_rate"), make("get_rate_data"), make("get_macro_indicators")], index: { kr: make("get_kr_stock_index"), us: make("get_us_stock_index") } };
  };

  it("모자란 자료만 받는다: 12개월 전 물가, 1년 금리 · 환율 · 지수", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([now, bok("E2", 30, 3), fx30, kospi30]);
    const t = tools();
    await ensureRelation(ctx, "물가와 금리, cpi 상관관계 알려줘", t.list, t.index);
    expect(t.calls.get_macro_indicators).toEqual(['{"country":"KR","indicator":"cpi","endMonth":"202510","months":1}']);
    expect(t.calls.get_rate_data).toEqual(['{"series":"BOK","days":365}']);

    const t2 = tools();
    await ensureRelation(ctx, "환율이 오르면 코스피는 어떻게 돼?", t2.list, t2.index);
    expect(t2.calls.get_fx_krw_rate).toEqual(['{"currency":"USD","days":365}']);
    expect(t2.index.kr.invoke.mock.calls.map((c) => c[1])).toEqual(['{"index":"코스피","days":365}']);

    const full = new ResearchContext();
    full.addEvidence([now, before, year]);
    const t3 = tools();
    expect(await ensureRelation(full, "물가와 금리 관계 알려줘", t3.list, t3.index)).not.toBeNull();
    expect(t3.calls).toEqual({});
    expect(await ensureRelation(full, "요즘 물가 상승률 얼마야?", t3.list, t3.index)).toBeNull();
  });

  it("최신 달의 1년 전 값이 비어 있으면(미국 2025-10) 한 달 앞 달을 받고, 그 12개월 전 물가도 받는다", async () => {
    const ctx = new ResearchContext();
    const add = (e: Evidence) => ctx.addEvidence([e]);
    const macro = {
      name: "get_macro_indicators",
      invoke: vi.fn(async (_rc: unknown, input: string) => {
        const { endMonth } = JSON.parse(input) as { endMonth: string | null };
        if (endMonth === null) add(cpi("E1", "202610", null, "US"));
        if (endMonth === "202609") add(cpi("E2", "202609", 2.9, "US"));
        if (endMonth === "202509") add(cpi("E3", "202509", 3.022572, "US"));
      }),
    };
    const noop = { name: "get_rate_data", invoke: vi.fn(async () => undefined) };
    await ensureRelation(ctx, "미국 물가와 미국 금리 관계는?", [macro, noop], { kr: noop, us: noop });
    expect(macro.invoke.mock.calls.map((c) => JSON.parse(c[1]).endMonth)).toEqual([null, "202609", "202509"]);
    expect(cpiPair(ctx.evidence, "US")).toEqual({ now: expect.objectContaining({ id: "E2" }), before: expect.objectContaining({ id: "E3" }) });
  });

  it("조회가 실패해도 throw 하지 않는다", async () => {
    const failing = { name: "get_rate_data", invoke: vi.fn(async () => { throw new Error("ECOS 실패"); }) };
    await expect(ensureRelation(new ResearchContext(), "금리랑 코스피 관계 알려줘", [failing], { kr: failing, us: failing })).resolves.not.toBeNull();
  });
});

describe("[지표 나란히] · 카드 · 한 줄 요약", () => {
  it("받은 지표만 나란히 놓고, 과거 물가에 지금 금리를 놓지 않는다", () => {
    const p = plan("물가와 금리 관계 알려줘");
    expect(relationRows([now, before, year], p).map((r) => r.node.key)).toEqual(["cpi:KR", "rate:BOK"]);
    expect(relationRows([cpi("E1", "202010", 0.1), cpi("E4", "201910", 0.0), year], p).map((r) => r.node.key)).toEqual(["rate:BOK"]);
    expect(relationRefs([now, before, year], p)).toEqual(["E1", "E4", "E3"]);
    expect(relationNote([now], p)).toBe("");
  });

  it("물가–금리: 두 시점 값과 방향, 일반적인 관계를 알린다", () => {
    const p = plan("물가와 금리, cpi 상관관계 알려줘");
    const note = relationNote([now, before, year, bok("E2", 30, 3)], p);
    expect(note).toContain("[지표 나란히] 질문은 물가 상승률 · 한국 기준금리의 관계를 물었습니다");
    expect(note).toContain("- 물가 상승률: 2025-10 2.38% (ref E4) → 2026-10 2.82% (ref E1). 1년 사이 높아졌습니다");
    expect(note).toContain("- 한국 기준금리: 2025-11-18 2.5% → 2026-11-18 3% (ref E3), 1년 +0.50%p. 1년 사이 높아졌습니다");
    expect(note).toContain("두 지표가 같은 방향으로 움직였습니다");
    expect(note).toContain("- 일반적으로 물가가 오르면 중앙은행이 금리를 올려 대응하고");
    expect(relationNote([now, before, bok("E3", 365, 3)], p)).toContain("한 지표만 움직였습니다");
    expect(relationNote([now, cpi("E4", "202510", 3.5), year], p)).toContain("두 지표가 반대 방향으로 움직였습니다");
    expect(relationNote([now, year], p)).toContain("- 물가 상승률의 1년 비교 자료는 받지 못했습니다");
  });

  it("환율–금리: 두 나라 금리 차이의 방향과 일반적인 관계", () => {
    const note = relationNote([fx30, fx, year, dff], plan("환율이랑 금리 관계 알려줘"));
    expect(note).toContain("- 원/달러 환율: 2025-11-22 1,472.42원 → 2026-11-22 1,335.94원 (ref E5), 1년 변화 -9.27%. 1년 사이 내렸습니다 (원화가 강해진 방향)");
    expect(note).toContain("- 미국 금리가 한국보다 높은 폭은 1년 사이 좁혀졌습니다");
    expect(note).toContain("- 일반적으로 미국 금리가 한국보다 높아질수록 달러를 가지려는 수요가 늘어 원/달러 환율이 오르기 쉽다.");
  });

  it("환율–코스피 · 해외 지수–환율 · 환율–수입물가: 조합마다의 일반적인 관계", () => {
    expect(relationNote([fx, kospi], plan("환율이 오르면 코스피는 어떻게 돼?"))).toContain("코스피와 환율이 반대로 움직이는 때가 많다");
    const sp: Evidence = { ...kospi, id: "E11", tool: "get_us_stock_index", values: { ...kospi.values, index: "S&P 500" } };
    expect(relationNote([fx, sp], plan("미국 S&P 500 ETF에 투자할 때 환율 변동이 수익률에 어떤 영향을 주는지 설명해줘."))).toContain("원화 기준 수익률은 지수 수익률에 환율 변화가 더해진 것에 가깝다");
    // 해외 지수의 원화 수익률 설명은 원/달러일 때만 (엔화 환율에는 붙이지 않음)
    const jpy: Evidence = { ...fx, id: "E13", values: { ...fx.values, pair: "JPY(100)/KRW", rate: 838.64, "comparison.rate": 937.3, changePct: -10.53 } };
    expect(relationNote([jpy, sp], plan("엔화 환율과 S&P 500 수익률 관계"))).not.toContain("환율 변화가 더해진");
    const imports = relationNote([fx], plan("환율과 수입물가의 관계"));
    expect(imports).toContain('질문의 "수입물가"은(는) 머핀이 받는 자료가 아닙니다');
    expect(imports).toContain("수입물가가 오르기 쉽다");
    expect(relationNote([jobs, now, before], plan("물가랑 실업률 관계 알려줘"))).toContain("필립스 곡선");
  });

  it("지표마다 1년 카드를 맨 앞에 넣고, 같은 지표의 다른 기준 카드와 그 항목으로 만든 계산 카드는 뺀다. 카드는 검증을 통과한다", () => {
    const calc: Evidence = { id: "C1", tool: "calc_metrics", label: "계산", values: { value: -0.62 }, source: { name: "계산", url: "", asOf: "2026-11-18" }, lineage: { op: "diff", inputs: ["E4", "E3"] } };
    const other: Evidence = { id: "E12", tool: "get_fx_krw_rate", label: "환율", values: { pair: "JPY(100)/KRW", rate: 838.64 }, source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev", asOf: "2026-11-20" } };
    const card = (ref: string, value: string) => ({ label: "x", value, change: "", asOf: "2026-11-18", ref });
    const evidence = [now, before, year, bok("E2", 30, 3), calc, other];
    const out = withRelationNumbers(output([card("E1", "120.73"), card("E2", "3%"), card("C1", "-0.62%p"), card("E12", "838.64원")]), evidence, plan("물가와 금리 관계 알려줘"));
    expect(out.numbers).toEqual([
      { label: "물가 상승률 (2026-10, 전년 같은 달 대비)", value: "2.82%", change: "", asOf: "2026-10", ref: "E1" },
      { label: "물가 상승률 (1년 전, 2025-10)", value: "2.38%", change: "", asOf: "2025-10", ref: "E4" },
      { label: "한국은행 기준금리", value: "3%", change: "1년 +0.50%p", asOf: "2026-11-18", ref: "E3" },
      card("E12", "838.64원"),
    ]);
    expect(verify(out, evidence).ok).toBe(true);

    const mixed = withRelationNumbers(output([card("E9", "5,137.89"), card("E6", "1,335.94원")]), [fx30, fx, kospi30, kospi, jobs], plan("환율이 오르면 코스피는 어떻게 돼?"));
    expect(mixed.numbers.map((n) => [n.label, n.value, n.change, n.ref])).toEqual([
      ["달러당 원화 환율", "1,335.94원", "1년 -9.27%", "E5"],
      ["코스피 종가", "5,137.89", "1년 +29.95%", "E8"],
    ]);
    expect(verify(mixed, [fx30, fx, kospi30, kospi]).ok).toBe(true);
    const jobsOut = withRelationNumbers(output([]), [jobs, now, before], plan("물가랑 실업률 관계 알려줘"));
    expect(jobsOut.numbers.at(-1)).toEqual({ label: "실업률 (2026-10)", value: "2.5%", change: "1년 -0.20%p", asOf: "2026-10", ref: "E10" });
    expect(verify(jobsOut, [jobs, now, before]).ok).toBe(true);

    const kept = output([card("E1", "120.73")]);
    expect(withRelationNumbers(kept, [now], plan("물가와 금리 관계 알려줘"))).toBe(kept);
  });

  it("한 줄 요약이 부정문 · 숫자 없는 일반론이면 장부 값으로 만든 한 줄로 바꾼다", () => {
    const p: RelationPlan = plan("환율이랑 금리 관계 알려줘");
    const evidence = [fx30, fx, year, dff];
    expect(relationHeadline("금리 차이는 환율에 영향을 줄 수 있지만, 이번 자료만으로 인과관계를 단정할 수는 없어요", evidence, p)).toBe(
      "지난 1년 원/달러 환율은 9.27% 내렸고, 한국 기준금리는 2.5%에서 3%로 올랐고, 미국 정책금리는 3.88%로 그대로였어요.",
    );
    expect(relationHeadline("지난 1년 환율은 9.27% 내렸어요.", evidence, p)).toBe("지난 1년 환율은 9.27% 내렸어요.");
    // 숫자 없는 일반론 (11/22 운영 14번), "자료가 부족해요 · 분리해 확인하기 어려워요" 꼴 (11/23 점검)
    expect(relationHeadline("금리 차이는 환율에 영향을 줄 수 있어요.", evidence, p)).toContain("9.27% 내렸고");
    expect(relationHeadline("이 기간 금리와 나스닥은 모두 하락했지만, 두 지표의 관계를 판단하기엔 자료가 부족해요.", evidence, p)).toContain("9.27% 내렸고");
    expect(relationHeadline("지난 1년 미국 금리는 같았고 원/달러 환율은 내려가, 이번 변화의 원인은 분리해 확인하기 어려워요", evidence, p)).toContain("9.27% 내렸고");
    expect(relationHeadline(null, [now, before, year], plan("물가와 금리 관계 알려줘"))).toBe("지난 1년 물가 상승률은 2.38%에서 2.82%로 올랐고, 한국 기준금리는 2.5%에서 3%로 올랐어요.");
    expect(relationHeadline(null, [fx, kospi], plan("환율이 오르면 코스피는 어떻게 돼?"))).toBe("지난 1년 원/달러 환율은 9.27% 내렸고, 코스피는 29.95% 올랐어요.");
    expect(relationHeadline("그대로", [], p)).toBe("그대로");
    // "지난 1년" 의 1 은 값이 아니다. 값 없는 한 줄 · 인과관계 꼬리도 바꾼다 (11/23 점검 2번 · 3번)
    expect(relationHeadline("지난 1년 미국 실효금리는 그대로였고 원/달러 환율은 내려갔어요", evidence, p)).toContain("9.27% 내렸고");
    expect(relationHeadline("지난 1년 기준금리와 코스피는 모두 올랐지만, 이 두 시점만으로 인과관계를 뜻하진 않아요.", evidence, p)).toContain("9.27% 내렸고");
  });

  it("작성에게는 같은 지표의 다른 기간 항목과 그 계산을 보이지 않는다 (카드는 1년, 요약은 30일이 되지 않게)", () => {
    const calc: Evidence = { id: "C2", tool: "calc_metrics", label: "계산", values: { value: 0.87 }, source: { name: "계산", url: "", asOf: "2026-11-22" }, lineage: { op: "pct_change", inputs: ["E6"] } };
    expect([...relationHidden([fx30, fx, year, dff, bok("E2", 30, 3), calc, now], plan("환율이랑 금리 관계 알려줘"))].sort()).toEqual(["C2", "E2", "E6"]);
    expect(relationHidden([fx30, year], plan("환율이랑 금리 관계 알려줘")).size).toBe(0);
  });

  it("요약에 되풀이된 상관 · 인과관계 한계와 받지 않는 지표의 한계를 한 곳으로 모은다 (11/23 점검 실제 문장)", () => {
    const out = (summary: string, caveats: string[] = [], dataGaps: string[] = []): WriterOutput => ({ ...output([]), summary, caveats, dataGaps });
    const p = plan("환율이 오르면 코스피는 어떻게 돼?");
    // "A했지만, (한계)" → "A했어요." / 한계만 말한 문장은 뺌 / 주의점에 이미 있으면 그대로
    const mixed = trimRelationRepeats(out("지난 1년 원/달러 환율은 9.27% 내렸어요. 이번 1년 비교에서는 환율과 코스피가 반대 방향으로 움직였지만, 이것만으로 두 지표의 통계적 상관관계나 인과관계를 뜻하지는 않아요.", ["두 시점 비교는 상관관계나 인과관계를 뜻하지 않아요."]), p);
    expect(mixed.summary).toBe("지난 1년 원/달러 환율은 9.27% 내렸어요. 이번 1년 비교에서는 환율과 코스피가 반대 방향으로 움직였어요.");
    expect(mixed.caveats).toHaveLength(1);
    const only = trimRelationRepeats(out("지난 1년 한국 기준금리는 2.5%에서 3%로 올랐어요. 다만 두 시점의 움직임만으로 금리와 코스피의 통계적 상관관계나 인과관계를 뜻한다고 볼 수는 없어요."), p);
    expect(only.summary).toBe("지난 1년 한국 기준금리는 2.5%에서 3%로 올랐어요.");
    expect(only.caveats).toEqual(["두 시점을 비교한 것이라 통계적 상관관계나 인과관계를 뜻하지는 않아요."]);
    // 받지 않는 지표: 확인하지 못한 것에 이미 있으면 요약에서만 뺌, 없으면 한 줄 넣음
    const imports = plan("환율과 수입물가의 관계");
    const gap = trimRelationRepeats(out("지난 1년 원/달러 환율은 9.27% 내렸어요. 다만 실제 수입물가 지수 자료가 없어 이 관계가 이번 기간에 어떻게 나타났는지는 확인할 수 없어요.", [], ["수입물가 지수를 조회하지 못했어요."]), imports);
    expect(gap.summary).toBe("지난 1년 원/달러 환율은 9.27% 내렸어요.");
    expect(gap.dataGaps).toEqual(["수입물가 지수를 조회하지 못했어요."]);
    expect(trimRelationRepeats(out("지난 1년 원/달러 환율은 9.27% 내렸어요. 수입물가 자료가 없어 확인할 수 없어요."), imports).dataGaps).toEqual(['질문의 "수입물가"은(는) 머핀이 받는 자료가 아니라 확인하지 못했어요.']);
    // 과거형이 아닌 앞 구절도 해요체로 끝맺고("있지만 → 있어요", "쉽지만 → 쉬워요"), 한계가 앞에 오면 뒤 구절만 남긴다. 날짜 뒤 "년" 은 뗀다 (11/23 점검 2 · 4 · 8 · 12번)
    const rate = trimRelationRepeats(out("일반적으로 미국 금리가 한국보다 높아지면 달러 수요와 원/달러 환율이 오를 압력이 생길 수 있지만, 이번 자료만으로 미국 금리 변화가 환율 움직임을 일으켰다고 볼 수는 없어요. 일반적으로 미국 금리가 한국보다 높아질수록 원/달러 환율이 오르기 쉽지만, 이 기간의 움직임만으로 그 관계나 원인을 입증할 수는 없어요."), p);
    expect(rate.summary).toBe("일반적으로 미국 금리가 한국보다 높아지면 달러 수요와 원/달러 환율이 오를 압력이 생길 수 있어요. 일반적으로 미국 금리가 한국보다 높아질수록 원/달러 환율이 오르기 쉬워요.");
    expect(trimRelationRepeats(out("일반적으로 미국 금리가 한국보다 높아질수록 원/달러 환율이 오르기 쉽지만, 이번 1년의 환율 움직임이 그 관계 때문이라고 단정할 수는 없어요."), p).summary).toBe("일반적으로 미국 금리가 한국보다 높아질수록 원/달러 환율이 오르기 쉬워요.");
    expect(trimRelationRepeats(out("이번 자료로는 환율과 코스피의 동행 여부나 인과관계를 확인할 수 없고, 코스피는 2026-11-19에 5,137.89포인트였어요."), p).summary).toBe("코스피는 2026-11-19에 5,137.89포인트였어요.");
    expect(trimRelationRepeats(out("일본 정책금리가 2025-11-17년 0.50%에서 2026-11-17년 1.25%로 올랐어요."), p).summary).toBe("일본 정책금리가 2025-11-17 0.50%에서 2026-11-17 1.25%로 올랐어요.");
    // 생활 영향의 한계 문장도 뺀다. 한 칸이 한계뿐이면 그 칸과 제목을 함께 뺀다 (11/23 운영, 베타 A7 남은 것)
    const life = trimRelationRepeats(
      {
        ...out("지난 1년 원/달러 환율은 9.27% 내렸어요."),
        impact: ["해외 결제가 많다면 같은 달러를 더 적은 원화로 살 수 있어요. 다만 그 움직임만으로 원인을 설명할 수는 없어요.", "코스피에 투자하고 있다면 지수 변화가 평가액에 그대로 반영돼요.", "그 움직임만으로 원인을 설명할 수는 없어요."],
        impactTitles: ["해외 결제", "주식 평가액", "원인"],
      },
      p,
    );
    expect(life.impact).toEqual(["해외 결제가 많다면 같은 달러를 더 적은 원화로 살 수 있어요.", "코스피에 투자하고 있다면 지수 변화가 평가액에 그대로 반영돼요."]);
    expect(life.impactTitles).toEqual(["해외 결제", "주식 평가액"]);
    expect(life.caveats).toEqual(["두 시점을 비교한 것이라 통계적 상관관계나 인과관계를 뜻하지는 않아요."]);
    // 어미를 안전하게 바꿀 수 없는 일반 설명 문장은 그대로 둔다 (일반적인 관계를 잃지 않게)
    const general = out("일반적으로 금리가 오르면 주가에 부담이 되지만, 이번 자료만으로 인과관계를 단정할 수는 없어요.");
    expect(trimRelationRepeats(general, p).summary).toBe(general.summary);
    // 값이 든 문장, 한계 문장뿐인 요약은 그대로
    const kept = out("이 기간 상관관계는 확인할 수 없어요.");
    expect(trimRelationRepeats(kept, p)).toBe(kept);
    const plain = out("지난 1년 원/달러 환율은 9.27% 내렸어요.");
    expect(trimRelationRepeats(plain, p)).toBe(plain);
  });
});
