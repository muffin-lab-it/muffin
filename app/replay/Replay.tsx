"use client";

/**
 * 리플레이 화면의 클라이언트 부분 (리더, 시연용). page.tsx 가 ?id · ?speed 를 넘겨 줍니다.
 * 녹화된 실제 실행(src/replays)을 /api/report/stream 에 { replay, speed } 로 요청해 같은 이벤트를 같은 간격으로 받고,
 * 다섯 단계 진행과 리포트를 그대로 보여 줍니다. OpenAI 와 데이터 API 를 부르지 않습니다. 녹화 시각을 위에 밝혀 "지금 값" 처럼 보이지 않게 합니다.
 * 저장함에는 넣지 않습니다.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Progress } from "@/app/components/Progress";
import { areaLabels, ReportView } from "@/app/components/ReportView";
import type { MuffinEvent } from "@/src/agent/events";
import { streamReport, type ReportResponse } from "@/src/lib/api";
import { defaultSpeed, recordedLabel, type ReplayMeta } from "@/src/lib/replay-meta";
import manifest from "@/src/replays/manifest.json";
import styles from "./replay.module.css";

const depthLabels = { easy: "Easy", standard: "Standard", deep: "Deep Dive" } as const;
const speeds = [1, 2, 4];
const list = manifest as ReplayMeta[];

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
  const missing = initialId && !wantedMeta ? `없는 녹화예요: ${initialId}` : null;
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
        <p className="sub">실제로 돌린 실행을 그대로 다시 보여 줘요. OpenAI 와 데이터 API 를 부르지 않아요.</p>
        {(missing ?? error) && <div className="error" role="alert">{missing ?? error}</div>}
        {list.length === 0 ? (
          <p className="muted">녹화가 없어요. <code>pnpm replay:record --question &quot;…&quot; --area etf</code> 로 녹화하세요.</p>
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

  // 홈과 같은 진행 화면(2열 · 가로 단계 · 그림 옆 머핀 이야기)을 씁니다. 11/23: 다시 보기만 예전 세로 단계 목록이라 설명서의 재생 링크와 홈 모양이 달랐음.
  // muffin-home 은 본문 틀을 홈처럼 넓히는 공용 클래스입니다 (globals.css)
  return (
    <div className={`muffin-home ${styles.playing}`} data-done={result ? "true" : undefined}>
      <p className={styles.banner} role="note">
        🎞️ 저장된 실행 다시 보기 · {recordedLabel(selected.recordedAt)} 에 실제로 돌린 것 · {speed}배속 · 지금 데이터가 아니에요
      </p>
      {error && <div className="error" role="alert">{error}</div>}
      {!result && !error && <Progress question={selected.question} depth={selected.depth} events={events} pending={playing && events.length === 0} />}
      {result && (
        <ReportView report={result.report} steps={result.steps} area={selected.area} question={selected.question} createdAt={selected.recordedAt} header={<div className="report-head">
          <div className="chips">
            {selected.area && <span className="category-chip" data-category={selected.area === "news" ? "뉴스" : areaLabels[selected.area]}>{areaLabels[selected.area]}</span>}
            <span className="depth-chip" data-depth={selected.depth}>{depthLabels[selected.depth]}</span>
          </div>
        </div>} />
      )}

      <div className={styles.actions}>
        <button type="button" onClick={() => void play(selected, speed)} disabled={playing}>↻ 다시 재생</button>
        <Link href="/replay" className={styles.linkButton} onClick={() => { runId.current += 1; setSelected(null); setResult(null); setEvents([]); setPlaying(false); }}>
          목록으로
        </Link>
      </div>
    </div>
  );
}
