/** "3분" · "2시간" · "1일" 처럼 사람이 읽는 시간 길이. tool 응답 캐시의 나이(리포트 · /admin)에 씁니다. 의존성 없음 — 화면에서도 쓸 수 있습니다 */
export function formatAge(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)}분`;
  const hours = Math.round(min / 60);
  return hours < 24 ? `${hours}시간` : `${Math.round(hours / 24)}일`;
}

/**
 * 다시 시도할 수 있을 때까지 남은 시간. 1분 미만은 "30초", 1시간 미만은 "10분", 그 이상은 "24시간".
 * 남은 시간보다 짧게 보이지 않도록 올림합니다 — 서버의 429 문장(`retryAfterMessage`, src/lib/ratelimit.ts)과 같은 기준입니다.
 */
export function formatWait(seconds: number): string {
  const sec = Math.max(1, Math.ceil(seconds));
  if (sec < 60) return `${sec}초`;
  return sec < 3600 ? `${Math.ceil(sec / 60)}분` : `${Math.ceil(sec / 3600)}시간`;
}
