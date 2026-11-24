/**
 * 조사 · 작성에 알려 주는 오늘 날짜 (리더, 11/24).
 *
 * 11/23 운영 · 로컬: 모델이 오늘 날짜를 몰라 뉴스 질문의 확인하지 못한 것에 "현재 날짜 정보가 없어 2026-11-23 발행 기사가 오늘 기사인지는 확인할 수 없어요",
 * "한국시간 기준 오늘 날짜와의 대응은 확인하지 않았어요" 가 들어갔습니다 (뉴스 질문 16건 중 2건). 한국 시간 오늘 날짜를 입력 맨 앞에 한 줄 넣습니다.
 */

/** 한국 시간 오늘 날짜 (YYYY-MM-DD) */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

/** 조사 · 작성 입력 맨 앞의 오늘 날짜 줄 */
export function todayLine(now: Date = new Date()): string {
  return `[오늘] ${todayKst(now)} (한국 시간). "오늘 · 요즘 · 최신" 은 이 날짜를 기준으로 판단합니다. 오늘 날짜를 알 수 없다는 말은 쓰지 않습니다.`;
}
