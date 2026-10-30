/**
 * 🧮 계산 tool (calc_metrics). 리더 관리. ✂️ 정제 Agent 만 씁니다.
 *
 * 모델은 산술을 하지 않습니다. 차이 · 변동률이 필요하면 장부의 두 값(E 번호 + 값 키)을 가리켜 이 tool 을 부르고,
 * 결과는 C1, C2 … 로 장부에 올라갑니다. lineage 에 어느 E 번호로 계산했는지 남아 "원본 보기" 가 계보를 보여 주고,
 * 검증은 C 번호를 인용한 숫자를 derived(계산값)로 표시합니다.
 *
 *  - 값은 장부에서만 읽습니다. 모델이 숫자를 직접 넘길 수 없고, 없는 id · 키면 실패합니다 (추측 금지).
 *  - 장부 values 의 키 이름은 검증기의 단위 규칙에 맞춥니다: changePct(%) · change(입력 단위) · changePp(%p).
 *  - 출처 url 이 없으므로 리포트 sources 에는 들어가지 않고 evidence 에만 남습니다.
 * 사용법은 같은 폴더의 README.md.
 */
import { z } from "zod";
import type { ResearchContext } from "../../agent/context";
import type { Evidence } from "../../agent/schema";
import { unitOfKey } from "../../agent/verify";
import { defineTool, type EvidenceValues } from "../define";
import type { ToolResult } from "../types";
import { diff, pctChange, ppDiff } from "./metrics";

export const ops = ["pct_change", "diff", "pp_diff"] as const;
export type Op = (typeof ops)[number];

const operand = z.object({
  ref: z.string().describe("장부 항목 id. 예: E1, E3-2"),
  key: z.string().describe("그 항목 values 의 키. 예: rate, latest.close, comparisonRate"),
});

export const parameters = z.object({
  op: z
    .enum(ops)
    .describe(
      "pct_change: a → b 변동률 (%) = (b−a)/|a|×100 / diff: b−a (a · b 와 같은 단위. 원, 포인트) / pp_diff: b−a 를 %p 로 (a · b 가 모두 % 일 때)",
    ),
  a: operand.describe("기준 값 (from, 빼는 값). 예: 과거 환율, 한국 기준금리"),
  b: operand.describe("비교 값 (to). 예: 오늘 환율, 미국 정책금리"),
  label: z.string().describe("무엇을 계산했는지 짧은 이름. 예: 한미 기준금리 차이, USD/KRW 30일 변동률"),
});
export type Input = z.infer<typeof parameters>;

export type CalcData = {
  op: Op;
  label: string;
  /** 계산 결과 */
  value: number;
  /** 결과 단위. pct_change 는 %, pp_diff 는 %p, diff 는 입력의 unit (없으면 빈 문자열) */
  unit: string;
  a: { ref: string; key: string; value: number };
  b: { ref: string; key: string; value: number };
  /** 사람이 읽는 식. 예: "E3.rate 3.88 − E2.rate 3 = 0.88%p", "E1.comparison.rate 1365.1 → E1.rate 1392.4 = 1.999853%" */
  formula: string;
};

type Operand = Input["a"];

function readValue(ctx: ResearchContext, { ref, key }: Operand): { value: number; evidence: Evidence } {
  const evidence = ctx.findEvidence(ref);
  if (!evidence) throw new Error(`장부에 없는 id ${ref}. 조사가 받은 E 번호만 쓸 수 있습니다`);
  const raw = evidence.values[key];
  if (raw === undefined) throw new Error(`${ref} 에 ${key} 값이 없습니다. 있는 키: ${Object.keys(evidence.values).join(", ")}`);
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(value)) throw new Error(`${ref}.${key} 는 숫자가 아닙니다: ${String(raw)}`);
  return { value, evidence };
}

/** 장부 항목의 unit 메타 (금리 tool 의 "%", 환율의 "KRW per USD", 물가지수의 "2020=100" 등). 없으면 빈 문자열. */
function unitOf(e: Evidence): string {
  return typeof e.values.unit === "string" ? e.values.unit : "";
}

/**
 * pp_diff 에 쓸 수 있는 % 값인지. unit 메타가 있으면 그것으로 보고, 없으면(ETF 처럼 unit 을 올리지 않는 tool) 키 이름으로 봅니다.
 * returnPct · premiumPct · trackingDiffPp 는 %, close · nav · netAssets 는 아닙니다. 키 이름 규칙은 검증기(unitOfKey)와 같습니다.
 */
function isPercent(e: Evidence, key: string, unit: string): boolean {
  if (unit) return unit.includes("%");
  const kind = unitOfKey(key, e.values);
  return kind === "pct" || kind === "pp";
}

/** 오류 메시지용. 예: "E1.rate(KRW per USD) · E2.rate(%)" */
function describeUnits(a: Operand, ua: string, b: Operand, ub: string): string {
  return `${a.ref}.${a.key}(${ua || "단위 없음"}) · ${b.ref}.${b.key}(${ub || "단위 없음"})`;
}

/** 두 입력 중 더 최근 기준일. 계산 결과의 asOf 가 됩니다. */
function laterAsOf(a: Evidence, b: Evidence): string {
  return a.source.asOf > b.source.asOf ? a.source.asOf : b.source.asOf;
}

/**
 * 장부에서 두 값을 읽어 계산합니다. defineTool 이 두 번째 인자로 장부(ctx)를 넘겨 줍니다.
 * Agent 없이 테스트할 때는 ResearchContext 를 만들어 addEvidence 한 뒤 직접 부릅니다.
 */
export async function execute(input: Input, ctx?: ResearchContext): Promise<ToolResult<CalcData>> {
  if (!ctx) throw new Error("계산 도구는 장부(ResearchContext) 안에서만 쓸 수 있습니다");
  const a = readValue(ctx, input.a);
  const b = readValue(ctx, input.b);
  const [ua, ub] = [unitOf(a.evidence), unitOf(b.evidence)];
  const units = describeUnits(input.a, ua, input.b, ub);
  // 단위를 둘 다 아는데 서로 다르면(환율 − 금리, 지수 − %) 어떤 계산도 뜻이 없습니다. 한쪽을 모를 때는 막지 않습니다.
  if (ua && ub && ua !== ub) throw new Error(`단위가 다른 값은 계산하지 않습니다: ${units}`);

  let value: number;
  let unit: string;
  if (input.op === "pct_change") {
    value = pctChange(a.value, b.value);
    unit = "%";
  } else if (input.op === "pp_diff") {
    // 양쪽을 각각 봅니다. 한쪽만 % 여도 %p 차이는 뜻이 없습니다. 단위 메타가 없으면 키 이름으로 봅니다
    // (예전엔 단위를 모르면 막지 않아 ETF 종가 88,905원 − NAV 89,090.96원이 -185.96%p 로 장부에 올라갔습니다).
    if (!isPercent(a.evidence, input.a.key, ua) || !isPercent(b.evidence, input.b.key, ub)) {
      throw new Error(`pp_diff 는 % 값 사이에서만 씁니다: ${units}. diff 를 쓰세요`);
    }
    value = ppDiff(a.value, b.value);
    unit = "%p";
  } else {
    value = diff(a.value, b.value);
    unit = ua === ub ? ua : "";
  }

  // 변동률은 a → b (과거 → 현재) 순서로, 차이는 b − a 로 적습니다. 이 식이 note 를 거쳐 작성 · 원본 보기에 그대로 보입니다.
  const formula =
    input.op === "pct_change"
      ? `${input.a.ref}.${input.a.key} ${a.value} → ${input.b.ref}.${input.b.key} ${b.value} = ${value}%`
      : `${input.b.ref}.${input.b.key} ${b.value} − ${input.a.ref}.${input.a.key} ${a.value} = ${value}${unit}`;
  const inputs = [...new Set([input.a.ref, input.b.ref])];
  return {
    data: { op: input.op, label: input.label, value, unit, a: { ...input.a, value: a.value }, b: { ...input.b, value: b.value }, formula },
    // 출처 이름이 장부 라벨("계산 · 한미 기준금리 차이")이 됩니다. url 이 없어 출처 목록에는 들어가지 않습니다.
    source: { name: input.label, url: "", asOf: laterAsOf(a.evidence, b.evidence) },
    note: `${formula}. 장부 값으로 계산한 결과이며 출처 링크는 없습니다`,
    lineage: { op: input.op, inputs },
  };
}

/** 장부에 올리는 핵심 값. 키 이름이 검증기의 단위 추정과 맞아야 리포트의 "0.88%p" · "2.00%" 가 통과합니다. */
export function calcEvidence(data: CalcData): EvidenceValues {
  const base = { from: data.a.value, to: data.b.value, ...(data.unit && data.op !== "pct_change" ? { unit: data.unit } : {}) };
  if (data.op === "pct_change") return { changePct: data.value, ...base };
  if (data.op === "pp_diff") return { changePp: data.value, ...base, unit: "%" };
  return { change: data.value, ...base };
}

export const calcTool = defineTool({
  name: "calc_metrics",
  kind: "calc",
  description:
    "장부의 두 값으로 변동률(pct_change, %) · 차이(diff) · 퍼센트포인트 차이(pp_diff, %p)를 계산한다. " +
    "값은 장부 id(E 번호)와 값 키로 가리키고 숫자를 직접 넘기지 않는다. 결과는 C 번호로 장부에 남아 리포트가 인용할 수 있다. " +
    "두 값이 아닌 계산(평균 · 시계열 · z-score)은 아직 제공하지 않음.",
  parameters,
  execute,
  evidence: calcEvidence,
});
