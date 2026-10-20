import type { ToolStep } from "./context";
import type { Report } from "./schema";

/**
 * 스트리밍 이벤트 규격. 백엔드 팀이 /api/report 스트리밍을 구현할 때 이 모양으로 보내고,
 * 프론트 팀은 이 모양만 보고 진행상황 화면을 만듭니다. 구현 전에 양쪽이 같은 타입을 보게 하려고 먼저 고정합니다.
 *
 *  step   → tool 하나가 끝날 때마다 (진행상황 목록 한 줄)
 *  report → 리포트 완성
 *  error  → 실패. 이후 이벤트 없음
 */
export type MuffinEvent =
  | { type: "step"; step: ToolStep }
  | { type: "report"; report: Report; steps: ToolStep[]; rewrites: number }
  | { type: "error"; message: string };

/** tool 이름 → 진행상황 화면에 보여줄 한국어 라벨. tool 이 추가되면 여기에 한 줄. */
export const toolLabels: Record<string, string> = {
  get_fx_krw_rate: "환율 확인",
  get_etf_kr_price: "국내 ETF 시세 확인",
  get_korean_economic_news: "경제 뉴스 확인",
  get_macro_indicators: "물가·고용 지표 확인",
  get_rate_data: "금리 확인",
};

export function labelFor(toolName: string): string {
  return toolLabels[toolName] ?? toolName;
}
