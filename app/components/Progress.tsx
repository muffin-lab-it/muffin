/// <reference types="next/image-types/global" />
"use client";

import { labelFor, stageLabels, stages, type MuffinEvent, type Stage } from "@/src/agent/events";
import { formatWait } from "@/src/lib/age";
import Link from "next/link";
import Image from "next/image";
import stage1 from "../stage-muffin-1.png";
import stage2 from "../stage-muffin-2.png";
import stage3 from "../stage-muffin-3.png";
import stage4 from "../stage-muffin-4.png";
import stage5 from "../stage-muffin-5.png";
const stageImages = [stage1, stage2, stage3, stage4, stage5];
import styles from "./Progress.module.css";
import { FinanceFloaters } from "./FinanceFloaters";
import type { ReactNode } from "react";
import type { Depth } from "@/src/agent/schema";
import { splitAreaPrefix } from "./home-form";

const skippedStages: readonly Stage[] = ["research", "edit", "write"];

type StageStatus = "waiting" | "active" | "done" | "skipped";
export type ProgressError = { message: string; id?: string; status?: number; kind?: "network" | "save"; retryAfterSec?: number };
export type ProgressProps = {
  question: string;
  depth?: Depth;
  /** 제목 옆 장식. 기본은 상단 로고와 같은 머핀 그림(/icon.svg)입니다. */
  titleIcon?: ReactNode;
  /** 한 요청의 이벤트만 전달합니다. 재시도 시 부모에서 초기화합니다. */
  events: readonly MuffinEvent[];
  /** 연결 오류처럼 스트림 밖에서 발생한 실패입니다. */
  error?: ProgressError;
  onRetry?: () => void;
  onEditQuestion?: () => void;
  /** 홈 자체에서 표시할 때 같은 URL 이동 대신 입력 화면으로 돌아갑니다. */
  onReturnHome?: () => void;
  /** 요청은 보냈지만 서버 이벤트가 아직 없는 분류 중 (11/21 QA 8). 첫 단계를 진행 중으로 보여 줍니다 */
  pending?: boolean;
};

/** 실제 이벤트로 화면 상태를 만듭니다. 시간만으로 단계를 진행시키지 않습니다. */
export function progressFromEvents(events: readonly MuffinEvent[]) {
  const status = Object.fromEntries(stages.map(stage => [stage, "waiting"])) as Record<Stage, StageStatus>;
  let plan: Extract<MuffinEvent, { type: "plan" }> | undefined;
  let verification: Extract<MuffinEvent, { type: "verify" }>["verification"] | undefined;
  const steps: Extract<MuffinEvent, { type: "step" }>["step"][] = [];
  let error: ProgressError | undefined;
  let complete = false;
  for (const event of events) {
    if (error || complete) break;
    switch (event.type) {
      case "stage": status[event.stage] = event.status === "start" ? "active" : "done"; break;
      case "plan":
        plan = event;
        if (event.mode === "out_of_scope") {
          for (const stage of skippedStages) status[stage] = "skipped";
        }
        break;
      case "step": steps.push(event.step); break;
      case "verify": verification = event.verification; break;
      case "error": error = { message: event.message, id: event.id }; break;
      case "report":
        complete = true;
        for (const stage of stages) {
          status[stage] = event.report.mode === "out_of_scope" && skippedStages.includes(stage) ? "skipped" : "done";
        }
        break;
    }
  }
  return { status, plan, verification, steps, error, complete };
}

const statusLabels = { waiting: "대기", active: "진행 중", done: "완료", skipped: "건너뜀" };
const activeLabels: Record<Stage, string> = {
  plan: "질문을 살펴보고 있어요", research: "필요한 자료를 찾고 있어요", edit: "핵심 내용을 추리고 있어요", write: "답변을 쓰고 있어요", verify: "숫자와 근거를 확인하고 있어요",
};

const depthCopy: Record<Depth, string> = {
  easy: "어려운 표현을 줄이고 핵심부터 쉽게 정리해 드릴게요.",
  standard: "핵심 내용과 배경을 함께 정리해 드릴게요.",
  deep: "근거와 배경을 더 자세히 살펴 정리해 드릴게요.",
};

/** 상단 로고와 같은 머핀 그림 (11/23 사용자: 진행 화면의 🧁 이모지와 로고 머핀을 통일) */
const brandMuffin = <Image src="/icon.svg" alt="" width={36} height={36} />;

export function Progress({ question, depth, titleIcon = brandMuffin, events, error: connectionError, onRetry, onEditQuestion, onReturnHome, pending = false }: ProgressProps) {
  const state = progressFromEvents(events);
  const shown = splitAreaPrefix(question); // 여러 영역을 고른 질문의 "관심 영역: …" 머리말은 떼어 따로 (11/20 외부 G1)
  const error = connectionError ?? state.error;
  // 분류 중(요청은 갔고 이벤트는 아직)이면 첫 단계를 진행 중으로. 시간만으로 단계를 밀지는 않습니다
  const current = stages.find(stage => state.status[stage] === "active") ?? (pending && !error && !state.complete && events.length === 0 ? "plan" : undefined);
  const scope = state.plan?.mode === "out_of_scope";
  const failed = state.steps.some(step => step.status === "error");
  const timeout = !!error && /시간.*초과/.test(error.message);
  const noRetry = !!error?.status && [400, 403, 413, 503].includes(error.status);
  const waitSeconds = Math.max(0, Math.ceil(error?.retryAfterSec ?? 0));
  const errorTitle = error?.kind === "save" ? "리포트는 완성됐지만 저장하지 못했어요"
    : error?.kind === "network" ? "연결이 끊겨 조사를 멈췄어요"
    : error?.status === 429 ? "요청이 많아요. 잠시 후 다시 시도해 주세요"
    : error?.status === 400 || error?.status === 413 ? "질문을 조금 수정해 주세요"
    : error?.status === 403 ? "이 접속 경로에서는 요청할 수 없어요"
    : error?.status === 503 ? "지금은 리포트 서비스를 이용할 수 없어요"
    : timeout ? "시간이 초과되어 조사를 멈췄어요" : "이번 답변을 완성하지 못했어요";
  const title = error ? errorTitle
    : state.complete ? "리포트가 완성됐어요"
    : scope ? "이 질문은 아직 답하기 어려워요"
    : failed ? "일부 자료를 확인하지 못했어요"
    : "Muffin이 리포트를 만들고 있어요";
  const description = error ? error.kind === "save" ? "완성된 내용은 아래에 남아 있어요. 저장만 다시 시도해 주세요." : noRetry ? "입력한 질문은 그대로 남아 있어요. 아래 안내를 확인해 주세요." : "입력한 질문은 그대로예요. 다시 시도할 수 있어요."
    : scope ? "지금은 환율·ETF·경제뉴스·금리·물가를 다뤄요."
    : failed ? (current === "write" || current === "verify" ? "일부 자료를 찾지 못했지만, 확인한 자료로 작성하고 있어요." : "일부 자료를 찾지 못했어요. 확인한 내용과 한계를 함께 알려드릴게요.")
    : state.complete ? "저장이 끝나면 리포트를 보여드릴게요."
    : "궁금한 내용에 맞춰 자료를 찾고, 이해하기 쉽게 정리해 드릴게요.";
  const announcement = error ? error.kind === "save" ? "생성 완료 · 저장 실패" : "요청을 진행하지 못했어요" : state.complete ? "리포트를 저장하고 있어요" : current ? activeLabels[current] : "조사를 준비하고 있어요";
  // 계획은 실행 중이라는 뜻이 아니며, step은 도구 실행이 끝난 뒤에만 도착합니다.
  const latestStep = state.steps.at(-1);
  const story = error ? error.kind === "save" ? "저장을 다시 시도해도 조사를 새로 시작하지 않아요." : "오류 안내는 자동으로 사라지지 않아요. 입력한 질문을 유지한 채 다음 행동을 선택할 수 있어요."
    : scope ? "지금은 환율·ETF·경제뉴스·금리·물가에 대한 질문을 도와드려요."
    : state.complete ? "완성된 답변을 저장하고 있어요. 잠시만 기다려 주세요."
    : current === "verify" ? "답변의 숫자와 원본 자료가 맞는지 살펴보고 있어요."
    : current === "write" ? "확인한 내용을 읽기 쉬운 답변으로 정리하고 있어요."
    : latestStep ? `${labelFor(latestStep.tool)}: ${latestStep.status === "ok" ? "자료를 확인했어요." : "자료를 확인하지 못했어요."} 아래에서 지금까지의 확인 내역을 볼 수 있어요.`
    : state.plan?.tools.length ? "질문에 맞춰 필요한 자료를 확인할 계획이에요. 잠시만 기다려 주세요."
    : "질문을 살펴보고 있어요. 조사 계획이 도착하면 여기서 알려드릴게요.";
  const verification = state.verification;
  const applicable = stages.filter(stage => state.status[stage] !== "skipped");
  const finished = applicable.filter(stage => state.status[stage] === "done").length;
  const imageIndex = state.complete ? 4 : current ? stages.indexOf(current) : Math.max(0, stages.findLastIndex(stage => state.status[stage] === "done"));
  const percent = state.complete ? 100 : Math.round(finished / applicable.length * 100);

  const storyTitle = state.complete || error ? "확인한 것" : "지금 확인하는 것";
  return (
    <section className={styles.root} aria-label="리포트 생성 진행" data-layout="progress">
      <div className={styles.titleRow}><span className={styles.titleIcon} aria-hidden="true">{titleIcon}</span><h1 className={styles.title} data-tone={timeout || (!error && !state.complete && scope) ? "attention" : undefined} aria-live="polite">{title}</h1></div>
      {/* PC 는 왼쪽에 질문 · 단계, 오른쪽에 그림 · 머핀 이야기 (11/21 하니 1 · 서영 4 · 외부 F15). 휴대폰은 세로 */}
      <div className={styles.layout}>
      <div className={styles.main}>
      <header className={styles.questionBox} data-section="question">
        <p className={styles.questionLabel}>나의 한입 질문</p>
        <blockquote className={styles.question}>“{shown.question}”</blockquote>
        {shown.areas.length > 0 && <p className={styles.questionLabel}>관심 영역 · {shown.areas.join(" · ")}</p>}
      </header>
      <section className={styles.surface} aria-label="현재 진행 상태" data-section="progress">
        <div aria-live="polite" aria-atomic="true">
          <div className={styles.depthRow}>{depth && <span className={styles.depthBadge} data-depth={depth}>{depth === "easy" ? "Easy" : depth === "deep" ? "Deep Dive" : "Standard"}</span>}<p className={styles.description}>{!error && !scope && !state.complete && !failed && depth ? depthCopy[depth] : description}</p></div>
          {!error && !scope && !state.complete && <p className={styles.timing}><span aria-hidden="true">⏱️</span> 최대 1분간 조사해요</p>}
        </div>
        <p className={styles.current} role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        <div className={styles.progressHeading}><span>완료 단계 기준{error ? error.kind === "save" ? " · 저장 실패" : " · 중단됨" : ""}</span><strong>{percent}%</strong></div>
        <div className={styles.track} data-active={!error && !state.complete ? "true" : undefined} role="progressbar" aria-label="완료 단계 기준 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${applicable.length}단계 중 ${finished}단계 완료${error ? ", 조사 중단" : ""}`}><span style={{ width: `${percent}%` }} /></div>

        <ol className={styles.stages} aria-label="리포트가 만들어지는 과정">
          {stages.map((stage) => {
            const status = state.status[stage] === "waiting" && stage === current ? "active" : state.status[stage];
            const interrupted = !!error && status === "active";
            return <li key={stage} className={styles.stage} data-state={interrupted ? "interrupted" : status} aria-current={!error && status === "active" ? "step" : undefined}>
              <span className={styles.marker} aria-hidden="true">{interrupted ? "!" : status === "done" ? "✓" : status === "skipped" ? "—" : ""}</span>
              <span className={styles.label}>{stageLabels[stage]}</span>
              <span className={styles.state}>{interrupted ? "중단" : error && status === "waiting" ? "미실행" : statusLabels[status]}</span>
            </li>;
          })}
        </ol>
        {error && <div className={styles.error}>
          <div role="alert"><p>{error.message}</p></div>
          <div className={styles.actions}>
            {onRetry && !noRetry && <button type="button" disabled={waitSeconds > 0} onClick={onRetry}>{waitSeconds > 0 ? `${formatWait(waitSeconds)} 후 다시 시도` : error.kind === "save" ? "저장 다시 시도" : "다시 시도"}</button>}
            {onEditQuestion && error.kind !== "save" && ![403, 503].includes(error.status ?? 0) && <button type="button" className={styles.secondary} onClick={onEditQuestion}>질문 수정</button>}
            {[403, 503].includes(error.status ?? 0) && (onReturnHome ? <button type="button" onClick={onReturnHome}>홈으로 돌아가기</button> : <Link href="/">홈으로 돌아가기</Link>)}
          </div>
          {error.id && <details className={styles.request}><summary>오류 정보</summary>요청 ID: {error.id}</details>}
        </div>}
      </section>
      </div>
      <div className={styles.side}>
      {/* 11/25 사용자: 진행 화면에도 움직임 — 단계가 바뀌면 그림이 톡 튀어나오고(key 로 다시 그림), 둥실 · 둘레에 금융 그림 */}
      <div className={styles.mascotWrap}>
        <Image key={imageIndex} className={styles.mascot} src={stageImages[imageIndex]} width={200} height={200} sizes="(max-width: 720px) 160px, 200px" alt="" aria-hidden="true" />
        <FinanceFloaters variant="progress" />
      </div>
      {/* 11/25 사용자: '머핀 이야기' 대신 확인하는 일로 부름. 끝나거나 멈추면 '확인한 것' */}
      <aside className={styles.tip} aria-label={storyTitle} data-section="story">
        <div className={styles.storyHeading}><span className={styles.storyIcon} aria-hidden="true"><Image src="/icon.svg" alt="" width={20} height={20} /></span><h2>{storyTitle}</h2></div>
        <p className={styles.story} aria-live="polite">{story}</p>
        {(state.plan || state.steps.length > 0 || verification) && <div className={styles.storyData}>

          {!scope && !!state.plan?.tools.length && <p className={styles.hint}>이렇게 조사할게요: {state.plan.tools.map(labelFor).join(" · ")}</p>}
          {scope && <p className={styles.hint}>지원 범위 밖의 질문이라 자료 찾기·핵심 추리기·답변 쓰기를 건너뛰었어요.</p>}
          {state.steps.length > 0 && <details className={styles.details}><summary>자료 확인 내역 · {state.steps.length}건</summary><ul>{state.steps.map((step, index) => <li key={index}>
            <span>{labelFor(step.tool)}</span><span>{step.status === "ok" ? "확인 완료" : "확인 실패"} · {(step.ms / 1000).toFixed(1)}초</span>
          </li>)}</ul></details>}
          {verification && <div className={styles.note}><p>{verification.status === "skipped" ? "검증이 실행되지 않았어요." : `숫자 ${verification.numbers.total}개 중 ${verification.numbers.verified}개 값 대조 · ${verification.numbers.derived}개 계산값 · ${verification.numbers.reported ?? 0}개 기사 보도 · 권유 표현 ${verification.advice}건`}</p><p className={styles.hint}>값 대조는 원본 값과의 일치 검사이며, 답변 전체의 정확성을 보장하지 않아요.</p></div>}
        </div>}
      </aside>
      </div>
      </div>
    </section>
  );
}
