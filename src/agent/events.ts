import type { ToolStep } from "./context";
import type { Intent, Report, ReportMode, Verification } from "./schema";

export type Stage = "plan" | "research" | "write" | "verify";

/**
 * 스트리밍 이벤트 규격. 백엔드는 /api/report/stream 에서 이 모양을 NDJSON 한 줄씩 보내고,
 * 프론트는 이 모양만 보고 진행 화면을 만듭니다. 구현 전에 양쪽이 같은 타입을 보게 하려고 먼저 고정합니다.
 *
 *  stage  → 단계 시작 · 끝 (plan 질문 파악 / research 데이터 조사 / write 리포트 작성 / verify 검증)
 *  plan   → ① 접수 결과: 의도 · 모드 · 부를 tool ("이렇게 조사할게요")
 *  step   → tool 하나가 끝날 때마다 (진행상황 목록 한 줄)
 *  verify → ④ 검증 요약 ("숫자 8/8 · 권유 0")
 *  report → 리포트 완성
 *  error  → 실패. 이후 이벤트 없음
 *
 * research() 와 mockResearch() 는 stage · plan · step · verify 를 콜백으로 주고,
 * report · error 는 라우트가 요청 id 를 붙여 보냅니다.
 * 실제 실행은 research · write · verify 단계를 보냅니다 (plan 은 2단계 접수부터). Mock 은 모든 단계를 보냅니다.
 * 검증 실패로 작성을 1회 수정할 때는 verify 단계 안에서 처리하고 단계 이벤트를 다시 보내지 않습니다.
 */
export type MuffinEvent =
  | { type: "stage"; stage: Stage; status: "start" | "done" }
  | { type: "plan"; intent: Intent; mode: ReportMode; tools: string[] }
  | { type: "step"; step: ToolStep }
  | { type: "verify"; verification: Verification }
  | { type: "report"; report: Report; steps: ToolStep[]; rewrites: number; id: string }
  | { type: "error"; message: string; id?: string };

/** tool 이름 → 진행상황 화면에 보여줄 한국어 라벨. tool 이 추가되면 여기에 한 줄. */
export const toolLabels: Record<string, string> = {
  get_fx_krw_rate: "환율 확인",
  get_etf_kr_price: "국내 ETF 시세 확인",
  get_korean_economic_news: "경제 뉴스 확인",
  get_macro_indicators: "물가·고용 지표 확인",
  get_rate_data: "금리 확인",
  calc_metrics: "계산",
};

export function labelFor(toolName: string): string {
  return toolLabels[toolName] ?? toolName;
}

export const stageLabels: Record<Stage, string> = {
  plan: "질문 파악",
  research: "데이터 조사",
  write: "리포트 작성",
  verify: "검증",
};
