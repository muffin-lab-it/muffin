/**
 * 질문에 적힌 가상의 숫자로 하는 계산 (리더, 11/22).
 *
 * 11/21 점검: "금리가 3%에서 4%로 오르면 얼마나 오른 거야?" 에 "장부에 확인된 수치가 없어 숫자로 답할 수 없어요" 가 나왔습니다. 조사할 자료가 없는 질문이라
 * 장부가 비고, 작성은 장부에 없는 숫자를 쓸 수 없기 때문입니다. 질문이 "A 에서 B 로" 꼴로 두 값을 주면 코드가 차이와 비율 변화를 계산해
 * 계산 항목(C 번호)으로 장부에 올리고, 작성에 [가상 예시 계산] 으로 알립니다. 실제 금리 · 환율로 바꿔 답하지 않게 합니다.
 */
import type { ResearchContext } from "./context";
import type { Evidence, WriterOutput } from "./schema";

export const EXAMPLE_TOOL = "calc_example";

export type Example = { from: number; to: number; unit: "%" | "원" | "달러" | "엔" };

const NUM = "(\\d[\\d,]*(?:\\.\\d+)?)";
const UNIT = "(%|퍼센트|프로|원|달러|엔)";
const PAIR = new RegExp(`${NUM}\\s*${UNIT}?\\s*(?:에서|→|->|~)\\s*${NUM}\\s*${UNIT}`);
const unitOf = (u: string): Example["unit"] => (u === "퍼센트" || u === "프로" ? "%" : (u as Example["unit"]));

/** 질문에 적힌 "A 에서 B 로" 의 두 값. 없거나 단위가 서로 다르거나 시작 값이 0 이면 null */
export function exampleIn(question: string): Example | null {
  // 날짜("10월 21일에서 11월 20일로")와 기간은 값이 아닙니다
  const m = PAIR.exec(question.replace(/\d+\s*(년|월|일|개월|주|시|분)(?![가-힣])/g, " "));
  if (!m) return null;
  const from = Number(m[1]!.replace(/,/g, ""));
  const to = Number(m[3]!.replace(/,/g, ""));
  const unit = unitOf(m[4]!);
  if (m[2] && unitOf(m[2]) !== unit) return null;
  if (!(from > 0) || !Number.isFinite(to) || from === to) return null;
  return { from, to, unit };
}

const round = (x: number, d = 2) => Number(x.toFixed(d));

/** 가상 예시의 계산 결과를 계산 항목으로 장부에 올립니다. 올렸으면 그 항목, 예시가 없으면 undefined */
export function addExampleCalc(ctx: ResearchContext, question: string): Evidence | undefined {
  const ex = exampleIn(question);
  if (!ex) return undefined;
  const diff = round(ex.to - ex.from, 4);
  const relativePct = round((ex.to / ex.from - 1) * 100);
  const values: Evidence["values"] = ex.unit === "%"
    ? { kind: "가상 예시", fromPct: ex.from, toPct: ex.to, diffPp: diff, relativePct }
    : { kind: "가상 예시", unit: ex.unit, from: ex.from, to: ex.to, diff, relativePct };
  const entry: Evidence = {
    id: ctx.nextCalcId(),
    tool: EXAMPLE_TOOL,
    label: "가상 예시 계산 · 질문에 적힌 두 값",
    values,
    source: { name: "질문에 적힌 숫자로 계산", url: "", asOf: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()) },
    note: `질문에 적힌 ${ex.from}${ex.unit} 와 ${ex.to}${ex.unit} 로 계산한 값입니다. 실제 시장 값이 아닙니다. 차이 = ${ex.to} − ${ex.from}, 비율 변화 = (${ex.to} ÷ ${ex.from} − 1) × 100.`,
    lineage: { op: "example", inputs: [] },
  };
  ctx.addEvidence([entry]);
  ctx.addStep({ tool: EXAMPLE_TOOL, status: "ok", ms: 0 });
  return entry;
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;

/** 작성 입력에 붙이는 [가상 예시 계산] */
export function exampleNote(e: Evidence): string {
  const v = e.values;
  const pct = v.fromPct !== undefined;
  const from = pct ? `${v.fromPct}%` : `${Number(v.from).toLocaleString("ko-KR")}${v.unit}`;
  const to = pct ? `${v.toPct}%` : `${Number(v.to).toLocaleString("ko-KR")}${v.unit}`;
  const diff = pct ? `${signed(Number(v.diffPp))}%p` : `${signed(Number(v.diff))}${v.unit}`;
  return [
    `[가상 예시 계산] 질문에 적힌 ${from} 와 ${to} 는 실제 값이 아니라 예시입니다. 코드가 계산한 값입니다 (ref ${e.id}).`,
    `- 차이: ${diff}`,
    `- 비율로 본 변화: ${signed(Number(v.relativePct))}% (${from} 를 100 으로 봤을 때)`,
    `요약의 첫 문장은 이 두 값으로 답합니다 (예: "${from}에서 ${to}가 되면 ${diff}${pct ? ", 비율로는 " + signed(Number(v.relativePct)) + "%" : ""} …"). 가상의 예시라는 점을 한 번 밝힙니다.`,
    pct ? `%p(퍼센트포인트)는 두 비율의 차이이고 % 는 원래 값에 대한 비율이라 서로 다르다는 것을 한 문장으로 설명합니다.` : `차이와 비율 변화가 무엇을 뜻하는지 한 문장으로 설명합니다.`,
    `실제 금리 · 환율 · 가격을 조회한 값으로 바꿔 답하지 않습니다. 실제 값이 장부에 있더라도 예시 계산과 섞지 않고, 필요하면 "참고로 실제 값은" 으로 따로 씁니다. "자료가 없어 답할 수 없다" 고 쓰지 않습니다.`,
  ].join("\n");
}

/** 예시 계산의 숫자 카드를 맨 앞에 넣습니다 (작성이 같은 항목으로 쓴 카드는 뺌) */
export function withExampleNumbers(output: WriterOutput, e: Evidence): WriterOutput {
  const v = e.values;
  const pct = v.fromPct !== undefined;
  const asOf = e.source.asOf;
  const cards: WriterOutput["numbers"] = [
    { label: "차이 (가상 예시)", value: pct ? `${signed(Number(v.diffPp))}%p` : `${signed(Number(v.diff))}${v.unit}`, change: "", asOf, ref: e.id },
    { label: "비율로 본 변화 (가상 예시)", value: `${signed(Number(v.relativePct))}%`, change: "", asOf, ref: e.id },
  ];
  return { ...output, numbers: [...cards, ...output.numbers.filter((n) => n.ref !== e.id)] };
}
