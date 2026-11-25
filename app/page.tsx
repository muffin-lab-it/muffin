/// <reference types="next/image-types/global" />
// CI에서도 개발 서버가 생성하는 next-env.d.ts 없이 정적 이미지 타입을 인식합니다.
"use client";

import styles from "./HomeHistory.module.css";
import Image from "next/image";
import Link from "next/link";
import mascot from "./home-muffin.png";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Area, Depth } from "@/src/agent/schema";
import { formatWait } from "@/src/lib/age";
import { Progress } from "./components/Progress";
import { ReportView } from "./components/ReportView";
import { areaHint, buildHomeInput, QUESTION_MAX, questionAllowance, toggleHomeArea } from "./components/home-form";
import { createHomeReport, showsHomeProgress } from "./components/home-report";

const areaOptions: { value: Area; label: string }[] = [
  { value: "fx", label: "환율" },
  { value: "etf", label: "ETF" },
  { value: "news", label: "경제뉴스" },
  { value: "rate", label: "금리" },
  { value: "macro", label: "물가" },
];

// 깊이마다 무엇이 달라지는지 구체적으로 (11/20 QA 9: 한 줄 설명으로는 뭘 골라야 할지 몰랐음). 시간은 운영 기록의 대략값
const depthOptions: { value: Depth; label: string; hint: string; time: string }[] = [
  { value: "easy", label: "Easy", hint: "숫자 1~2개 · 짧은 요약", time: "20초 안팎" },
  { value: "standard", label: "Standard", hint: "숫자 3~4개 · 배경과 생활 영향", time: "30초 안팎" },
  { value: "deep", label: "Deep Dive", hint: "기간 비교 · 반대 근거까지", time: "45초 안팎" },
];

/**
 * 홈. 질문을 보내면 리포트를 저장함에 넣고 리포트 페이지로 이동합니다.
 * 서버의 실제 이벤트를 표시하고 저장을 확인한 뒤 이동합니다.
 */
/**
 * 홈 머핀 둘레에 두둥실 떠 있는 금융 그림 (11/25 사용자: 초기 시안처럼 동전 · 차트 카드 · 은행 · 반짝이).
 * 꾸밈이라 읽기 도구에는 숨기고, 움직임 줄이기 설정이면 멈춰 있습니다
 */
function HeroFloaters() {
  return (
    <div className={styles.floaters} aria-hidden="true">
      <span className={`${styles.floater} ${styles.floatCoin}`}>
        <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#f6c453" /><circle cx="24" cy="24" r="17" fill="#f9d77a" stroke="#e5a92e" strokeWidth="2" /><text x="24" y="31" textAnchor="middle" fontSize="20" fontWeight="800" fill="#c98a12">$</text></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatCard} ${styles.floatPie}`}>
        <svg viewBox="0 0 64 40"><circle cx="16" cy="20" r="11" fill="#e7dcf8" /><path d="M16 20 L16 9 A11 11 0 0 1 26.5 23 Z" fill="#8b5cf6" /><rect x="32" y="13" width="24" height="4" rx="2" fill="#d9d3e6" /><rect x="32" y="22" width="18" height="4" rx="2" fill="#e8e3f0" /></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatCard} ${styles.floatLine}`}>
        <svg viewBox="0 0 72 44"><line x1="8" y1="38" x2="64" y2="38" stroke="#e5def0" strokeWidth="2" /><path d="M8 33 L22 25 L32 29 L46 16 L60 10" fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M53 8 L60 10 L58 17" fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatCard} ${styles.floatBank}`}>
        <svg viewBox="0 0 40 40"><path d="M20 7 L33 14 H7 Z" fill="#8b5cf6" /><rect x="9.5" y="16" width="4" height="12" rx="1" fill="#a78bfa" /><rect x="18" y="16" width="4" height="12" rx="1" fill="#a78bfa" /><rect x="26.5" y="16" width="4" height="12" rx="1" fill="#a78bfa" /><rect x="7" y="30" width="26" height="4" rx="1.5" fill="#8b5cf6" /></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatBars}`}>
        <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="21" fill="#8b5cf6" /><rect x="12" y="24" width="5" height="9" rx="1.5" fill="#fff" /><rect x="19.5" y="18" width="5" height="15" rx="1.5" fill="#fff" /><rect x="27" y="12" width="5" height="21" rx="1.5" fill="#fff" /></svg>
      </span>
      <span className={`${styles.spark} ${styles.spark1}`} /><span className={`${styles.spark} ${styles.spark2}`} /><span className={`${styles.spark} ${styles.spark3}`} />
    </div>
  );
}

export default function Home() {
  return <Suspense fallback={<p role="status">질문 화면을 준비하고 있어요…</p>}><HomeForm /></Suspense>;
}

function HomeForm() {
  const router = useRouter();
  const params = useSearchParams();
  const suggestedArea = areaOptions.find(item => item.value === params.get("area"))?.value;
  const [selectedAreas, setSelectedAreas] = useState<Area[]>(suggestedArea ? [suggestedArea] : []);
  const [formError, setFormError] = useState<string | null>(null);
  const [allPicked, setAllPicked] = useState(false);
  const [depth, setDepth] = useState<Depth>("easy");
  const [editedQuestion, setQuestion] = useState<string>();
  const question = editedQuestion ?? params.get("question")?.slice(0, 500) ?? "";
  const [request] = useState(() => createHomeReport(undefined, url => router.push(url)));
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => () => request.detach(), [request]);
  const coolingDown = state.retrySeconds > 0;
  const checking = state.phase === "checking";
  const busy = checking;
  const unsupported = state.phase === "unsupported";
  const canRetry = state.phase === "error" && ![400, 403, 413, 503].includes(state.error?.status ?? 0);
  const allowance = questionAllowance(selectedAreas);
  const over = Math.max(0, question.length - allowance);
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
  /** 반려된 질문을 지우고 새로 쓸 수 있게 (11/20 외부 F1: 반려되면 직접 다 지워야 했음) */
  function clearQuestion() {
    setQuestion("");
    editQuestion();
  }
  /** 범위 밖 안내의 추천 질문을 입력칸에 채웁니다. 깊이 · 영역을 고를 수 있게 바로 굽지는 않습니다 */
  function pickScopeTopic(topic: string) {
    setQuestion(topic);
    setFormError(null);
    editQuestion();
  }
  // 자동 높이(field-sizing)가 없는 브라우저(아이폰 사파리 등)는 내용 높이로 맞춥니다 (11/20 외부 F2: 긴 질문이 한 줄에 잘림)
  useEffect(() => {
    const field = questionField.current;
    if (!field) return;
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content")) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
    // 분류 중엔 진행 화면이 폼을 대신하므로, 범위 밖 · 오류로 폼이 다시 그려질 때도 높이를 다시 맞춥니다 (Codex 리뷰)
  }, [question, state.phase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input = buildHomeInput(question, depth, selectedAreas);
    if (input.question.length > QUESTION_MAX) {
      setFormError("선택한 관심 영역을 함께 보내려면 질문을 조금 줄여 주세요.");
      questionField.current?.focus();
      return;
    }
    await request.start(input);
  }


  if (showsHomeProgress(state) && state.input) {
    // 홈과 같은 넓은 틀(muffin-home)을 써서 진행 화면이 820px 본문 폭에 갇히지 않게 (11/21 사용자: 진행 화면이 작아 보임)
    return (
      <div className={`${styles.progressPage} muffin-home`}>
        <Progress question={state.input.question} depth={state.input.depth} events={state.events} pending={state.phase === "checking"}
          error={state.error && { ...state.error, retryAfterSec: state.retrySeconds }}
          onRetry={state.phase === "error" ? () => { void request.retry(); } : undefined}
          onEditQuestion={editQuestion} onReturnHome={editQuestion} />
        {state.result && <ReportView report={state.result.report} steps={state.result.steps} area={state.input.area} question={state.input.question} />}
      </div>
    );
  }

  return (
    <div className={`${styles.home} muffin-home`}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div><p className={styles.eyebrow}>작은 질문에서 시작하는 경제 연구소</p>
          <h1 id="home-title">궁금한 금융 이야기,<br />지금 <em>Muffin</em>에게 물어보세요.</h1>
          <p className={styles.description}>환율, ETF, 경제뉴스부터 금리와 물가까지.<br />모든 숫자에 출처와 기준일을 붙이고, 출처에 없는 숫자는 검증이 걸러내요.</p>
        </div>
        <div className={styles.mascotWrap}>
          <Image src={mascot} alt="돋보기와 노트북으로 금융을 연구하는 머핀" className={styles.mascot} sizes="(max-width: 600px) 260px, 380px" preload />
          <HeroFloaters />
        </div>
      </section>
      <form onSubmit={onSubmit} className={styles.form} aria-busy={busy}>
        <div className={styles.formContent}>
          <label htmlFor="question" className={styles.srOnly}>궁금한 금융 질문</label>
          <div className={styles.askRow}>
          <div className={styles.search}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg>
            <textarea ref={questionField} id="question" required readOnly={busy} maxLength={500} aria-describedby="question-limit" rows={1} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} value={question} onChange={(e) => { setQuestion(e.target.value); setFormError(null); if (state.phase === "unsupported" || state.phase === "error") request.edit(); }} placeholder="예: 요즘 환율 왜 올라?" />
          </div>
          <button className={`${styles.submit} ${styles.askSubmit}`} data-checking={checking ? "true" : undefined} type="submit" disabled={busy || coolingDown || question.trim().length === 0}>{!checking && <Image src="/icon.svg" width={28} height={28} alt="" />}{checking ? "질문 살펴보는 중…" : coolingDown ? `${state.retrySeconds}초 후 다시 시도` : "Muffin 리포트 굽기"}<span aria-hidden="true">›</span></button>
          </div>
          <small id="question-limit" className={styles.questionLimit}><span>궁금한 금융 이야기를 자유롭게 물어보세요.</span><span className={styles.questionCount} data-over={over > 0 ? "true" : undefined}>{over > 0 ? `${over}자 줄여 주세요 · ` : ""}{question.length} / {allowance}자</span></small>
          {checking && <p className={styles.checking} role="status" aria-live="polite">작성해주신 질문을 살펴보고 있어요.</p>}
          {unsupported && <section className={styles.scopeNotice} role="alert"><h2>이 질문은 아직 답하기 어려워요.</h2>
            {/* 서버가 만든 이유(미국 상장 ETF · 개별 주가 등)와 대신 물어볼 질문 (11/23 운영 검수 · QA 11 · 20명 시나리오 2) */}
            <p>{state.scope?.summary ?? "생성형 AI서비스인 머핀은 현재는 환율·ETF·경제뉴스·금리·물가를 중심으로 리포트를 만들어요. 질문을 바꿔 다시 물어봐 주세요."}</p>
            {state.scope && state.scope.topics.length > 0 && <div className={styles.scopeTopics}><p>이렇게 물어보면 답할 수 있어요</p><ul>{state.scope.topics.map(topic => <li key={topic.question}><button type="button" onClick={() => pickScopeTopic(topic.question)}>{topic.question}</button>{topic.reason && <small>{topic.reason}</small>}</li>)}</ul></div>}
            <button type="button" className={styles.clearQuestion} onClick={clearQuestion}>지우고 다시 쓰기</button></section>}
          {state.phase === "error" && state.error && <div className={styles.formError} role="alert"><p>{state.error.message}</p>{canRetry && <button type="button" disabled={coolingDown} onClick={() => { void request.retry(); }}>{coolingDown ? `${formatWait(state.retrySeconds)} 후 다시 시도` : "다시 시도"}</button>}</div>}
          <fieldset className={styles.fieldset} disabled={busy} aria-describedby="area-hint"><legend>관심 영역</legend>
            <div className={styles.areas}>
              <label className={styles.option}><input type="checkbox" name="area" checked={selectedAreas.length === 0} onChange={() => { setSelectedAreas([]); setAllPicked(false); setFormError(null); }} /><span>Auto 머핀 <small className={styles.badge}>추천</small></span></label>
              {areaOptions.map(o => <label className={styles.option} key={o.value}><input type="checkbox" name="area" value={o.value} checked={selectedAreas.includes(o.value)} onChange={() => { const next = toggleHomeArea(selectedAreas, o.value); setAllPicked(next.length === 0 && !selectedAreas.includes(o.value)); setSelectedAreas(next); setFormError(null); }} /><span>{o.label}</span></label>)}
            </div>
            <p id="area-hint" className={styles.hint} aria-live="polite">{areaHint(selectedAreas, allPicked)}</p>
          </fieldset>
          <fieldset className={styles.fieldset} disabled={busy}><legend className={styles.srOnly}>설명 방식</legend><div className={styles.depths}>
            {depthOptions.map(o => <label className={styles.option} key={o.value}><input type="radio" name="depth" value={o.value} checked={depth === o.value} onChange={() => setDepth(o.value)} /><span><b>{o.label}</b><small>{o.hint}</small><small className={styles.depthTime}>{o.time}</small></span></label>)}
          </div><p className={styles.depthHelp}><Link href="/compare">같은 질문을 깊이별로 비교해 보기 →</Link></p></fieldset>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <p className={styles.aiDisclosure}>Muffin은 생성형 AI로 여러 자료를 바탕으로 리포트를 작성해요. 투자 권유가 아닌 참고용 정보이며, 내용에 오류가 있을 수 있어요. 출처와 기준일을 함께 확인해 주세요.</p>
        </div>
      </form>

    </div>
  );
}
