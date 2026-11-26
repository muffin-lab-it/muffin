/// <reference types="next/image-types/global" />
"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import cookie from "../cookie.webp";
import styles from "./CookieDecor.module.css";

/**
 * 리포트 화면 오른쪽 아래 쿠키 (11/26 사용자). 리포트 칸 오른쪽 끝에 살짝 걸치고, 마우스를 왼쪽 → 오른쪽으로 옮기면
 * 오른쪽으로 살짝 돌아갑니다. PC 폭 1280px 이상에서만 보이고(좁으면 본문을 가림) 인쇄에서는 숨깁니다.
 * 본문 뒤에 깔리고 누를 수 없으며 읽기 도구에 읽히지 않습니다. 움직임 줄이기 설정이나 마우스가 없는 기기에서는 돌지 않습니다.
 */
export function CookieDecor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let ratio = 0.5;
    // 화면 왼쪽 끝 -1 ~ 오른쪽 끝 +1. 한 프레임에 한 번만 반영
    const apply = () => { frame = 0; box.style.setProperty("--tilt", (ratio * 2 - 1).toFixed(3)); };
    const move = (event: PointerEvent) => { ratio = event.clientX / Math.max(1, window.innerWidth); if (!frame) frame = requestAnimationFrame(apply); };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return (
    <div ref={ref} className={styles.cookies} aria-hidden="true">
      <Image src={cookie} alt="" width={560} height={537} unoptimized className={styles.cookie} />
    </div>
  );
}
