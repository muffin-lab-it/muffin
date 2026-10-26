/**
 * 모든 tool 이 공통으로 반환하는 타입.
 * 리포트의 출처 표시가 핵심 기능이라 source 는 필수입니다.
 */
export type Source = {
  /** 출처 이름. 예: "한국은행 경제통계시스템", "Frankfurter (ECB)" */
  name: string;
  /** 사용자가 클릭해 직접 확인할 수 있는 링크 */
  url: string;
  /** 데이터 기준 시각 (ISO 8601). 예: "2026-10-02" */
  asOf: string;
};

export type ToolResult<T = unknown> = {
  /** Agent 가 읽을 데이터. JSON 직렬화 가능해야 합니다. */
  data: T;
  /** 출처 1개, 여러 개면 배열. 계산 tool 은 url 이 빈 문자열이고 출처 목록에 들어가지 않습니다 */
  source: Source | Source[];
  /** 데이터 해석 시 주의점 (선택). 예: "주말·공휴일은 직전 영업일 값" */
  note?: string;
  /** 계산 tool 만: 어떤 연산을 어느 증거 번호로 했는지. 장부 항목의 lineage 로 올라갑니다 */
  lineage?: { op: string; inputs: string[] };
};
