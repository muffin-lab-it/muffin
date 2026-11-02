/** /admin 화면의 날짜 · 숫자 표기. 시간은 모두 한국 시간입니다. */

const kstFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function kstParts(iso: string): Record<string, string> {
  return Object.fromEntries(kstFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
}

/** "11-02 10:59" (withSeconds 면 "11-02 10:59:12") */
export function kst(iso: string, withSeconds = false): string {
  const p = kstParts(iso);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}${withSeconds ? `:${p.second}` : ""}`;
}

/** 막대 축 이름: 6시간 칸은 자정이면 "11/02", 1시간 칸은 6시간마다 "18시". 이름을 붙이지 않는 칸은 빈 문자열 */
export function axisLabel(iso: string, bucketMs: number): string {
  const p = kstParts(iso);
  const hour = Number(p.hour);
  if (bucketMs >= 6 * 60 * 60_000) return hour === 0 ? `${p.month}/${p.day}` : "";
  return hour % 6 === 0 ? `${hour}시` : "";
}

/** "4분 전" · "3시간 전" · "2일 전" */
export function ago(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
export const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "-");
export const count = (n: number) => n.toLocaleString("ko-KR");
