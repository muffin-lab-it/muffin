"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./ReportView.module.css";

/** 실제 줄 넘침만 접습니다. 서버 문장과 숫자를 자르거나 다시 요약하지 않습니다. */
export function ReportSummary({ text }: { text: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    let active = true;
    const measure = () => {
      if (active) setCanExpand(expanded || element.scrollHeight > element.clientHeight + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    void document.fonts.ready.then(measure);
    measure();
    return () => { active = false; observer.disconnect(); };
  }, [text, expanded]);

  return (
    <>
      <p ref={paragraph} id={id} className={expanded ? styles.summaryExpanded : styles.summaryPreview}>{text}</p>
      {canExpand && (
        <button type="button" className={styles.summaryToggle} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
          {expanded ? "요약 접기" : "요약 전체 보기"}
        </button>
      )}
    </>
  );
}
