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
      verdict: z.enum(judgeVerdicts),
      reason: z.string().describe("한 문장. 어느 장부 항목(id)의 무엇이 근거인지"),
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
- reason 은 한 문장으로, 근거가 된 장부 항목의 id 와 값(또는 제목의 핵심 구절)을 듭니다.
- [원인 목록] 의 항목마다 하나씩, 번호 순서대로 모두 답합니다. 없는 번호를 만들지 않습니다.`;

export function judgeInstructions(): string {
  return instructionsFor(judgeRules);
}

/** 분류 · 정제와 같은 작은 모델. 실행 중에 켜면 검증 단계 안에서 한 번 더 부르는 셈이라 시간 제한 · 재시도를 같이 둡니다. */
export function createJudgeAgent() {
  return new Agent<unknown, typeof judgeSchema>({
    name: "Muffin Judge",
    model: process.env.OPENAI_MODEL_SMALL || SMALL_MODEL,
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

function ledgerLine(e: Evidence, indent = ""): string {
  const lines = [`${indent}- ${e.id} · ${e.label} · 기준일 ${e.source.asOf}`, `${indent}  values: ${JSON.stringify(e.values)}`];
  const direction = directionHint(e);
  if (direction) lines.push(`${indent}  방향(코드): ${direction}`);
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
