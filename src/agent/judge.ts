/**
 * 근거 판정 (3단계, 모델). 리더 관리.
 *
 * ✅ 검증의 코드 검사(숫자 대조 · 근거 표시 · 권유)는 "주장이 맞는지" 는 보지 않습니다. 여기서는 원인(why) 문장마다
 * 인용한 장부 항목(refs)이 그 주장(claim)을 실제로 뒷받침하는지 작은 모델(gpt-5.4-mini)이 봅니다.
 *
 *  - supported: 인용한 장부 항목의 값이나 기사 제목이 주장의 내용과 방향을 직접 뒷받침합니다.
 *  - contradicted: 인용한 장부 항목이 주장과 반대이거나 맞지 않습니다.
 *  - unsupported: 인용한 장부 항목만으로는 알 수 없습니다 (관련은 있지만 주장까지는 안 함, 결과 데이터만 있음, 일반 설명).
 *  - skipped (코드): basis 가 none 이거나 refs 가 장부에 없어 판정하지 않습니다. 근거 표시 규칙(verify.ts)이 이미 처리한 항목입니다.
 *
 * 숫자가 맞는지는 보지 않습니다 (verify.ts 의 몫). 장부에 없는 지식으로 판정하지 않습니다.
 * 인과 주장("A 때문에 B")은 장부에 A 와 B 가 둘 다 있고 방향이 맞으면 supported 로 봅니다. 데이터만으로 인과를 증명할 수는 없지만,
 * 인과 자체의 증명을 요구하면 데이터 근거의 원인은 모두 unsupported 가 되어 뉴스 제목만 남습니다. README "원인 후보마다 찬반 증거" 와 같은 기준이고,
 * 억지 원인은 결과 쪽 데이터만 있을 때(unsupported) · 방향이 반대일 때(contradicted) · 제목이 말하지 않을 때(unsupported) 로 잡습니다.
 * (Codex 리뷰 11/03 이 더 엄격히 하자고 했지만 이 이유로 유지. 보정 세트가 커지면 다시 봅니다.)
 * 지금은 평가(scripts/eval.ts)에서만 돌리고, 보정 세트(scripts/judge/pairs.json, `pnpm judge`)로 정확도를 잽니다.
 * 실행 중(muffin.ts)에 켜는 것은 보정 뒤이고, 그때 verification.why.unsupported 를 채웁니다 (README "근거 판정").
 */
import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { instructionsFor } from "./instructions";
import { CALL_TIMEOUT_MS, SMALL_MODEL, retryTimeoutOnce } from "./models";
import { areaTools } from "./plan";
import type { Evidence, WriterOutput } from "./schema";

export const judgeVerdicts = ["supported", "unsupported", "contradicted"] as const;
export type JudgeVerdict = (typeof judgeVerdicts)[number];

/** 모델 출력. index 는 입력의 [원인 목록] 번호(1부터)입니다. */
export const judgeSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().describe("[원인 목록] 의 번호 (1부터)"),
      // reason 을 verdict 보다 먼저 두어 근거를 적은 뒤 결론을 내리게 합니다 (11/5 보정: 반대라고 써 놓고 supported 라 답하는 일이 잦았음)
      reason: z.string().describe("한 문장. 어느 장부 항목(id)의 무엇이 근거인지. 이 문장의 결론이 verdict 와 같아야 함"),
      verdict: z.enum(judgeVerdicts),
    }),
  ),
});
export type JudgeOutput = z.infer<typeof judgeSchema>;

export const judgeRules = `[역할: 근거 판정]
당신은 데이터를 새로 가져오지 않고 숫자를 다시 계산하지 않습니다. 아래 [원인 목록] 의 항목마다, 그 항목 아래 적힌 [장부 항목] 만 보고
주장(claim)이 뒷받침되는지 판정합니다. 다른 항목 아래의 장부 항목은 그 항목의 근거가 아닙니다.
항목의 evidence 는 작성 단계가 적은 설명일 뿐 사실이 아닙니다. 판정은 장부 항목의 값과 제목으로 합니다.
장부 항목에 "방향(코드)" 줄이 있으면 코드가 값으로 계산한 것이니 그 방향을 그대로 씁니다.

- supported: 인용한 장부 항목의 값이나 기사 제목이 주장의 내용과 방향을 직접 뒷받침합니다.
  예: "미국 정책금리가 한국 기준금리보다 높다" 에 미국 3.88% · 한국 3.00% / "환율이 올랐다" 에 changePct 가 양수.
- contradicted: 인용한 장부 항목이 주장과 반대이거나 맞지 않습니다.
  예: "금리 차이가 벌어졌다" 인데 changePp 가 0 / "환율이 올랐다" 인데 changePct 가 음수 / 기사 제목이 반대 방향을 말함 / "인상했다" 인데 제목은 "동결".
- unsupported: 인용한 장부 항목만으로는 알 수 없습니다.
  예: 주장은 "외국인 매도 때문" 인데 장부엔 환율 값만 있음 / 기사 제목이 관련은 있지만 주장까지는 하지 않음 / 교과서 같은 일반 설명 / 전망을 사실처럼 씀.
- contradicted 와 unsupported 의 경계: 장부에 그 주장을 판단할 값이 있는데 주장과 다르면(변화가 0 인데 "벌어졌다", 지수가 올랐는데 "내렸다") contradicted 입니다.
  unsupported 는 장부에 그 주장을 판단할 값 자체가 없을 때만입니다.
- 장부에 없는 지식으로 판정하지 않습니다. 세상에서 맞는 말이어도 인용한 장부 항목이 보여 주지 않으면 unsupported 입니다.
- 숫자가 정확히 맞는지는 보지 않습니다 (검증기가 봅니다). 숫자가 조금 달라도 내용과 방향이 맞으면 supported 입니다.
- 방향은 장부의 부호와 단위로 봅니다. 원화 환율(unit 이 KRW per 1 USD · KRW per 100 JPY 처럼 "외화 한 단위를 사는 데 드는 원화")은
  값이 오르면 그 외화 강세 · 원화 약세, 내리면 그 외화 약세 · 원화 강세입니다. 어느 통화든 같습니다.
  예: JPY(100)/KRW 가 912.4 → 905.1 로 내렸으면(changePct -0.8) 엔화 약세 · 원화 강세이고, "엔화 강세" 는 contradicted 입니다.
- 높다 · 낮다 · 더 올랐다 · 덜 떨어졌다는 부호를 포함한 수의 크기로 봅니다. -3.61% 는 -4.37% 보다 높은(덜 떨어진) 수익률이라
  "ETF(-3.61%) 수익률이 지수(-4.37%)보다 낮았다" 는 contradicted 입니다.
  물가상승률이 낮아진 것(둔화)은 물가가 내린 것이 아닙니다.
- 뉴스 항목은 제목만 장부에 있습니다. 제목이 주장을 직접 말하면 supported, 관련은 있지만 주장까지는 안 하면 unsupported 입니다.
  "기사에 따르면 …" · "보도됐다" 처럼 보도 사실을 옮긴 주장은 제목이 그 내용을 담고 있으면 supported 입니다.
  제목이 "전망" · "예상" · "목표" 로 말한 미래의 값이나 방향을, 주장이 "…까지 내린다" · "…가 된다" 처럼 확정된 사실로 쓰면 unsupported 입니다.
  제목이 그 숫자와 시점을 똑같이 말해도 전망은 사실이 아니므로 supported 가 아닙니다. "A 가 …으로 전망했다고 보도됐다" 처럼 전망 주체를 밝혀 옮긴 주장만 supported 입니다.
- 인과(때문에 · 영향으로 · 배경으로)를 주장하면: 장부에 원인 쪽 데이터와 결과 쪽 데이터가 둘 다 있고 방향이 맞거나, 기사 제목이 그 인과를 말하면 supported.
  결과 쪽 데이터만 있으면 unsupported 입니다. "A 인 상태에서 B 가 일어났다" 처럼 같이 일어난 사실만 말하면 둘 다 장부에 있을 때 supported 입니다.
- 장부 항목에 "크기 비교(코드)" · "값 비교(코드)" 줄이 있으면 코드가 부호까지 보고 계산한 것이니 그 결과를 그대로 씁니다. 음수끼리의 크기를 직접 재지 않습니다.
- 주장이 둘 이상의 사실을 담으면 모두 장부에 있어야 supported 입니다. 하나라도 장부에 없으면 unsupported, 하나라도 장부와 반대면 contradicted 입니다.
  예: "관세정책과 AI 산업 불확실성이 다뤄졌다" 인데 제목에 관세정책만 있으면 unsupported.
- 주장이 "…는 확인되지 않았다" · "…까지는 말하지 않는다" · "단정할 수는 없다" 처럼 스스로 한계를 밝힌 부분은 판정에서 뺍니다. 단정한 부분만 봅니다.
  예: "제목은 농산물 대책을 다루지만 물가 원인은 설명하지 않는다" 는 제목이 농산물 대책이면 supported 입니다.
- "양립한다" · "모순되지 않는다" 는 뒷받침이 아닙니다. 원인(수출 달러 유입 · 외국인 매도 …)을 장부가 말하지 않으면, 결과 방향이 맞아도 unsupported 입니다.
- 교과서 같은 일반 법칙("금리가 오르면 통화가 강세다")은 장부 값이 그 방향이어도 unsupported 입니다. 장부는 사례 하나일 뿐 법칙을 보여 주지 않습니다.
- 물가: 지수 값이 올랐거나 yoy 가 양수면 물가는 오른 것입니다. 상승률이 낮아진 것(둔화)은 "물가가 내렸다" 의 근거가 아니라 반대 근거라 contradicted 입니다.
- 제목이 주장과 반대 상태를 말하면 contradicted 입니다 (변동성이 커졌다 ↔ 안정됐다, 위험하다 ↔ 안전하다, 미부과 ↔ 부과, 하락 ↔ 상승).
- reason 은 한 문장으로, 근거가 된 장부 항목의 id 와 값(또는 제목의 핵심 구절)을 듭니다. reason 을 먼저 쓰고 그 결론을 verdict 로 옮깁니다.
  reason 이 "맞지 않다 · 반대다 · 뒷받침되지 않는다" 로 끝나면 verdict 는 supported 일 수 없습니다.
- [원인 목록] 의 항목마다 하나씩, 번호 순서대로 모두 답합니다. 없는 번호를 만들지 않습니다.`;

export function judgeInstructions(): string {
  return instructionsFor(judgeRules);
}

/** 분류 · 정제와 같은 작은 모델. 실행 중에 켜면 검증 단계 안에서 한 번 더 부르는 셈이라 시간 제한 · 재시도를 같이 둡니다. */
export function createJudgeAgent() {
  return new Agent<unknown, typeof judgeSchema>({
    name: "Muffin Judge",
    // 판정은 채점자라 분류 · 정제의 OPENAI_MODEL_SMALL 을 따르지 않습니다. 모델 비교(--small-model)에서 채점자까지 바뀌면 차이를 리포트 품질로 읽을 수 없어서입니다.
    model: process.env.OPENAI_MODEL_JUDGE || SMALL_MODEL,
    instructions: judgeInstructions(),
    outputType: judgeSchema,
    modelSettings: { timeoutMs: CALL_TIMEOUT_MS, retry: { maxRetries: 1, policy: retryTimeoutOnce } },
  });
}

type Why = WriterOutput["why"][number];

/** 판정에 보내는 항목. index 는 why 배열의 위치(0부터), 입력에는 index + 1 로 적습니다. */
export type JudgeItem = { index: number; why: Why; refs: string[] };

/**
 * why 하나의 판정. skipped 는 판정 대상이 아닌 것(basis none · 장부에 없는 refs), missing 은 판정 대상인데 모델이 답하지 않은 것입니다.
 * 둘을 나누는 이유: missing 이 많으면 모델 출력이 불완전한 것이라 평가가 따로 보여 줘야 합니다.
 */
export type JudgeResult = { index: number; verdict: JudgeVerdict | "skipped" | "missing"; reason: string };

/** 판정할 항목: basis 가 none 이 아니고 refs 중 장부에 있는 것이 하나라도 있는 why. refs 는 장부에 있는 것만 남깁니다. */
export function judgeable(why: WriterOutput["why"], evidence: Evidence[]): JudgeItem[] {
  const ids = new Set(evidence.map((e) => e.id));
  return why.flatMap((w, index) => {
    if (w.basis === "none") return [];
    const refs = w.refs.filter((r) => ids.has(r));
    return refs.length ? [{ index, why: w, refs }] : [];
  });
}

/**
 * 환율 결과의 방향을 코드가 적어 줍니다. 모델은 "100엔당 원화가 내리면 엔화 강세" 처럼 외화 단위 환율의 방향을 거꾸로 읽는 일이 있어서
 * (보정 세트 11/03), 값이 있는 환율 항목에는 "외화 한 단위를 사는 데 드는 원화가 늘었나 줄었나" 를 그대로 써 줍니다.
 */
export function directionHint(e: Evidence): string | undefined {
  if (e.tool !== areaTools.fx) return undefined;
  const pair = String(e.values.pair ?? "");
  const from = Number(e.values["comparison.rate"]);
  const to = Number(e.values.rate);
  if (!pair || !(from > 0) || !(to > 0)) return undefined;
  const currency = pair.split("/")[0]!.replace(/\(\d+\)/, "");
  const amount = /\((\d+)\)/.exec(pair)?.[1] ?? "1";
  if (to === from) return `${amount} ${currency} 를 사는 데 드는 원화가 ${from} 그대로 (변화 없음)`;
  const up = to > from;
  return `${amount} ${currency} 를 사는 데 드는 원화가 ${from} → ${to} 로 ${up ? "늘어남" : "줄어듦"} = ${currency} ${up ? "강세" : "약세"} · 원화 ${up ? "약세" : "강세"}`;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const higher = (a: number, b: number) => (a > b ? "높음" : a < b ? "낮음" : "같음");

/**
 * 한 항목 안의 값 비교를 코드가 적어 줍니다. 모델은 음수끼리의 크기(-3.61 > -4.37)와 "둔화 ≠ 하락" 을 자주 틀립니다 (보정 세트 11/5).
 *  - 수준 vs 비교 시점 (rate · comparisonRate): 올랐음 · 내렸음
 *  - ETF 수익률 vs 지수 수익률 (period.returnPct · period.indexReturnPct): 어느 쪽이 높은지 (덜 떨어진 쪽이 높음)
 *  - 종가 vs NAV (latest.close · latest.nav): 괴리율 부호
 *  - 지수 값 · 상승률 (latest.value · previousMonth.value · yoy): 물가는 올랐는지, 상승률은 둔화인지
 */
export function valueHints(e: Evidence): string[] {
  const v = e.values;
  const out: string[] = [];
  const rate = num(v.rate);
  const prev = num(v.comparisonRate ?? v["comparison.rate"]);
  if (e.tool !== areaTools.fx && rate !== undefined && prev !== undefined) out.push(`rate ${prev} → ${rate}: ${rate > prev ? "올랐음" : rate < prev ? "내렸음" : "변화 없음"}`);
  const r = num(v["period.returnPct"]);
  const i = num(v["period.indexReturnPct"]);
  if (r !== undefined && i !== undefined) out.push(`ETF 수익률 ${r} 은 지수 수익률 ${i} 보다 ${higher(r, i)}${r < 0 && i < 0 ? (r > i ? " (덜 떨어짐)" : r < i ? " (더 떨어짐)" : "") : ""}`);
  const close = num(v["latest.close"]);
  const nav = num(v["latest.nav"]);
  if (close !== undefined && nav !== undefined) out.push(`종가 ${close} 는 NAV ${nav} 보다 ${higher(close, nav)} → 괴리율 ${close > nav ? "양수" : close < nav ? "음수" : "0"}`);
  // 물가 · 고용 지표 (get_macro_indicators 의 실제 키 latest.previousMonth.value · latest.previousYear.change, 씨앗 쌍의 previousMonth.value · latest.yoy 도 받음)
  const latest = num(v["latest.value"]);
  const before = num(v["latest.previousMonth.value"] ?? v["previousMonth.value"]);
  const mom = num(v["latest.previousMonth.change"]);
  const yoy = num(v["latest.previousYear.change"] ?? v["latest.yoy"]);
  const prevYoy = num(v["previousMonth.yoy"]);
  if (latest !== undefined && before !== undefined) out.push(`지수 ${before} → ${latest}: ${latest > before ? "올랐음" : latest < before ? "내렸음" : "같음"}${mom !== undefined ? ` (전월 대비 ${mom > 0 ? "+" : ""}${mom}%)` : ""}`);
  if (yoy !== undefined) out.push(`전년 대비 ${yoy}%: ${yoy > 0 ? "전년보다 올랐음(물가 상승)" : yoy < 0 ? "전년보다 내렸음" : "같음"}${prevYoy !== undefined ? ` · 상승률은 ${prevYoy} → ${yoy} 로 ${yoy < prevYoy ? "둔화(물가가 내린 것은 아님)" : yoy > prevYoy ? "가속" : "같음"}` : ""}`);
  return out;
}

/**
 * 여러 항목이 같은 숫자 키를 가질 때 크기 비교를 코드가 적어 줍니다 (예: 두 ETF 의 period.returnPct).
 * 견줄 수 있는 것끼리만: 같은 tool, 단위(unit)가 둘 다 있으면 같아야 하고, 통화쌍(pair)이나 지표(indicator)가 둘 다 있으면 같아야 합니다
 * (환율의 rate 1,341 과 금리의 rate 3.88 을 나란히 두지 않게). 같은 값은 "=" 로 적고 "가장 높음" 을 붙이지 않습니다.
 */
export function comparisonHints(ledger: Evidence[]): string[] {
  if (ledger.length < 2) return [];
  const comparable = (a: Evidence, b: Evidence) => {
    if (a.tool !== b.tool) return false;
    for (const key of ["unit", "pair", "indicator"]) {
      const x = a.values[key];
      const y = b.values[key];
      if (x !== undefined && y !== undefined && x !== y) return false;
    }
    return true;
  };
  const groups: Evidence[][] = [];
  for (const e of ledger) {
    const g = groups.find((xs) => xs.every((x) => comparable(x, e)));
    if (g) g.push(e);
    else groups.push([e]);
  }
  const out: string[] = [];
  for (const group of groups.filter((g) => g.length >= 2)) {
    const keys = new Map<string, { id: string; value: number }[]>();
    for (const e of group) {
      for (const [k, raw] of Object.entries(e.values)) {
        const value = num(raw);
        if (value === undefined || /date|month|days/i.test(k)) continue;
        keys.set(k, [...(keys.get(k) ?? []), { id: e.id, value }]);
      }
    }
    for (const [k, xs] of keys) {
      if (xs.length < 2) continue;
      const sorted = [...xs].sort((a, b) => b.value - a.value);
      const parts = sorted.map((x, i) => (i === 0 ? `${x.id} ${x.value}` : `${x.value === sorted[i - 1]!.value ? "=" : ">"} ${x.id} ${x.value}`));
      const top = sorted.filter((x) => x.value === sorted[0]!.value);
      out.push(`${k}: ${parts.join(" ")} (${top.length > 1 ? `${top.map((x) => x.id).join(" · ")} 같음` : `${sorted[0]!.id} 이 가장 높음`})`);
    }
  }
  return out;
}

function ledgerLine(e: Evidence, indent = ""): string {
  const lines = [`${indent}- ${e.id} · ${e.label} · 기준일 ${e.source.asOf}`, `${indent}  values: ${JSON.stringify(e.values)}`];
  const direction = directionHint(e);
  if (direction) lines.push(`${indent}  방향(코드): ${direction}`);
  for (const hint of valueHints(e)) lines.push(`${indent}  값 비교(코드): ${hint}`);
  if (e.note) lines.push(`${indent}  note: ${e.note}`);
  if (e.lineage) lines.push(`${indent}  계산: ${e.lineage.op} ← ${e.lineage.inputs.join(", ")}`);
  return lines.join("\n");
}

/**
 * 모델이 받는 입력: 번호가 붙은 [원인 목록]. 항목마다 그 항목이 인용한 [장부 항목] 만 바로 아래에 둡니다
 * (다른 항목의 근거로 판정하지 않게). 장부 표기는 작성 입력(write.ts 의 writerInput)과 같습니다.
 */
export function judgeInput(items: JudgeItem[], evidence: Evidence[]): string {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const list = items.map((i) => {
    const ledger = i.refs.map((r) => byId.get(r)).filter((e): e is Evidence => e !== undefined);
    return [
      `${i.index + 1}. claim: ${i.why.claim}`,
      `   evidence(작성의 설명): ${i.why.evidence}`,
      `   basis: ${i.why.basis} · refs: ${i.refs.join(", ")}`,
      `   [장부 항목] 이 항목이 인용한 증거입니다. 이것만 보고 판정합니다.`,
      ...ledger.map((e) => ledgerLine(e, "   ")),
      ...comparisonHints(ledger).map((h) => `   크기 비교(코드): ${h}`),
    ].join("\n");
  });
  return `[원인 목록] 작성 단계가 쓴 원인입니다. 항목마다 claim 이 그 항목 아래의 장부 항목으로 뒷받침되는지 판정합니다.\n\n${list.join("\n\n")}`;
}

/** 모델 출력을 why 배열에 맞춥니다. 판정 대상이 아닌 항목은 skipped, 모델이 빠뜨린 항목은 missing 입니다. 없는 번호는 버립니다. */
export function alignVerdicts(output: JudgeOutput, items: JudgeItem[], count: number): JudgeResult[] {
  const byIndex = new Map(items.map((i) => [i.index, i]));
  const given = new Map<number, JudgeOutput["verdicts"][number]>();
  for (const v of output.verdicts) {
    const index = v.index - 1;
    if (byIndex.has(index) && !given.has(index)) given.set(index, v);
  }
  return Array.from({ length: count }, (_, index) => {
    if (!byIndex.has(index)) return { index, verdict: "skipped", reason: "근거 없음(none)이거나 refs 가 장부에 없어 판정하지 않음" };
    const v = given.get(index);
    return v ? { index, verdict: v.verdict, reason: v.reason } : { index, verdict: "missing", reason: "모델이 이 항목을 답하지 않음" };
  });
}

/**
 * why 전부를 한 번의 호출로 판정합니다. 판정할 항목이 없으면 모델을 부르지 않고 모두 skipped,
 * 모델이 실패하면(출력 없음 · 예외) null 입니다. 부르는 쪽(평가)이 "판정 못 함" 으로 표시합니다.
 */
export async function judgeWhy(
  why: WriterOutput["why"],
  evidence: Evidence[],
  agent: ReturnType<typeof createJudgeAgent> = createJudgeAgent(),
): Promise<JudgeResult[] | null> {
  const items = judgeable(why, evidence);
  if (items.length === 0) return alignVerdicts({ verdicts: [] }, items, why.length);
  try {
    const result = await run(agent, judgeInput(items, evidence));
    if (!result.finalOutput) return null;
    return alignVerdicts(result.finalOutput, items, why.length);
  } catch {
    return null;
  }
}

export type JudgeSummary = Record<JudgeVerdict | "skipped" | "missing", number>;

export function summarizeJudge(results: JudgeResult[]): JudgeSummary {
  const out: JudgeSummary = { supported: 0, unsupported: 0, contradicted: 0, skipped: 0, missing: 0 };
  for (const r of results) out[r.verdict] += 1;
  return out;
}

/** 평가 표 · 리포트에 쓰는 짧은 표기. ✓ supported · ✗ unsupported · ⚡ contradicted · ? missing(모델이 답하지 않음) */
export const verdictMark: Record<JudgeVerdict | "skipped" | "missing", string> = { supported: "✓", unsupported: "✗", contradicted: "⚡", skipped: "-", missing: "?" };
