"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Area, Depth } from "@/src/agent/schema";
import { Progress } from "./components/Progress";
import { ReportView } from "./components/ReportView";
import { createHomeReport } from "./components/home-report";

const areaOptions: { value: Area; label: string }[] = [
  { value: "fx", label: "💵 환율" },
  { value: "etf", label: "📈 ETF" },
  { value: "news", label: "📰 경제뉴스" },
  { value: "rate", label: "🏦 금리" },
  { value: "macro", label: "📊 물가" },
];

const depthOptions: { value: Depth; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "쉽게 핵심만 빠르게" },
  { value: "standard", label: "Standard", hint: "균형 잡힌 핵심과 배경" },
  { value: "deep", label: "Deep Dive", hint: "깊이 있는 리포트로 진지하게" },
];

/**
 * 홈. 질문을 보내면 리포트를 저장함에 넣고 리포트 페이지로 이동합니다.
 * 서버의 실제 이벤트를 표시하고 저장을 확인한 뒤 이동합니다.
 */
export default function Home() {
  const router = useRouter();
  const [area, setArea] = useState<Area>("etf");
  const [depth, setDepth] = useState<Depth>("standard");
  const [question, setQuestion] = useState("KODEX 200 요즘 어때?");
  const [request] = useState(() => createHomeReport(undefined, url => router.push(url)));
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => () => request.detach(), [request]);
  const coolingDown = state.retrySeconds > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(request.tick, 250);
    return () => window.clearInterval(timer);
  }, [request, coolingDown]);
  useEffect(() => {
    if (state.phase === "idle" && restoreFocus.current) {
      restoreFocus.current = false;
      questionField.current?.focus();
    }
  }, [state.phase]);

  function editQuestion() {
    restoreFocus.current = true;
    request.edit();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await request.start({ question, depth, area });
  }

  if (state.phase !== "idle" && state.input) {
    return (
      <>
        <Progress question={state.input.question} depth={state.input.depth} events={state.events}
          error={state.error && { ...state.error, retryAfterSec: state.retrySeconds }}
          onRetry={state.phase === "error" ? () => { void request.retry(); } : undefined}
          onEditQuestion={editQuestion} onReturnHome={editQuestion} />
        {state.result && <ReportView report={state.result.report} steps={state.result.steps} area={state.input.area} question={state.input.question} />}
      </>
    );
  }

  return (
    <>
      <h1>🧁 오늘 무엇이 궁금하세요?</h1>
      <p className="sub">관심 주제를 고르면 Muffin이 출처와 함께 리포트를 만들어 드려요.</p>

      <form onSubmit={onSubmit}>
        <fieldset>
          <legend>관심 영역</legend>
          <div className="row">
            {areaOptions.map((o) => (
              <label className="chip" key={o.value}>
                <input type="radio" name="area" value={o.value} checked={area === o.value} onChange={() => setArea(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>설명 깊이</legend>
          <div className="row">
            {depthOptions.map((o) => (
              <label className="chip depth" key={o.value}>
                <input type="radio" name="depth" value={o.value} checked={depth === o.value} onChange={() => setDepth(o.value)} />
                <span><b>{o.label}</b><small>{o.hint}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          질문
          <textarea ref={questionField} id="question" required maxLength={500} aria-describedby="question-limit" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="예: 오늘 원/달러 환율이 왜 내려갔는지 궁금해요." />
          <small id="question-limit">최대 500자 · {question.length}/500</small>
        </label>
        <button type="submit" disabled={coolingDown || question.trim().length === 0}>{coolingDown ? `${state.retrySeconds}초 후 다시 시도` : "✨ 오늘의 Muffin 만들기"}</button>
      </form>
    </>
  );
}
