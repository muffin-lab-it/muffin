import type { Area, Depth } from "@/src/agent/schema";

/**
 * 홈 관심 영역 · 분석 난이도 그림 (11/26 사용자: 처음 콘셉트처럼 칸마다 그림).
 * 선 그림이라 색은 글자색(currentColor)을 따르고, 굵기 · 크기는 HomeHistory.module.css 의 .optionIcon 이 정합니다.
 */
const areaIcons: Record<Area | "auto", React.ReactNode> = {
  // Auto 머핀: 알아서 고르는 반짝임
  auto: <><path d="M11 3.5l1.6 4.4 4.4 1.6-4.4 1.6L11 15.5l-1.6-4.4L5 9.5l4.4-1.6z" /><path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
  fx: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5h-5a2 2 0 1 0 0 4h3a2 2 0 1 1 0 4h-5" /><path d="M12 6.5v11" /></>,
  etf: <><path d="M4 4v15a1 1 0 0 0 1 1h15" /><path d="m8 14 3-3 3 2 5-6" /></>,
  news: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M8 7.5h8v3H8z" /><path d="M8 13.5h8M8 16.5h5" /></>,
  rate: <><path d="M12 3 3.5 7.5h17z" /><path d="M6 10.5v6.5M10 10.5v6.5M14 10.5v6.5M18 10.5v6.5" /><path d="M3.5 20.5h17" /></>,
  macro: <><path d="M3 4h2.2l2.3 10.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.1" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>,
};

const depthIcons: Record<Depth, React.ReactNode> = {
  // Easy 새싹 · Standard 별 · Deep Dive 돋보기 안 그래프
  easy: <><path d="M12 20v-9" /><path d="M12 13c-4.2 0-6.5-2.3-6.5-6.5 4.2 0 6.5 2.3 6.5 6.5z" /><path d="M12 11c0-3.9 2.2-6 6.5-6 0 3.9-2.2 6-6.5 6z" /><path d="M8 20h8" /></>,
  standard: <path d="M12 3l2.23 5.93 6.33.29-4.95 3.95 1.68 6.11L12 15.8l-5.29 3.48 1.68-6.11-4.95-3.95 6.33-.29z" />,
  deep: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /><path d="m7.5 12 2-2 1.5 1.5 2.5-3" /></>,
};

export function AreaIcon({ area }: { area: Area | "auto" }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{areaIcons[area]}</svg>;
}

export function DepthIcon({ depth }: { depth: Depth }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{depthIcons[depth]}</svg>;
}
