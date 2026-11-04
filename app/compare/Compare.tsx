"use client";

/**
 * 깊이별 비교 화면의 클라이언트 부분 (리더, 시연용). 열마다 하나의 스트림(녹화 재생 또는 실시간)을 받아 은선님의 진행 화면(Progress)과
 * 리포트(ReportView)를 그리고, 다 끝나면 "차이 한눈에" 표(src/lib/compare.ts)를 보여 줍니다. 저장함에는 넣지 않습니다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Progress } from "@/app/components/Progress";
import { areaLabels, ReportView } from "@/app/components/ReportView";
import type { MuffinEvent } from "@/src/agent/events";
import type { Area, Depth } from "@/src/agent/schema";
import { streamReport, type ReportResponse } from "@/src/lib/api";
import { depthHints, depthLabels, depthOrder, formatStat, groupByQuestion, reportStats, statLabels, statOrder, type CompareGroup } from "@/src/lib/compare";
import { recordedLabel, type ReplayMeta } from "@/src/lib/replay-meta";
import manifest from "@/src/replays/manifest.json";
import styles from "./compare.module.css";

const groups = groupByQuestion(manifest as ReplayMeta[]);
const areaOptions: Area[] = ["fx", "etf", "news", "rate", "macro"];
const speeds = [1, 2, 4];

type Column = { depth: Depth; replay?: ReplayMeta; events: MuffinEvent[]; result?: ReportResponse; error?: string; startedAt: number; ms?: number };
type Session = { question: string; area?: Area; mode: "replay" | "live"; columns: Column[]; speed: number };

export function Compare({ initialQuestion, initialSpeed }: { initialQuestion?: string; initialSpeed?: number }) {
  const [session, setSession] = useState<Session | null>(null);
  const [liveQuestion, setLiveQuestion] = useState("요즘 원달러 환율이 왜 이렇게 움직여?");
  const [liveArea, setLiveArea] = useState<Area>("fx");
  const [liveDepths, setLiveDepths] = useState<Depth[]>(["easy", "deep"]);
  const runId = useRef(0);

  const start = useCallback(async (next: Session) => {
    const my = ++runId.current;
    setSession(next);
    const update = (i: number, patch: (c: Column) => Column) => {
      if (runId.current !== my) return;
      setSession((s) => (s ? { ...s, columns: s.columns.map((c, k) => (k === i ? patch(c) : c)) } : s));
    };
    await Promise.all(
      next.columns.map(async (col, i) => {
        try {
          const r = await streamReport(
            next.mode === "replay" && col.replay ? { replay: col.replay.id, speed: next.speed } : { question: next.question, depth: col.depth, ...(next.area ? { area: next.area } : {}) },
            (e) => update(i, (c) => ({ ...c, events: [...c.events, e] })),
          );
          update(i, (c) => ({ ...c, result: r, ms: next.mode === "replay" ? (col.replay?.ms ?? null) ?? undefined : Date.now() - c.startedAt }));
        } catch (err) {
          update(i, (c) => ({ ...c, error: err instanceof Error ? err.message : "알 수 없는 오류" }));
        }
      }),
    );
  }, []);

  const playGroup = useCallback(
    (g: CompareGroup, speed: number) => {
      const columns: Column[] = depthOrder.flatMap((d) => (g.replays[d] ? [{ depth: d, replay: g.replays[d], events: [], startedAt: Date.now() }] : []));
      void start({ question: g.question, ...(g.area ? { area: g.area } : {}), mode: "replay", columns, speed });
    },
    [start],
  );

  // ?question=… 으로 열면 그 질문의 녹화를 바로 재생
  const wanted = initialQuestion ? groups.find((g) => g.question === initialQuestion.trim()) : undefined;
  const missing = initialQuestion && !wanted ? `녹화가 없는 질문입니다: ${initialQuestion}` : null;
  useEffect(() => {
    if (!wanted) return;
    const timer = setTimeout(() => playGroup(wanted, initialSpeed || 4), 0);
    return () => clearTimeout(timer);
  }, [wanted, initialSpeed, playGroup]);

  if (!session) {
    return (
      <>
        <h1>🔀 깊이별 비교</h1>
        <p className="sub">같은 질문을 Easy · Standard · Deep Dive 로 만든 리포트를 나란히 봅니다. 녹화는 모델 호출 없이, 실시간은 실제로 만듭니다.</p>
        {missing && <div className="error" role="alert">{missing}</div>}
        <h2 className={styles.h2}>녹화에서 보기</h2>
        {groups.length === 0 ? (
          <p className="muted">같은 질문을 두 깊이 이상 녹화한 것이 없습니다. <code>pnpm replay:record --depth easy</code> 와 <code>--depth deep</code> 으로 녹화하세요.</p>
        ) : (
          <ul className={styles.list}>
            {groups.map((g) => (
              <li key={g.question} className={styles.item}>
                <p className={styles.question}>{g.question}</p>
                <div className="chips">
                  {g.area && <span className="chip-static">{areaLabels[g.area]}</span>}
                  {depthOrder.filter((d) => g.replays[d]).map((d) => (
                    <span key={d} className="chip-static">{depthLabels[d]} · {recordedLabel(g.replays[d]!.recordedAt)}</span>
                  ))}
                </div>
                <div className={styles.actions}>
                  {speeds.map((s) => (
                    <button key={s} type="button" className={s === 4 ? "" : styles.secondary} onClick={() => playGroup(g, s)}>▶ {s}배속</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <h2 className={styles.h2}>실시간으로 만들기</h2>
        <form
          className={styles.liveForm}
          onSubmit={(e) => {
            e.preventDefault();
            const columns: Column[] = depthOrder.filter((d) => liveDepths.includes(d)).map((d) => ({ depth: d, events: [], startedAt: Date.now() }));
            if (columns.length < 2 || !liveQuestion.trim()) return;
            void start({ question: liveQuestion.trim(), area: liveArea, mode: "live", columns, speed: 1 });
          }}
        >
          <label>
            질문
            <textarea value={liveQuestion} maxLength={500} onChange={(e) => setLiveQuestion(e.target.value)} />
          </label>
          <div className="row">
            {areaOptions.map((a) => (
              <label className="chip" key={a}>
                <input type="radio" name="area" value={a} checked={liveArea === a} onChange={() => setLiveArea(a)} />
                <span>{areaLabels[a]}</span>
              </label>
            ))}
          </div>
          <div className="row">
            {depthOrder.map((d) => (
              <label className="chip" key={d}>
                <input type="checkbox" checked={liveDepths.includes(d)} onChange={(e) => setLiveDepths((prev) => (e.target.checked ? depthOrder.filter((x) => x === d || prev.includes(x)) : prev.filter((x) => x !== d)))} />
                <span>{depthLabels[d]}</span>
              </label>
            ))}
          </div>
          <button type="submit" disabled={liveDepths.length < 2 || liveQuestion.trim().length === 0}>✨ 깊이별로 만들기 (실제 호출, 깊이 둘 이상)</button>
        </form>
      </>
    );
  }

  const done = session.columns.every((c) => c.result || c.error);
  const finished = session.columns.filter((c) => c.result);
  return (
    <>
      {session.mode === "replay" ? (
        <p className={styles.banner} role="note">🎞️ 저장된 실행 다시 보기 · {session.columns.map((c) => `${depthLabels[c.depth]} ${c.replay ? recordedLabel(c.replay.recordedAt) : ""}`).join(" · ")} · {session.speed}배속 · 지금 데이터가 아닙니다</p>
      ) : (
        <p className={styles.banner} role="note">실시간으로 만드는 중 · 깊이마다 따로 OpenAI 와 데이터 API 를 부릅니다</p>
      )}
      <div className="report-head">
        <h1>깊이별 비교</h1>
        <div className="chips">{session.area && <span className="chip-static">{areaLabels[session.area]}</span>}</div>
        <p className="sub">{session.question}</p>
      </div>

      <div className={styles.columns} style={{ ["--cols" as string]: session.columns.length }}>
        {session.columns.map((c) => (
          <section key={c.depth} className={styles.col} aria-label={depthLabels[c.depth]}>
            <header className={styles.colHead}>
              <b>{depthLabels[c.depth]}</b>
              <small>{depthHints[c.depth]}</small>
            </header>
            {c.error && <div className="error" role="alert">{c.error}</div>}
            {!c.result && !c.error && <Progress question={session.question} depth={c.depth} events={c.events} />}
            {c.result && <ReportView report={c.result.report} steps={c.result.steps} area={session.area} />}
          </section>
        ))}
      </div>

      {done && finished.length >= 2 && (
        <section className={styles.stats} aria-label="차이 한눈에">
          <h2>차이 한눈에</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">항목</th>
                {finished.map((c) => (
                  <th key={c.depth} scope="col">{depthLabels[c.depth]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statOrder.map((key) => (
                <tr key={key}>
                  <th scope="row">{statLabels[key]}</th>
                  {finished.map((c) => (
                    <td key={c.depth}>{formatStat(key, reportStats(c.result!.report, c.ms ?? null)[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">글자 수는 요약 · 원인 · 영향 · 주의점의 합입니다. 응답 시간은 녹화면 그때 걸린 시간, 실시간이면 지금 걸린 시간입니다.</p>
        </section>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={() => { runId.current += 1; setSession(null); }}>목록으로</button>
      </div>
    </>
  );
}
