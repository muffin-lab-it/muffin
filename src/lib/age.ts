/** "3분" · "2시간" · "1일" 처럼 사람이 읽는 시간 길이. tool 응답 캐시의 나이(리포트 · /admin)에 씁니다. 의존성 없음 — 화면에서도 쓸 수 있습니다 */
export function formatAge(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)}분`;
  const hours = Math.round(min / 60);
  return hours < 24 ? `${hours}시간` : `${Math.round(hours / 24)}일`;
}
