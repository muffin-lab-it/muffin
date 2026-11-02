"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import styles from "./admin.module.css";

/** 화면이 보이는 동안 seconds 마다 서버에서 다시 그립니다. 탭이 가려져 있으면 세지 않습니다. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const left = useRef(seconds);
  const [shown, setShown] = useState(seconds);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      left.current -= 1;
      if (left.current <= 0) {
        left.current = seconds;
        startTransition(() => router.refresh());
      }
      setShown(left.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  function refreshNow() {
    left.current = seconds;
    setShown(seconds);
    startTransition(() => router.refresh());
  }

  return (
    <div className={styles.live}>
      <span className={styles.liveDot} aria-hidden="true" />
      <span className={styles.liveText}>{pending ? "새로고침 중" : `${shown}초 뒤 새로고침`}</span>
      <button type="button" onClick={refreshNow} disabled={pending}>
        지금 새로고침
      </button>
    </div>
  );
}
