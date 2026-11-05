"use client";

/**
 * 리플레이 화면의 클라이언트 부분 (리더, 시연용). page.tsx 가 ?id · ?speed 를 넘겨 줍니다.
 * 녹화된 실제 실행(src/replays)을 /api/report/stream 에 { replay, speed } 로 요청해 같은 이벤트를 같은 간격으로 받고,
 * 다섯 단계 진행과 리포트를 그대로 보여 줍니다. OpenAI 와 데이터 API 를 부르지 않습니다. 녹화 시각을 위에 밝혀 "지금 값" 처럼 보이지 않게 합니다.
 * 저장함에는 넣지 않습니다.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { areaLabels, ReportView } from "@/app/components/ReportView";
import { labelFor, stageLabels, stages, type MuffinEvent, type Stage } from "@/src/agent/events";
import { formatAge } from "@/src/lib/age";
import { streamReport, type ReportResponse } from "@/src/lib/api";
import { defaultSpeed, recordedLabel, type ReplayMeta } from "@/src/lib/replay-meta";
import manifest from "@/src/replays/manifest.json";
import styles from "./replay.module.css";

const depthLabels = { easy: "Easy", standard: "Standard", deep: "Deep Dive" } as const;
const intentLabels: Record<string, string> = { status: "현황", cause: "원인", compare: "비교", decision: "판단 요청", out_of_scope: "범위 밖" };
const speeds = [1, 2, 4];
const list = manifest as ReplayMeta[];

type StageState = "pending" | "active" | "done";

/** 단계 이벤트에서 단계별 상태 */
function stageStates(events: MuffinEvent[]): Record<Stage, StageState> {
  const state = Object.fromEntries(stages.map((s) => [s, "pending"])) as Record<Stage, StageState>;
  for (const e of events) if (e.type === "stage") state[e.stage] = e.status === "done" ? "done" : "active";
  return state;
}

export function Replay({ initialId, initialSpeed }: { initialId?: string; initialSpeed?: number }) {
  const [selected, setSelected] = useState<ReplayMeta | null>(null);
  const [speed, setSpeed] = useState(1);
  const [events, setEvents] = useState<MuffinEvent[]>([]);
  const [result, setResult] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // 재생 중 다른 녹화를 누르면 앞의 스트림 이벤트는 버립니다
  const runId = useRef(0);

  const play = useCallback(async (meta: ReplayMeta, rate: number) => {
    const my = ++runId.current;
    setSelected(meta);
    setSpeed(rate);
    setEvents([]);
    setResult(null);
    setError(null);
    setPlaying(true);
    try {
      const r = await streamReport({ replay: meta.id, speed: rate }, (e) => {
        if (runId.current === my) setEvents((prev) => [...prev, e]);
      });
      if (runId.current === my) setResult(r);
    } catch (err) {
      if (runId.current === my) setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      if (runId.current === my) setPlaying(false);
    }
  }, []);

  // ?id=…&speed=… 로 열면 바로 재생. 없는 id 는 목록 위에 알립니다
  const wantedMeta = initialId ? list.find((m) => m.id === initialId) : undefined;
  const missing = initialId && !wantedMeta ? `없는 녹화입니다: ${initialId}` : null;
  useEffect(() => {
    if (!wantedMeta) return;
    // 렌더 직후가 아니라 다음 틱에 시작합니다 (effect 안의 동기 setState 를 피함)
    const timer = setTimeout(() => void play(wantedMeta, initialSpeed || defaultSpeed(wantedMeta)), 0);
    return () => clearTimeout(timer);
  }, [wantedMeta, initialSpeed, play]);

  if (!selected) {
    return (
      <>
        <h1>🎞️ 리플레이</h1>
        <p className="sub">실제로 돌린 실행을 그대로 다시 보여 줍니다. OpenAI 와 데이터 API 를 부르지 않습니다.</p>
        {(missing ?? error) && <div className="error" role="alert">{missing ?? error}</div>}
        {list.length === 0 ? (
          <p className="muted">녹화가 없습니다. <code>pnpm replay:record --question &quot;…&quot; --area etf</code> 로 녹화하세요.</p>
        ) : (
          <ul className={styles.list}>
            {list.map((m) => (
              <li key={m.id} className={styles.item}>
                <p className={styles.question}>{m.question}</p>
                <div className="chips">
                  {m.area && <span className="chip-static">{areaLabels[m.area]}</span>}
                  <span className="chip-static">{depthLabels[m.depth]}</span>
                  <span className="chip-static muted">{recordedLabel(m.recordedAt)} 실행 · {(m.ms / 1000).toFixed(0)}초</span>
                  <span className="chip-static muted">{m.id}</span>
                </div>
                <div className={styles.actions}>
                  {speeds.map((s) => (
                    <button key={s} type="button" className={s === defaultSpeed(m) ? "" : styles.secondary} onClick={() => void play(m, s)}>
                      ▶ {s}배속
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  const state = stageStates(events);
  const plan = events.find((e): e is Extract<MuffinEvent, { type: "plan" }> => e.type === "plan");
  const steps = events.flatMap((e) => (e.type === "step" ? [e.step] : []));
  const verify = events.find((e): e is Extract<MuffinEvent, { type: "verify" }> => e.type === "verify");

  return (
    <>
      <p className={styles.banner} role="note">
        🎞️ 저장된 실행 다시 보기 · {recordedLabel(selected.recordedAt)} 에 실제로 돌린 것 · {speed}배속 · 지금 데이터가 아닙니다
      </p>
      <div className="report-head">
        <h1>{result ? "Today's Muffin" : "🧁 Muffin이 리포트를 만들고 있어요…"}</h1>
        <div className="chips">
          {selected.area && <span className="chip-static">{areaLabels[selected.area]}</span>}
          <span className="chip-static">{depthLabels[selected.depth]}</span>
        </div>
        <p className="sub">{selected.question}</p>
      </div>

      <ol className={styles.stages} aria-label="진행 단계">
        {stages.map((s) => (
          <li key={s} className={`${styles.stage} ${styles[state[s]]}`}>
            <span className={styles.stageMark} aria-hidden="true">{state[s] === "done" ? "✓" : state[s] === "active" ? "…" : ""}</span>
            <span>{stageLabels[s]}</span>
            {s === "plan" && plan && (
              <small>
                {intentLabels[plan.intent] ?? plan.intent}{plan.tools.length ? ` · ${plan.tools.map(labelFor).join(" · ")}` : ""}
              </small>
            )}
            {s === "research" && steps.length > 0 && (
              <ul className={styles.steps}>
                {steps.map((st, i) => (
                  <li key={i}>
                    {st.status === "ok" ? (st.fallbackAgeMs === undefined ? "✅" : "🟡") : "❌"} {labelFor(st.tool)} · {st.ms}ms
                    {st.fallbackAgeMs !== undefined ? ` · 저장된 응답(${formatAge(st.fallbackAgeMs)} 전)` : ""}
                    {st.error ? ` · ${st.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {s === "verify" && verify && (
              <small>
                숫자 {verify.verification.numbers.verified + verify.verification.numbers.derived}/{verify.verification.numbers.total} · 권유 {verify.verification.advice} · 다시 쓰기 {verify.verification.revisions}
              </small>
            )}
          </li>
        ))}
      </ol>

      {error && <div className="error" role="alert">{error}</div>}
      {playing && !result && (
        <div className="progress" role="status" aria-live="polite">
          <div className="bar" aria-hidden="true"><span /></div>
        </div>
      )}
      {result && <ReportView report={result.report} steps={result.steps} area={selected.area} />}

      <div className={styles.actions}>
        <button type="button" onClick={() => void play(selected, speed)} disabled={playing}>↻ 다시 재생</button>
        <Link href="/replay" className={styles.linkButton} onClick={() => { runId.current += 1; setSelected(null); setResult(null); setEvents([]); setPlaying(false); }}>
          목록으로
        </Link>
      </div>
    </>
  );
}
