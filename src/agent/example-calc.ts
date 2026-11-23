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
/** 가정이나 계산을 묻는 말. "오르면 · 된다면 · 얼마나 오른 거야" 처럼 숫자 쌍을 예시로 쓴 질문입니다 */
const HYPOTHETICAL = /예시|가정|가령|만약|예를\s*들어|헷갈|오르면|내리면|되면|된다면|한다면|라면|바뀌면|변하면|가면|떨어지면|올리면|내린다면|오른다면|얼마나\s*(오른|내린|변한|바뀐|차이)|몇\s*(%|퍼센트|프로|배)|차이가\s*얼마/;
/** 실제로 일어난 변화를 서술하며 원인 · 배경을 묻는 말. 이런 질문의 숫자는 예시가 아닙니다 ("3%에서 4%로 올랐는데 왜 올랐어?") */
const ACTUAL = /왜|이유|원인|배경|때문|올랐는데|내렸는데|됐는데|바뀌었는데|올랐어|내렸어|올랐다|내렸다|인상했|인하했/;

/** 예시라고 밝힌 질문. "3%에서 4%가 됐다는 예시" 처럼 과거형으로 써도 실제 사건이 아닙니다 (11/22 QA) */
const EXPLICIT_EXAMPLE = /예시|가정|가령|만약|예를\s*들어/;

export function exampleIn(question: string): Example | null {
  if (!HYPOTHETICAL.test(question) || (ACTUAL.test(question) && !EXPLICIT_EXAMPLE.test(question))) return null;
  // 날짜("10월 21일에서 11월 20일로")와 기간은 값이 아닙니다
  const cleaned = question.replace(/\d+\s*(년|월|일|개월|주|시|분)(?![가-힣])/g, " ");
  const m = PAIR.exec(cleaned);
  if (!m) return null;
  // 음수("-1%에서 2%로")는 다루지 않습니다. 부호를 버리고 양수로 계산하면 틀린 답이 검증까지 통과합니다 (#135 Codex 리뷰)
  if (/[-−–]\s*$|마이너스\s*$/.test(cleaned.slice(0, m.index)) || /(?:에서|→|->|~)\s*(?:[-−–]|마이너스)/.test(m[0])) return null;
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
  // 질문이 "1% 오른 거야?" 처럼 스스로 말한 % 는 바로잡을 때 인용하므로 장부에 둡니다 (없으면 그 숫자가 검증에서 빠짐)
  const asked = /(\d+(?:\.\d+)?)\s*%\s*(?:오른|올랐|올라|내린|내렸|상승|하락|증가|감소|높|낮)/.exec(question.replace(PAIR, " "));
  const values: Evidence["values"] = ex.unit === "%"
    ? { kind: "가상 예시", fromPct: ex.from, toPct: ex.to, diffPp: diff, relativePct, ...(asked ? { askedPct: Number(asked[1]) } : {}) }
    // 금액의 차이는 검증기가 변화량(원 · 달러)으로 읽는 키 이름(change · changePct)으로 둡니다. diff 는 %p 로 읽혀 "+100원" 카드가 검증에서 빠집니다 (#135 Codex 리뷰)
    : { kind: "가상 예시", currency: ex.unit, amountFrom: ex.from, amountTo: ex.to, change: diff, changePct: relativePct };
  const entry: Evidence = {
    id: ctx.nextCalcId(),
    tool: EXAMPLE_TOOL,
    label: "가상 예시 계산 · 질문에 적힌 두 값",
    values,
    source: { name: "질문에 적힌 숫자로 계산", url: "", asOf: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()) },
    note: `질문에 적힌 ${ex.from}${ex.unit} 와 ${ex.to}${ex.unit} 로 계산한 값이에요. 실제 시장 값이 아니에요. 차이 = ${ex.to} − ${ex.from}, 비율 변화 = (${ex.to} ÷ ${ex.from} − 1) × 100.`,
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
  const from = pct ? `${v.fromPct}%` : `${Number(v.amountFrom).toLocaleString("ko-KR")}${v.currency}`;
  const to = pct ? `${v.toPct}%` : `${Number(v.amountTo).toLocaleString("ko-KR")}${v.currency}`;
  const diff = pct ? `${signed(Number(v.diffPp))}%p` : `${signed(Number(v.change))}${v.currency}`;
  const relative = Number(pct ? v.relativePct : v.changePct);
  return [
    `[가상 예시 계산] 질문에 적힌 ${from} 와 ${to} 는 실제 값이 아니라 예시입니다. 코드가 계산한 값입니다 (ref ${e.id}).`,
    `- 차이: ${diff}`,
    `- 비율로 본 변화: ${signed(relative)}% (${from} 를 100 으로 봤을 때)`,
    `요약의 첫 문장은 이 두 값으로 답합니다 (예: "${from}에서 ${to}가 되면 ${diff}${pct ? ", 비율로는 " + signed(relative) + "%" : ""} …"). 가상의 예시라는 점을 한 번 밝힙니다.`,
    pct ? `%p(퍼센트포인트)는 두 비율의 차이이고 % 는 원래 값에 대한 비율이라 서로 다르다는 것을 한 문장으로 설명합니다.` : `차이와 비율 변화가 무엇을 뜻하는지 한 문장으로 설명합니다.`,
    v.askedPct !== undefined ? `질문은 "${v.askedPct}% 오른 것" 인지 물었습니다. 첫 문장에서 바로잡습니다: ${v.askedPct}% 가 아니라 ${v.askedPct}%p 이고, 비율로는 ${signed(relative)}% 예요.` : "",
    `실제 금리 · 환율 · 가격을 조회한 값으로 바꿔 답하지 않습니다. 실제 값이 장부에 있더라도 예시 계산과 섞지 않고, 필요하면 "참고로 실제 값은" 으로 따로 씁니다. "자료가 없어 답할 수 없다" 고 쓰지 않습니다.`,
  ].filter(Boolean).join("\n");
}

/** 예시 계산의 숫자 카드를 맨 앞에 넣습니다 (작성이 같은 항목으로 쓴 카드는 뺌) */
export function withExampleNumbers(output: WriterOutput, e: Evidence): WriterOutput {
  const v = e.values;
  const pct = v.fromPct !== undefined;
  const asOf = e.source.asOf;
  const cards: WriterOutput["numbers"] = [
    { label: "차이 (가상 예시)", value: pct ? `${signed(Number(v.diffPp))}%p` : `${signed(Number(v.change))}${v.currency}`, change: "", asOf, ref: e.id },
    { label: "비율로 본 변화 (가상 예시)", value: `${signed(Number(pct ? v.relativePct : v.changePct))}%`, change: "", asOf, ref: e.id },
  ];
  return { ...output, numbers: [...cards, ...output.numbers.filter((n) => n.ref !== e.id)] };
}
