import type { Evidence } from "@/src/agent/schema";
export function evidenceCategory(entry: Evidence): string {
  if (/news/i.test(entry.tool)) return "뉴스";
  // 코스피 · 코스닥 · 미국 지수 tool (11/21 백엔드 #123 · #128). "기타 자료" 로 묶이던 것
  if (/stock_index|kr-index|us-index/i.test(entry.tool) || (/지수|코스피|코스닥|S&P|나스닥|다우/i.test(entry.label) && !entry.lineage && !/etf/i.test(entry.tool))) return "지수";
  if (/fx|exchange|환율/i.test(`${entry.tool} ${entry.label}`) && !entry.lineage) return "환율";
  if (/macro|cpi|inflation|물가/i.test(`${entry.tool} ${entry.label}`)) return "물가";
  if (/rate|금리/i.test(`${entry.tool} ${entry.label}`) && !entry.lineage) return "금리";
  if (/etf/i.test(entry.tool)) return "ETF";
  if (entry.lineage || /calc/i.test(entry.tool)) return "계산";
  return "기타 자료";
}
