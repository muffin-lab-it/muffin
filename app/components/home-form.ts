import type { Area, Depth } from "@/src/agent/schema";
import type { ReportRequest } from "@/src/lib/api";

const areaNames: Record<Area, string> = { fx: "환율", etf: "ETF", news: "경제뉴스", rate: "금리", macro: "물가" };

/** Empty selection means Auto; removing the last explicit area returns to Auto. */
export function toggleHomeArea(selected: readonly Area[], area: Area): Area[] {
  return selected.includes(area) ? selected.filter(value => value !== area) : [...selected, area];
}

/** Keep the existing single-area API. Multi-area context is explicitly part of the question. */
export function buildHomeInput(question: string, depth: Depth, selected: readonly Area[]): ReportRequest {
  const unique = [...new Set(selected)];
  const text = question.trim();
  if (unique.length > 1) return { question: `관심 영역: ${unique.map(value => areaNames[value]).join(", ")}\n\n${text}`, depth };
  return { question: text, depth, ...(unique.length === 1 ? { area: unique[0] } : {}) };
}

/** 기존 다중 선택 기록의 질문 접두어를 읽습니다. API·저장 형식은 변경하지 않습니다. */
export function homeAreaLabel(input: Pick<ReportRequest, "area" | "question">): string {
  if (input.area) return areaNames[input.area];
  const match = /^관심 영역: ([^\r\n]+)\r?\n\r?\n/.exec(input.question);
  if (match) {
    const names = [...new Set(match[1].split(", "))];
    const known = new Set(Object.values(areaNames));
    if (names.length >= 2 && names.every(name => known.has(name))) return names.join(" · ");
  }
  return "Auto 머핀";
}
