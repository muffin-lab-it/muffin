import type { Evidence } from "@/src/agent/schema";
export function evidenceCategory(entry: Evidence): string {
  if (/news/i.test(entry.tool)) return "뉴스";
  if (/fx|exchange|환율/i.test(`${entry.tool} ${entry.label}`) && !entry.lineage) return "환율";
  if (/macro|cpi|inflation|물가/i.test(`${entry.tool} ${entry.label}`)) return "물가";
  if (/rate|금리/i.test(`${entry.tool} ${entry.label}`) && !entry.lineage) return "금리";
  if (/etf/i.test(entry.tool)) return "ETF";
  if (entry.lineage || /calc/i.test(entry.tool)) return "계산";
  return "기타 자료";
}

