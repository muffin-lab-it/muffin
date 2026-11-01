"use client";

import { useEffect, useState } from "react";
import { Progress, type ProgressError } from "@/app/components/Progress";
import { stages, type MuffinEvent } from "@/src/agent/events";
import type { Depth } from "@/src/agent/schema";
import styles from "./preview.module.css";

import sample from "@/src/agent/fixtures/report.v2.sample.json";
import { reportSchema } from "@/src/agent/schema";
import { ReportView } from "@/app/components/ReportView";
const report = reportSchema.parse(sample.report);
const scenarios = { normal: "조사 중", partial: "일부 자료 실패", timeout: "시간초과", scope: "지원 범위 밖", failure: "일반 조사 실패", network: "연결 끊김", empty: "결과 없이 응답 종료", input: "입력 오류 · 400", config: "서비스 설정 · 503", limited: "요청 횟수 초과 · 429", forbidden: "접속 출처 제한 · 403", large: "요청 크기 초과 · 413", save: "저장 실패" };
type Scenario = keyof typeof scenarios;

export function ProgressPreview() {
  const [depth, setDepth] = useState<Depth>("standard");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [step, setStep] = useState(1);
  const [question, setQuestion] = useState("최근 우리나라 물가는 왜 올랐을까?");
  const [editing, setEditing] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const errors: Partial<Record<Scenario, ProgressError>> = {
    failure: { message: "조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
    network: { kind: "network", message: "인터넷 연결을 확인한 후 다시 시도해 주세요." },
    empty: { message: "리포트를 끝까지 받지 못했어요. 다시 시도해 주세요." },
    input: { status: 400, message: "질문과 선택한 설정을 확인해 주세요." },
    config: { status: 503, message: "리포트 서비스 설정을 확인해 주세요." },
    limited: { status: 429, message: "요청이 많아요. 잠시 후 다시 시도해 주세요.", retryAfterSec: remaining },
    forbidden: { status: 403, message: "허용되지 않은 출처입니다." },
    large: { status: 413, message: "요청이 너무 큽니다. 질문을 줄여 주세요." },
    save: { kind: "save", message: "리포트를 저장하지 못했어요. 이 화면을 떠나거나 새로고침하면 결과가 사라질 수 있어요." },
  };
  const beforeStart = ["input", "config", "limited", "forbidden", "large"].includes(scenario);
  const events: MuffinEvent[] = [];
  if (scenario === "scope") {
    events.push({ type: "stage", stage: "plan", status: "done" }, { type: "plan", mode: "out_of_scope", intent: "out_of_scope", tools: [] }, { type: "stage", stage: "verify", status: "start" });
  } else if (!beforeStart) {
    for (let i = 0; i <= step; i++) {
      events.push({ type: "stage", stage: stages[i], status: i < step ? "done" : "start" });
      if (i === 0 && step > 0) events.push({ type: "plan", mode: "research", intent: "cause", tools: ["get_macro_indicators", "get_korean_economic_news"] });
    }
    if (scenario === "partial") events.push({ type: "step", step: { tool: "get_macro_indicators", status: "error", ms: 1200 } });
    if (scenario === "timeout") events.push({ type: "error", message: "조사 시간이 초과되었습니다. 질문 범위를 줄여 다시 시도해 주세요.", id: "preview-only" });
  }

  if (scenario === "save") events.push({ type: "report", report, steps: [], rewrites: 0, id: "preview-saved-report" });
  return <>
    <details className={styles.controls} open>
      <summary>화면 확인용 설정 · 실제 조사와 저장은 하지 않아요</summary>
      <div className={styles.row}>
        <label>설명 깊이<select value={depth} onChange={e => setDepth(e.target.value as Depth)}><option value="easy">Easy</option><option value="standard">Standard</option><option value="deep">Deep Dive</option></select></label>
        <label>확인할 상태<select value={scenario} onChange={e => { const next = e.target.value as Scenario; setScenario(next); setStep(1); setRemaining(next === "limited" ? 5 : 0); setSaved(false); setEditing(false); }}>{Object.entries(scenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button type="button" disabled={!["normal", "partial"].includes(scenario)} onClick={() => setStep(value => (value + 1) % stages.length)}>다음 단계 보기</button>
      </div>
      <p>429는 미리보기에서 5초만 기다립니다. 403·413·429·저장 실패는 연동 전 UX 예시입니다.</p><p>설정을 접으면 소비자에게 보이는 본문만 확인할 수 있어요. 재시도는 예시를 초기화해요.</p>
    </details>
    {editing && <form className={styles.edit} onSubmit={e => { e.preventDefault(); setEditing(false); setScenario("normal"); setStep(0); }}>
      <label htmlFor="preview-question">예시 질문 수정</label><textarea id="preview-question" value={question} maxLength={500} onChange={e => setQuestion(e.target.value)} required />
      <button disabled={!question.trim()}>이 질문으로 미리보기</button>
    </form>}
    {!editing && !saved && <Progress question={scenario === "scope" ? "비트코인 지금 얼마야?" : question} depth={depth} events={events} error={errors[scenario]} onRetry={() => { if (scenario === "save") { setSaved(true); return; } setScenario("normal"); setStep(0); }} onEditQuestion={() => setEditing(true)} />}
    {scenario === "save" && <section aria-label="보존된 리포트"><p role="status">{saved ? "미리보기: 저장 성공 상태로 바뀌었어요. 실제로 저장하지는 않았어요." : "아래는 보존된 결과의 예시입니다. 실제 질문에 대한 답변이 아닙니다."}</p><ReportView report={report} /></section>}
  </>;
}
