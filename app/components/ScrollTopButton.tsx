"use client";

import { useSyncExternalStore } from "react";

/** 이만큼 내려가면 '맨 위로' 버튼을 보여 줍니다 (화면 높이의 0.8배, 최소 480px) */
export function showsScrollTop(scrollY: number, viewportHeight: number): boolean {
  return scrollY > Math.max(480, viewportHeight * 0.8);
}

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/**
 * 오른쪽 아래를 따라다니는 '맨 위로' 버튼 (11/23 사용자 요청: 리포트가 아래로 길어 처음으로 돌아가기 번거로움).
 * 어느 정도 내려가면 나타나고, 누르면 맨 위로 올라가 첫 제목에 초점을 둡니다. 인쇄(PDF)에는 나오지 않습니다 (globals.css).
 */
export function ScrollTopButton() {
  const visible = useSyncExternalStore(subscribe, () => showsScrollTop(window.scrollY, window.innerHeight), () => false);
  const toTop = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // 키보드로 쓰는 사람이 맨 위에서 이어 읽도록 첫 제목에 초점을 옮깁니다
    const target = document.querySelector<HTMLElement>("main h1, main h2") ?? document.querySelector<HTMLElement>("main");
    if (!target) return;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  };
  return (
    <button type="button" className="scroll-top" data-visible={visible ? "true" : undefined} aria-label="맨 위로 가기" title="맨 위로" onClick={toTop}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      <span aria-hidden="true">맨 위로</span>
    </button>
  );
}
