/**
 * 정제가 "이 질문의 근거로 쓰지 않는다" 고 뺀 장부 항목을 작성에게 알려 줍니다 (리더, 11/13).
 * 작성은 [사실 목록] 과 그 사실이 인용한 장부만 보므로(write.ts writerInput), 조회에 성공한 자료도 정제가 빼면 "자료 없음 · 확인하지 못함" 으로 적히곤 했습니다
 * (11/13 소희 분석: 90일 환율 질문에서 금리를 수집했지만 정제가 원인 근거에서 제외 → dataGaps 에 금리 자료 부족).
 * 값은 보여 주지 않습니다. 정제가 쓰지 않기로 한 숫자를 작성이 끌어 쓰지 않게 이름 · 기준일 · 뺀 이유만 줍니다.
 * 입력 조립 순서(muffin.ts)에서 writerInput 다음, 움직임 메모 앞에 붙습니다. 작성 지시문(write.ts) 자체는 바꾸지 않습니다.
 */
import type { Evidence, FactsOutput } from "./schema";

export const DROPPED_HEADING = "[수집했지만 근거로 쓰지 않은 자료]";

export function droppedNote(facts: FactsOutput | null | undefined, evidence: Evidence[]): string {
  if (!facts || facts.dropped.length === 0) return "";
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const d of facts.dropped) {
    const e = byId.get(d.ref);
    if (!e || seen.has(e.id)) continue; // 장부에 없는 번호(지어낸 id)는 자료가 아니므로 적지 않습니다
    seen.add(e.id);
    const reason = d.reason.trim();
    lines.push(`- ${e.id} · ${e.label} · 기준일 ${e.source.asOf || "미제공"}${reason ? ` · 뺀 이유: ${reason}` : ""}`);
  }
  if (lines.length === 0) return "";
  return [
    `${DROPPED_HEADING} 조사가 받아 왔지만 정제가 이 질문의 근거로 고르지 않은 장부 항목입니다.`,
    '- 이 자료를 "없다" · "확인하지 못했다" 고 쓰지 않습니다. dataGaps 에 넣지 않습니다.',
    '- 숫자는 인용하지 않습니다 (위 [증거 장부] 에 없는 항목). 필요하면 caveats 에 "…는 확인했지만 이번 질문의 근거로 쓰지 않았습니다" 처럼 한 줄만 씁니다.',
    ...lines,
  ].join("\n");
}
