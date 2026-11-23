import type { Area, Depth } from "@/src/agent/schema";
import type { ReportRequest } from "@/src/lib/api";

const areaNames: Record<Area, string> = { fx: "환율", etf: "ETF", news: "경제뉴스", rate: "금리", macro: "물가" };

const ALL_AREAS = Object.keys(areaNames) as Area[];

/**
 * Empty selection means Auto; removing the last explicit area returns to Auto.
 * 다섯 영역을 모두 고르면 Auto 와 같아서 Auto 로 돌립니다 (11/20 외부 1번: "전부 고르면 Auto 와 뭐가 다르지?").
 */
export function toggleHomeArea(selected: readonly Area[], area: Area): Area[] {
  const next = selected.includes(area) ? selected.filter(value => value !== area) : [...selected, area];
  return new Set(next).size >= ALL_AREAS.length ? [] : next;
}

/** 관심 영역 아래 안내. 고른 수에 따라 무엇이 달라지는지 알려 줍니다 */
export function areaHint(selected: readonly Area[], allPicked: boolean): string {
  if (allPicked) return "다섯 영역을 모두 고르면 Auto 머핀과 같아서 Auto 로 바꿨어요. 머핀이 질문을 보고 알맞은 영역을 골라요.";
  if (selected.length === 0) return "Auto 머핀은 질문을 보고 알맞은 영역의 자료를 골라요.";
  if (selected.length === 1) return `${areaNames[selected[0]!]} 자료를 중심으로 리포트를 만들어요.`;
  return `${selected.map(value => areaNames[value]).join(" · ")} 자료를 함께 살펴보고 질문에 맞는 것을 골라 써요.`;
}

/** Keep the existing single-area API. Multi-area context is explicitly part of the question. */
export function buildHomeInput(question: string, depth: Depth, selected: readonly Area[]): ReportRequest {
  const unique = [...new Set(selected)];
  const text = question.trim();
  if (unique.length > 1) return { question: `관심 영역: ${unique.map(value => areaNames[value]).join(", ")}\n\n${text}`, depth };
  return { question: text, depth, ...(unique.length === 1 ? { area: unique[0] } : {}) };
}

/** 질문 최대 길이. 서버도 같은 값으로 막습니다 */
export const QUESTION_MAX = 500;
/** 질문에 쓸 수 있는 글자 수. 영역을 둘 이상 고르면 머리말이 함께 가므로 그만큼 줄어듭니다 (11/21 QA-09: 제출한 뒤에야 줄이라고 나옴) */
export function questionAllowance(selected: readonly Area[]): number {
  return QUESTION_MAX - buildHomeInput("", "easy", selected).question.length;
}

/** 질문 앞에 붙은 "관심 영역: 환율, ETF" 머리말을 떼어 냅니다 (11/20 외부 G1 · 하니 2). 화면 표시용이고 API · 저장 형식은 그대로입니다. */
export function splitAreaPrefix(question: string): { areas: string[]; question: string } {
  const match = /^관심 영역: ([^\r\n]+)\r?\n\r?\n/.exec(question);
  if (!match) return { areas: [], question };
  const names = [...new Set(match[1].split(", "))];
  const known = new Set(Object.values(areaNames));
  if (names.length < 2 || !names.every(name => known.has(name))) return { areas: [], question };
  return { areas: names, question: question.slice(match[0].length) };
}

/** 기존 다중 선택 기록의 질문 접두어를 읽습니다. API·저장 형식은 변경하지 않습니다. */
export function homeAreaLabel(input: Pick<ReportRequest, "area" | "question">): string {
  if (input.area) return areaNames[input.area];
  const { areas } = splitAreaPrefix(input.question);
  return areas.length > 0 ? areas.join(" · ") : "Auto 머핀";
}
