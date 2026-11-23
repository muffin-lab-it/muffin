"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type QuickItem = { key: string; label: string };

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** 지금 읽는 영역: 화면 위쪽 35% 안으로 들어온 마지막 영역. 맨 아래에 닿으면 마지막 영역 */
export function activeQuickKey(keys: readonly string[], tops: readonly (number | null)[], viewportHeight: number, atBottom: boolean): string {
  const present = keys.filter((_, index) => tops[index] !== null);
  if (present.length === 0) return "";
  if (atBottom) return present[present.length - 1]!;
  let active = present[0]!;
  keys.forEach((key, index) => {
    const top = tops[index];
    if (top !== null && top !== undefined && top <= viewportHeight * 0.35) active = key;
  });
  return active;
}

function currentKey(keys: string): string {
  const list = keys.split(",");
  const tops = list.map(key => document.querySelector(`[data-quick="${key}"]`)?.getBoundingClientRect().top ?? null);
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  return activeQuickKey(list, tops, window.innerHeight, atBottom);
}

/**
 * 리포트 목차 퀵메뉴 (11/23 사용자 결정: 리포트가 아래로 길어 탭 대신 따라다니는 목차). '맨 위로' 버튼 위에 붙습니다.
 * 넓은 화면은 늘 펼치고, 좁은 화면 · 휴대폰은 '목차' 버튼으로 엽니다. 휴대폰에서 접힌 출처는 펼친 뒤 이동합니다. 인쇄(PDF)에는 나오지 않습니다.
 */
export function ReportQuickMenu({ items }: { items: QuickItem[] }) {
  const keys = items.map(item => item.key).join(",");
  const active = useSyncExternalStore(subscribe, () => currentKey(keys), () => "");
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // 열린 목차는 바깥을 누르거나 Esc 로 닫습니다
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!navRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggleRef.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 키보드로 누른 경우(event.detail 0)에만 옮겨 간 제목에 초점 테두리를 보입니다. 마우스로 누르면 테두리 없이 초점만 옮김
  const go = (key: string, viaKeyboard: boolean) => {
    const target = document.querySelector<HTMLElement>(`[data-quick="${key}"]`);
    if (!target) return;
    // 휴대폰에서 접혀 있는 영역(출처 등)은 펼친 뒤 이동
    target.querySelectorAll<HTMLDetailsElement>("details.responsive-details").forEach(details => { details.open = true; });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const heading = target.querySelector<HTMLElement>("summary, h2") ?? target;
    if (!heading.hasAttribute("tabindex") && heading.tagName !== "SUMMARY") heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true, focusVisible: viaKeyboard } as FocusOptions);
    setOpen(false);
  };

  if (items.length < 2) return null;
  return (
    <nav ref={navRef} className="quick-menu" aria-label="리포트 목차" data-open={open ? "true" : undefined}>
      <button ref={toggleRef} type="button" className="quick-menu-toggle" aria-expanded={open} aria-controls="report-quick-menu" onClick={() => setOpen(value => !value)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" /></svg>
        <span>목차</span>
      </button>
      <ul id="report-quick-menu" className="quick-menu-list">
        {items.map(item => (
          <li key={item.key}>
            <button type="button" aria-current={active === item.key ? "true" : undefined} onClick={(event) => go(item.key, event.detail === 0)}>{item.label}</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
