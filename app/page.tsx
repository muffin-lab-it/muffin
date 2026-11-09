/// <reference types="next/image-types/global" />
// CI에서도 개발 서버가 생성하는 next-env.d.ts 없이 정적 이미지 타입을 인식합니다.
"use client";

import styles from "./HomeHistory.module.css";

import Image from "next/image";
import mascot from "./home-muffin.png";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Area, Depth } from "@/src/agent/schema";
import { Progress } from "./components/Progress";
import { ReportView } from "./components/ReportView";
import { buildHomeInput, toggleHomeArea } from "./components/home-form";
import { createHomeReport, showsHomeProgress } from "./components/home-report";

const areaOptions: { value: Area; label: string }[] = [
  { value: "fx", label: "환율" },
  { value: "etf", label: "ETF" },
  { value: "news", label: "경제뉴스" },
  { value: "rate", label: "금리" },
  { value: "macro", label: "물가" },
];

const depthOptions: { value: Depth; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "핵심만 쉽게 설명" },
  { value: "standard", label: "Standard", hint: "배경까지 차근차근 설명" },
  { value: "deep", label: "Deep Dive", hint: "근거와 맥락까지 깊게 분석" },
];

/**
 * 홈. 질문을 보내면 리포트를 저장함에 넣고 리포트 페이지로 이동합니다.
 * 서버의 실제 이벤트를 표시하고 저장을 확인한 뒤 이동합니다.
 */
export default function Home() {
  const router = useRouter();
  const [selectedAreas, setSelectedAreas] = useState<Area[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [depth, setDepth] = useState<Depth>("easy");
  const [question, setQuestion] = useState("");
  const [request] = useState(() => createHomeReport(undefined, url => router.push(url)));
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => () => request.detach(), [request]);
  const coolingDown = state.retrySeconds > 0;
  const checking = state.phase === "checking";
  const busy = checking;
  const unsupported = state.phase === "unsupported" || (
    state.phase === "error" && !!state.error?.message.includes("조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요")
  );
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
    setFormError(null);
    const input = buildHomeInput(question, depth, selectedAreas);
    if (input.question.length > 500) {
      setFormError("선택한 관심 영역을 함께 보내려면 질문을 조금 줄여주세요.");
      questionField.current?.focus();
      return;
    }
    await request.start(input);
  }


  if (showsHomeProgress(state) && state.input) {
    return (
      <>
        <Progress question={state.input.question} depth={state.input.depth} events={state.events}
          error={state.error && { ...state.error, retryAfterSec: state.retrySeconds }}
          onRetry={state.phase === "error" ? () => { void request.retry(); } : undefined}
          onEditQuestion={editQuestion} onReturnHome={editQuestion} />
        {state.result && <ReportView report={state.result.report} steps={state.result.steps} area={state.input.area} />}
      </>
    );
  }

  return (
    <div className={`${styles.home} muffin-home`}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div><p className={styles.eyebrow}>작은 질문에서 시작하는 경제 연구소</p>
          <h1 id="home-title">궁금한 금융 이야기,<br />지금 <em>Muffin</em>에게 물어보세요.</h1>
          <p className={styles.description}>환율, ETF, 경제뉴스부터 금리와 물가까지.<br />복잡한 금융을 내 눈높이에 맞춰 풀어드려요.</p>
        </div>
        <Image src={mascot} alt="돋보기와 노트북으로 금융을 연구하는 머핀" className={styles.mascot} sizes="(max-width: 600px) 260px, 380px" preload />
      </section>
      <form onSubmit={onSubmit} className={styles.form} aria-busy={busy}>
        <div className={styles.formContent}>
          <label htmlFor="question" className={styles.srOnly}>궁금한 금융 질문</label>
          <div className={styles.search}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg>
            <textarea ref={questionField} id="question" required readOnly={busy} maxLength={500} aria-describedby="question-limit" rows={1} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} value={question} onChange={(e) => { setQuestion(e.target.value); setFormError(null); if (state.phase === "unsupported" || state.phase === "error") request.edit(); }} placeholder="예: 금리가 내려가면 내 생활은 어떻게 달라질까?" />
          </div>
          <small id="question-limit" className={styles.questionLimit}>궁금한 금융 이야기를 자유롭게 물어보세요.</small>
          {checking && <p className={styles.checking} role="status" aria-live="polite">작성해주신 질문을 살펴보고 있어요.</p>}
          {unsupported && <section className={styles.scopeNotice} role="alert"><h2>이 질문은 아직 답하기 어려워요.</h2><p>생성형 AI서비스인 머핀은 현재는 환율·ETF·경제뉴스·금리·물가를 중심으로 리포트를 만들어요. 질문을 바꿔 다시 물어봐 주세요.</p></section>}
          {state.phase === "error" && !unsupported && state.error && <p className={styles.formError} role="alert">{state.error.message}</p>}
          <fieldset className={styles.fieldset} disabled={busy} aria-describedby="area-hint"><legend>관심 영역</legend>
            <div className={styles.areas}>
              <label className={styles.option}><input type="checkbox" name="area" checked={selectedAreas.length === 0} onChange={() => { setSelectedAreas([]); setFormError(null); }} /><span>Auto 머핀 <small className={styles.badge}>추천</small></span></label>
              {areaOptions.map(o => <label className={styles.option} key={o.value}><input type="checkbox" name="area" value={o.value} checked={selectedAreas.includes(o.value)} onChange={() => { setSelectedAreas(previous => toggleHomeArea(previous, o.value)); setFormError(null); }} /><span>{o.label}</span></label>)}
            </div>
            <p id="area-hint" className={styles.hint}>{selectedAreas.length === 0 ? "AI가 질문에 맞는 최적의 주제를 선택해요." : "선택한 관심 영역을 중심으로 리포트를 만들어요."}</p>
          </fieldset>
          <fieldset className={styles.fieldset} disabled={busy}><legend className={styles.srOnly}>설명 방식</legend><div className={styles.depths}>
            {depthOptions.map(o => <label className={styles.option} key={o.value}><input type="radio" name="depth" value={o.value} checked={depth === o.value} onChange={() => setDepth(o.value)} /><span><b>{o.label}</b><small>{o.hint}</small></span></label>)}
          </div></fieldset>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <button className={styles.submit} data-checking={checking ? "true" : undefined} type="submit" disabled={busy || coolingDown || question.trim().length === 0}>{!checking && <Image src="/icon.svg" width={28} height={28} alt="" />}{checking ? "질문 살펴보는 중…" : coolingDown ? `${state.retrySeconds}초 후 다시 시도` : "Muffin 리포트 굽기"}<span aria-hidden="true">›</span></button>
          <p className={styles.aiDisclosure}>Muffin은 생성형 AI로 여러 자료를 바탕으로 리포트를 작성해요. 투자 권유가 아닌 참고용 정보이며, 내용에 오류가 있을 수 있어요. 출처와 기준일을 함께 확인해 주세요.</p>
        </div>
      </form>

    </div>
  );
}
