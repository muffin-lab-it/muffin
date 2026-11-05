import { afterEach, describe, expect, it, vi } from "vitest";
import { muffinTools } from "../tools";
import { stdev } from "../tools/calc/metrics";
import { causeMap, currencyOf, ECB_90D_URL, isFxQuestion, judge, levelOf, measureMovement, movementEvidence, movementNote, movementNotice, movementSummary, parseEcbDaily, seriesUrl, type Movement } from "./movement";
import type { Evidence, WriterOutput } from "./schema";
import { verify } from "./verify";

/** 환율이 주제인 원인 질문 (관심 영역 환율) */
const ASK = { question: "요즘 원달러 환율이 왜 이렇게 내렸어?", area: "fx" as const };
const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** 조사가 장부에 남기는 환율 결과 (환율 tool 의 data 를 defineTool 이 펼친 모양) */
function fxEvidence(id: string, over: Record<string, string | number> = {}): Evidence {
  return {
    id,
    tool: "get_fx_krw_rate",
    label: "환율 확인 · Frankfurter v2",
    values: {
      pair: "USD/KRW",
      unit: "KRW per 1 USD",
      rate: 1339.36,
      asOf: "2026-11-02",
      "comparison.rate": 1353.71,
      "comparison.asOf": "2026-10-03",
      change: -14.35,
      changePct: -1.06,
      ...over,
    },
    source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-11-02" },
  };
}

const rate: Evidence = {
  id: "E2",
  tool: "get_rate_data",
  label: "금리 확인 · FRED — DFF",
  values: { indicator: "미국 실효연방기금금리", rate: 3.88, unit: "%", asOf: "2026-10-30", comparisonRate: 3.88, changePp: 0 },
  source: { name: "FRED — DFF", url: "https://fred.stlouisfed.org/series/DFF", asOf: "2026-10-30" },
};
const news: Evidence = {
  id: "E3-1",
  tool: "get_korean_economic_news",
  label: "경제 뉴스 확인 · 연합뉴스",
  values: { title: "원·달러 환율, 수출 호조에 1,330원대로", publishedAt: "2026-10-30" },
  source: { name: "연합뉴스", url: "https://www.yna.co.kr/view/AKR1", asOf: "2026-10-30" },
};

/** 비교 기준일 직전 90일은 하루 +0.3% · -0.3% 가 번갈아 오고, 이번 기간은 매일 -0.04% 인 일별 환율 (Frankfurter 응답 모양) */
const BASELINE = Array.from({ length: 89 }, (_, i) => (i % 2 ? -0.3 : 0.3));
function dailyRows(from = "2026-10-03", to = "2026-11-02", currency = "USD") {
  const rows: { date: string; base: string; quote: string; rate: number }[] = [];
  let r = 1300;
  for (let d = shift(from, -89), i = 0; d <= to; d = shift(d, 1), i++) {
    if (i > 0) r *= 1 + (d <= from ? BASELINE[i - 1]! : -0.04) / 100;
    rows.push({ date: d, base: currency, quote: "KRW", rate: r });
  }
  return rows;
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("유의성 게이트: measureMovement", () => {
  it("직전 90일 하루 변화의 표준편차 × √(이번 기간 관측 수) 를 평소 폭으로 잡고, 이번 변화가 그 몇 배인지 잰다", async () => {
    const fetchMock = stubFetch(dailyRows());
    const { movement, step } = await measureMovement([fxEvidence("E1")], ASK);

    // 같은 출처에서 비교 기준일 90일 전부터 최신 기준일까지 받는다
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(seriesUrl("USD", "2026-07-05", "2026-11-02"));
    // 기준 기간의 변화 89개만 쓴다 (이번 기간의 -0.04% 30개는 넣지 않음)
    const typical = stdev(BASELINE) * Math.sqrt(30);
    const move = (1339.36 / 1353.71 - 1) * 100;
    expect(movement).toEqual({
      ref: "E1",
      pair: "USD/KRW",
      period: { from: "2026-10-03", to: "2026-11-02", days: 30 },
      movePct: -1.06,
      typicalPct: Number(typical.toFixed(2)),
      zScore: Number((move / typical).toFixed(2)),
      level: "normal",
      rates: { from: 1353.71, to: 1339.36 },
      baseline: { from: "2026-07-06", to: "2026-10-03", changes: 89, url: seriesUrl("USD", "2026-07-05", "2026-11-02"), sourceName: "Frankfurter v2 일별 환율" },
      series: expect.any(Array),
    });
    // 차트용 일별 환율: 비교 기준일부터 최신 기준일까지 (리포트의 30일 변화와 같은 기간), 받은 단위 그대로
    expect(movement!.series[0]!.date).toBe("2026-10-03");
    expect(movement!.series.at(-1)!.date).toBe("2026-11-02");
    expect(movement!.series).toHaveLength(31);
    expect(step).toMatchObject({ tool: "calc_movement", status: "ok" });
  });

  it("Frankfurter 가 답하지 않으면 같은 원천인 ECB 90일 파일(유로 교차)로 잰다", async () => {
    const rows = dailyRows();
    const xml = `<?xml version="1.0"?><gesmes:Envelope><Cube>${rows
      .map((r) => `<Cube time="${r.date}"><Cube currency="USD" rate="1.1"/><Cube currency="JPY" rate="170"/><Cube currency="KRW" rate="${(r.rate * 1.1).toFixed(4)}"/></Cube>`)
      .join("")}</Cube></gesmes:Envelope>`;
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("frankfurter") ? new Response("down", { status: 503 }) : new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { movement, step } = await measureMovement([fxEvidence("E1")], ASK);
    expect(step).toMatchObject({ tool: "calc_movement", status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toBe(ECB_90D_URL);
    expect(movement).toMatchObject({ level: "normal", baseline: { url: ECB_90D_URL, sourceName: expect.stringContaining("ECB") } });
    // 교차 계산한 값이 Frankfurter 값과 같으므로 평소 폭도 같다
    expect(movement!.typicalPct).toBe(Number((stdev(BASELINE) * Math.sqrt(30)).toFixed(2)));
    expect(movement!.series.at(-1)!.rate).toBeCloseTo(rows.at(-1)!.rate, 2);
    expect(parseEcbDaily(xml, "EUR", "2026-11-01", "2026-11-02").map((r) => r.rate)).toEqual(rows.slice(-2).map((r) => Number((r.rate * 1.1).toFixed(4))));
    expect(() => parseEcbDaily("<Cube/>", "USD", "2026-01-01", "2026-12-31")).toThrow("찾지 못했습니다");
  });

  it("평소 폭의 1배 미만은 평소 범위, 2배 미만은 큰 편, 그 이상은 드문 움직임 (방향과 무관)", async () => {
    expect([0, 0.99, -0.99].map(levelOf)).toEqual(["normal", "normal", "normal"]);
    expect([1, -1.5, 1.99].map(levelOf)).toEqual(["notable", "notable", "notable"]);
    expect([2, -3.4].map(levelOf)).toEqual(["extreme", "extreme"]);
    // 판정은 보이는 값(소수 둘째 자리)으로: 0.996 은 "1.00배" 로 보이므로 큰 편 (안내 문구와 판정이 어긋나지 않게)
    expect(judge(0.996)).toEqual({ zScore: 1, level: "notable" });
    expect(judge(0.994)).toEqual({ zScore: 0.99, level: "normal" });
    expect(judge(-1.996)).toEqual({ zScore: -2, level: "extreme" });

    // 평소 폭은 ±1.65% 안팎 (하루 ±0.3%, 30일)
    stubFetch(dailyRows());
    const big = await measureMovement([fxEvidence("E1", { rate: 1395 })], ASK);
    expect(big.movement).toMatchObject({ movePct: 3.05, zScore: 1.85, level: "notable" });
    const huge = await measureMovement([fxEvidence("E1", { rate: 1420 })], ASK);
    expect(huge.movement).toMatchObject({ movePct: 4.9, level: "extreme" });
  });

  it("엔화는 100엔 기준 표시와 상관없이 JPY 로 받는다", async () => {
    const fetchMock = stubFetch(dailyRows(undefined, undefined, "JPY"));
    const { movement } = await measureMovement([fxEvidence("E1", { pair: "JPY(100)/KRW", rate: 905.1, "comparison.rate": 912.4 })], { question: "엔화가 왜 이렇게 떨어졌어?", area: "fx" });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("base=jpy&quotes=krw");
    expect(movement?.pair).toBe("JPY(100)/KRW");
  });

  it("잴 환율 결과가 없거나 값이 모자라면 아무것도 부르지 않는다", async () => {
    const fetchMock = stubFetch(dailyRows());
    expect(await measureMovement([rate, news], ASK)).toEqual({ movement: null });
    expect(await measureMovement([fxEvidence("E1", { "comparison.asOf": "" })], ASK)).toEqual({ movement: null });
    expect(fetchMock).not.toHaveBeenCalled();
    // 첫 환율 결과가 모자라면 다음 환율 결과를 잰다
    const { movement } = await measureMovement([fxEvidence("E1", { pair: "" }), fxEvidence("E4")], ASK);
    expect(movement?.ref).toBe("E4");
  });

  it("질문의 주제가 환율일 때만 잰다 (ETF 원인 질문에서 조사가 환율을 보조로 받아도 재지 않음)", async () => {
    const fetchMock = stubFetch(dailyRows());
    const tiger = "TIGER 미국S&P500 수익률이 S&P500 지수랑 왜 차이 나?";
    expect(await measureMovement([fxEvidence("E1")], { question: tiger, area: "etf" })).toEqual({ movement: null });
    expect(await measureMovement([fxEvidence("E1")], { question: tiger })).toEqual({ movement: null });
    expect(fetchMock).not.toHaveBeenCalled();

    // 관심 영역이 환율이면 재고, ETF · 금리 · 물가면 재지 않는다
    expect(isFxQuestion("요즘 왜 이렇게 움직여?", "fx")).toBe(true);
    expect(isFxQuestion("환율 때문에 수익률이 왜 달라?", "etf")).toBe(false);
    expect(isFxQuestion("달러가 왜 올랐어?", "rate")).toBe(false);
    // 영역이 없거나 경제뉴스면 질문 글로: 환율 낱말이 있고 다른 주제 낱말이 없을 때만
    expect(isFxQuestion("환율이 움직이는 이유를 뉴스에서는 뭐라고 해?", "news")).toBe(true);
    expect(isFxQuestion("달러가 왜 이렇게 올랐어?")).toBe(true);
    expect(isFxQuestion("최근 우리나라 물가가 왜 올랐어?", "news")).toBe(false);
    expect(isFxQuestion("미국 금리 때문에 달러가 왜 올랐어?")).toBe(false);
  });

  it("질문에 나온 통화의 환율 결과를 잰다 (여럿이면 먼저 나온 통화, 없으면 첫 결과)", async () => {
    expect(currencyOf("요즘 원달러 환율이 왜 이렇게 내렸어?")).toBe("USD");
    expect(currencyOf("엔화가 달러보다 왜 더 떨어졌어?")).toBe("JPY");
    expect(currencyOf("100엔 환율이 왜 내렸어?")).toBe("JPY");
    expect(currencyOf("유로 환율 왜 올랐어?")).toBe("EUR");
    expect(currencyOf("엔 환율이 왜 내렸어?")).toBe("JPY");
    expect(currencyOf("엔이 왜 이렇게 싸졌어?")).toBe("JPY");
    expect(currencyOf("원/엔 환율 왜 움직여?")).toBe("JPY");
    expect(currencyOf("엔진 오일 값이 왜 올랐어?")).toBeUndefined();
    expect(currencyOf("환율이 왜 움직여?")).toBeUndefined();

    // 질문한 통화의 결과가 없거나 tool 에 없는 통화면 다른 통화를 대신 재지 않는다
    const fetchMock = stubFetch(dailyRows());
    expect(await measureMovement([fxEvidence("E1")], { question: "유로 환율 왜 올랐어?", area: "fx" })).toEqual({ movement: null });
    expect(await measureMovement([fxEvidence("E1")], { question: "위안화 왜 이렇게 떨어졌어?", area: "fx" })).toEqual({ movement: null });
    expect(await measureMovement([fxEvidence("E1")], { question: "호주 달러 왜 올랐어?", area: "fx" })).toEqual({ movement: null });
    expect(fetchMock).not.toHaveBeenCalled();

    stubFetch(dailyRows(undefined, undefined, "JPY"));
    const ledger = [fxEvidence("E1"), fxEvidence("E2", { pair: "JPY(100)/KRW", rate: 905.1, "comparison.rate": 912.4 })];
    expect((await measureMovement(ledger, { question: "엔화가 왜 이렇게 떨어졌어?", area: "fx" })).movement?.ref).toBe("E2");
    // 통화를 말하지 않았는데 장부에 여러 통화가 있으면 어느 것을 물었는지 몰라 재지 않고, 한 통화뿐이면 그것을 잰다
    expect(await measureMovement(ledger, { question: "환율이 왜 움직여?", area: "fx" })).toEqual({ movement: null });
    stubFetch(dailyRows());
    const usdOnly = [fxEvidence("E1"), fxEvidence("E3", { "comparison.asOf": "2026-10-26" })];
    expect((await measureMovement(usdOnly, { question: "환율이 왜 움직여?", area: "fx" })).movement?.ref).toBe("E1");
  });

  it("응답 오류 · 모양이 다른 응답 · 모자란 기준 기간은 throw 하지 않고 error step 으로 남긴다", async () => {
    stubFetch({ message: "server error" }, 500);
    const failed = await measureMovement([fxEvidence("E1")], ASK);
    expect(failed.movement).toBeNull();
    expect(failed.step).toMatchObject({ tool: "calc_movement", status: "error" });

    stubFetch([{ date: "2026-11-02", base: "EUR", quote: "KRW", rate: 1500 }]);
    expect((await measureMovement([fxEvidence("E1")], ASK)).step?.error).toContain("형식");

    // 기준 기간에 하루 변화가 29개뿐 (최소 30개)
    stubFetch(dailyRows().slice(60));
    expect((await measureMovement([fxEvidence("E1")], ASK)).step?.error).toContain("평소 폭을 정하지 않았습니다");
  });
});

const normal: Movement = {
  ref: "E1",
  pair: "USD/KRW",
  period: { from: "2026-10-03", to: "2026-11-02", days: 30 },
  movePct: -1.06,
  typicalPct: 1.69,
  zScore: -0.63,
  level: "normal",
  rates: { from: 1353.71, to: 1339.36 },
  baseline: { from: "2026-07-06", to: "2026-10-03", changes: 89, url: seriesUrl("USD", "2026-07-05", "2026-11-02"), sourceName: "Frankfurter v2 일별 환율" },
  series: [],
};
const notable: Movement = { ...normal, movePct: 2.71, zScore: 1.6, level: "notable" };

describe("유의성 게이트: 장부 · 안내 · 작성 입력", () => {
  it("장부에는 C 번호 계산 항목으로 올라가고, 작성이 쓴 평소 폭 · 배수 · 변화율은 검증을 통과한다", () => {
    const entry = movementEvidence(normal, "C2");
    expect(entry).toMatchObject({
      id: "C2",
      tool: "calc_movement",
      label: "평소 움직임과 비교 · USD/KRW 30일 변화의 크기 (직전 90일 기준)",
      // 기준 기간 데이터는 따로 받았으므로 그 주소가 출처다 (원본 보기에서 열 수 있음)
      source: { name: "Frankfurter v2 일별 환율 (2026-07-06 ~ 2026-11-02)", url: normal.baseline.url, asOf: "2026-11-02" },
      lineage: { op: "zscore", inputs: ["E1"] },
    });
    expect(entry.values).toMatchObject({ movePct: -1.06, typicalMovePct: 1.69, zScore: -0.63, timesTypical: 0.63, level: "normal" });

    const output: WriterOutput = {
      summary: "USD/KRW 는 30일 동안 1.06% 내렸지만, 직전 90일 기준 평소 폭(±1.69%)의 0.63배라 평소 범위 안의 움직임입니다.",
      numbers: [{ label: "평소 30일 변동 폭", value: "±1.69%", change: "", asOf: "2026-11-02", ref: "C2" }],
      why: [],
      impact: [],
      caveats: [],
      dataGaps: [],
      nextTopics: [],
    };
    const result = verify(output, [fxEvidence("E1"), entry]);
    expect(result.failures).toEqual([]);
    expect(result.numbers[0]).toMatchObject({ status: "derived" });
    // 1.06% "올랐다" 고 쓰면 방향이 틀려 걸린다 (숫자가 있는 문장의 방향 검사)
    expect(verify({ ...output, summary: "USD/KRW 는 30일 동안 1.06% 올랐습니다." }, [fxEvidence("E1"), entry]).ok).toBe(false);
  });

  it("리포트 movement 칸과 안내 문구", () => {
    expect(movementSummary(normal)).toEqual({ ref: "E1", zScore: -0.63, window: 90, level: "normal" });
    expect(movementNotice(normal)).toBe(
      "USD/KRW 30일 변화(-1.06%)는 직전 90일 기준 평소 폭(±1.69%)의 0.63배로, 평소 범위 안의 움직임입니다. 이 정도 움직임은 뚜렷한 원인 없이도 생길 수 있습니다.",
    );
    expect(movementNotice(notable)).toBe("USD/KRW 30일 변화(+2.71%)는 직전 90일 기준 평소 폭(±1.69%)의 1.60배로, 평소보다 큰 움직임입니다.");
  });

  it("평소 범위면 실제 방향과 크기를 알리고 원인을 단정하지 않게 한다 (원인 후보 목록 없음)", () => {
    const note = movementNote(normal, "C2", [fxEvidence("E1"), rate, news], null);
    expect(note).toContain("[움직임 크기] 코드가 계산한 값입니다 (C2)");
    expect(note).toContain("-1.06% 내렸습니다. 같은 USD 를 사는 데 드는 원화가 줄어든 원화 강세입니다");
    expect(note).toContain("이번 변화는 그 0.63배라 평소 범위 안의 움직임입니다");
    expect(note).toContain("질문이 반대 방향을 전제했으면 실제 방향으로 바로잡습니다");
    expect(note).toContain("단정하지 않습니다");
    expect(note).not.toContain("[원인 후보]");
    // 장부 전체를 보면(정제 실패) 게이트 항목도 [증거 장부] 에 있으므로 덧붙이지 않는다
    expect(note).not.toContain("[덧붙인 장부 항목]");

    // 정제가 고른 사실만 보면 게이트의 C 번호 항목은 작성에게 안 보이므로 값을 덧붙인다
    const filtered = movementNote(normal, "C2", [fxEvidence("E1"), movementEvidence(normal, "C2")], new Set(["E1"]));
    expect(filtered).toContain("[덧붙인 장부 항목]");
    expect(filtered).toContain("- C2 · 평소 움직임과 비교 · USD/KRW 30일 변화의 크기 (직전 90일 기준) · 기준일 2026-11-02");
    expect(filtered).toContain('"typicalMovePct":1.69');
  });

  it("평소보다 크면 원인 지도의 후보마다 장부 근거 id 를 붙이고, 작성이 못 보는 근거는 값을 덧붙인다", () => {
    const eur = fxEvidence("E4", { pair: "EUR/KRW" });
    // 같은 USD/KRW 의 다른 기간 결과(E5)와, 기간이 다른 엔화 결과(E6)는 "다른 통화" 근거가 아니다
    const jpyYear = fxEvidence("E6", { pair: "JPY(100)/KRW", "comparison.asOf": "2025-11-02" });
    // 기간(2026-10-03 ~ 11-02) 밖의 기사는 근거로 넘기지 않는다. 끝은 하루 여유(11-03 까지)
    const late = { ...news, id: "E3-2", values: { ...news.values, publishedAt: "2026-11-05T01:00:00.000Z" } };
    const early = { ...news, id: "E3-3", values: { ...news.values, publishedAt: "2026-09-01T01:00:00.000Z" } };
    const nextMorning = { ...news, id: "E3-4", values: { ...news.values, publishedAt: "2026-11-03T00:30:00.000Z" } };
    const ledger = [fxEvidence("E1"), rate, news, late, early, nextMorning, eur, fxEvidence("E5", { "comparison.asOf": "2026-10-26" }), jpyYear];
    const note = movementNote(notable, "C2", ledger, new Set(["E1", "E2"]));
    expect(note).toContain("+2.71% 올랐습니다. 같은 USD 를 사는 데 드는 원화가 늘어난 원화 약세입니다");
    expect(note).toContain("[원인 후보]");
    expect(note).toContain("- 한미 금리 차이 (정책금리 · 국채 금리): E2");
    expect(note).toContain("- 국내외 경제 뉴스 (정책 · 지표 발표, 시장 이벤트): E3-1 · E3-4\n");
    // 잰 대상(E1)은 자기 자신의 근거가 아니고, 다른 통화쌍(E4)만 근거다
    expect(note).toContain("원화만의 움직임인지): E4\n");
    // 사실 목록에 없는 E3-1 · E4 만 값을 붙인다
    expect(note).toContain("[덧붙인 장부 항목]");
    expect(note).toContain("- E3-1 · 경제 뉴스 확인 · 연합뉴스");
    expect(note).not.toContain("- E2 · 금리 확인");

    // 근거가 없는 후보는 무엇이 필요한지 적고, 장부 전체를 보면 값을 덧붙이지 않는다
    const bare = movementNote(notable, "C2", [fxEvidence("E1")], null);
    expect(bare).toContain("- 한미 금리 차이 (정책금리 · 국채 금리): 장부에 없음 (필요한 것: 한국 기준금리와 미국 정책금리)");
    expect(bare).not.toContain("[덧붙인 장부 항목]");
  });

  it("정제가 뺀 근거는 다시 넣지 않고, 비교 기간이 다른 금리는 수준만 근거로 쓰게 한다", () => {
    const yearRate = { ...rate, id: "E2", values: { ...rate.values, comparisonDate: "2025-10-30" } };
    const monthRate = { ...rate, id: "E5", values: { ...rate.values, comparisonDate: "2026-10-01" } };
    const note = movementNote(notable, "C2", [fxEvidence("E1"), yearRate, monthRate, news], null, new Set(["E3-1"]));
    // 정제가 무관하다고 뺀 기사(E3-1)는 근거가 아니다
    expect(note).toContain("- 국내외 경제 뉴스 (정책 · 지표 발표, 시장 이벤트): 장부에 없음");
    // 1년 비교 금리(E2)는 이번 30일과 기간이 달라 수준만, 30일 비교(E5)는 그대로
    expect(note).toContain("- 한미 금리 차이 (정책금리 · 국채 금리): E2 · E5 (E2 는 비교 기간이 이번 기간과 달라 변화폭이 아니라 지금 수준만 근거로 씁니다)");
  });

  it("원인 지도의 tool 은 모두 레지스트리에 있다", () => {
    const names = new Set(muffinTools.map((t) => t.name));
    for (const c of Object.values(causeMap).flat()) expect(names.has(c.tool)).toBe(true);
  });
});
