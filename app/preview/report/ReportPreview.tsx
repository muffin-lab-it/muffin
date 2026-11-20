"use client";
import { useState } from "react";
import samples from "./samples.json";
import { reportSchema, type Area } from "@/src/agent/schema";
import { ReportView } from "@/app/components/ReportView";
import { ReportActions } from "@/app/components/ReportActions";
import styles from "./preview.module.css";
export function ReportPreview({canvas=false, initialSample}: {canvas?:boolean; initialSample?:string}) {
  const [example, setExample] = useState<keyof typeof samples>(initialSample && initialSample in samples ? initialSample as keyof typeof samples : "rate");
  const [width, setWidth] = useState("desktop");
  const [controls, setControls] = useState(true);
  const sample = samples[example];
  const report = reportSchema.parse(sample.report);
  return <div className={styles.previewRoot}>
    {!canvas && <aside className={styles.checkbar} aria-label="화면 확인 도구">
      <div className={styles.checkHeading}><div><strong>리포트 디자인 확인</strong><p>고정 예시 데이터 · 실제 조사/API 호출 없음 · 아래는 사용자 화면입니다.</p></div><button onClick={() => setControls(!controls)}>{controls ? "설정 접기" : "설정 펼치기"}</button></div>
      {controls && <div className={styles.checkOptions}>
        <label>확인할 예시<select value={example} onChange={e => setExample(e.target.value as keyof typeof samples)}>{Object.entries(samples).map(([key,value]) => <option value={key} key={key}>{value.title}</option>)}</select></label>
        <fieldset><legend>리포트 너비</legend>{[["desktop","PC"],["mobile","모바일 390"],["small","모바일 360"],["columns","좁은 두 열"]].map(([key,label]) => <button key={key} onClick={() => setWidth(key)} aria-pressed={width===key}>{label}</button>)}</fieldset>
        <a href={`?canvas=1&sample=${example}`} target="_blank" rel="noreferrer">사용자 화면만 보기 ↗</a>
        <a href={`http://localhost:3002/preview/report?sample=${example}`} target="_blank" rel="noreferrer">같은 예시 As-is ↗</a>
        <a href="http://localhost:3002/preview/original" target="_blank" rel="noreferrer">최초 원본 화면 ↗</a>
      </div>}
    </aside>}
    <div className={styles.stage} data-width={width}>
      <ReportView actions={<ReportActions key={example} />} report={report} question={sample.question} area={sample.area as Area} createdAt="2026-11-19T01:00:00Z" />
      {width === "columns" && <ReportView actions={<ReportActions key={example} />} report={report} question={sample.question} area={sample.area as Area} createdAt="2026-11-19T01:00:00Z" />}
    </div>
  </div>;
}
