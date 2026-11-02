/**
 * 관리자 화면: 최근 7일 실행 로그. 리더 관리. 보호는 proxy.ts + 아래 확인 (src/lib/admin-auth.ts).
 * 데이터는 src/lib/admin.ts 의 loadRuns. runs 표 연결 전에는 예시 데이터이고 맨 위에 그렇게 표시합니다.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { labelFor } from "@/src/agent/events";
import { loadRuns, summarizeRuns, WINDOW_DAYS, type LoadedRuns, type RunsSummary } from "@/src/lib/admin";
import { isAdminAuthorized } from "@/src/lib/admin-auth";
import { redactSecrets } from "@/src/lib/redact";
import styles from "./admin.module.css";

export const metadata: Metadata = { title: "실행 로그 · Muffin Lab", robots: { index: false, follow: false } };

const depthLabels: Record<string, string> = { easy: "Easy", standard: "Standard", deep: "Deep Dive" };
const intentLabels: Record<string, string> = { status: "현황", cause: "원인", compare: "비교", decision: "판단 요청", out_of_scope: "범위 밖" };
const failureStages: Record<string, string> = { input: "입력 확인", config: "서비스 설정", agent: "조사 중 오류", started: "중간에 멈춤" };

const kstParts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function kst(iso: string): string {
  const p = Object.fromEntries(kstParts.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "-");
const count = (n: number) => n.toLocaleString("ko-KR");

export default async function AdminPage() {
  // proxy.ts 가 먼저 막습니다. matcher 가 바뀌어도 열리지 않게 여기서 한 번 더 확인합니다.
  if (!isAdminAuthorized((await headers()).get("authorization"))) notFound();

  const now = new Date();
  let loaded: LoadedRuns;
  try {
    loaded = await loadRuns(now);
  } catch (err) {
    const reason = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 200);
    return (
      <div className={styles.page}>
        <h1>🛠️ 실행 로그</h1>
        <p className={styles.alert} role="alert">
          실행 로그를 불러오지 못했습니다. Supabase 프로젝트가 일시 정지됐는지 확인한 뒤 새로고침하세요. ({reason})
        </p>
      </div>
    );
  }
  const s = summarizeRuns(loaded.rows, now);

  return (
    <div className={styles.page}>
      <header>
        <h1>🛠️ 실행 로그</h1>
        <p className={styles.sub}>
          최근 {WINDOW_DAYS}일 · {kst(s.since)} ~ {kst(s.until)} (한국 시간)
        </p>
      </header>
      {loaded.source === "sample" && (
        <p className={styles.notice} role="note">
          예시 데이터입니다. 실제 요청이 아닙니다. 실행 로그 DB(runs 표)가 연결되면 실제 기록으로 바뀝니다.
        </p>
      )}
      {s.total === 0 && s.limited === 0 ? <Empty /> : <Summary s={s} />}
    </div>
  );
}

function Empty() {
  return (
    <section className={styles.section}>
      <h2>아직 기록이 없습니다</h2>
      <p className={styles.note}>최근 {WINDOW_DAYS}일 동안 들어온 요청이 없습니다. 홈에서 리포트를 하나 만들면 여기에 쌓입니다.</p>
    </section>
  );
}

function Card({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={styles.card}>
      <small>{label}</small>
      <b>{value}</b>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function Summary({ s }: { s: RunsSummary }) {
  const excluded = [s.limited ? `호출 제한 ${count(s.limited)}건` : "", s.mock ? `Mock ${count(s.mock)}건` : ""].filter(Boolean).join(" · ");
  return (
    <>
      <section className={styles.section} aria-labelledby="overview">
        <h2 id="overview">한눈에</h2>
        <div className={styles.cards}>
          <Card label="요청" value={`${count(s.total)}건`} detail={`성공 ${count(s.ok)} · 실패 ${count(s.failed)}${excluded ? ` (${excluded} 제외)` : ""}`} />
          <Card label="성공률" value={percent(s.ok, s.total)} detail="호출 제한 · Mock 제외" />
          <Card label="응답 시간 (리포트)" value={s.time ? `평균 ${seconds(s.time.avgMs)}` : "-"} detail={s.time ? `90%가 ${seconds(s.time.p90Ms)} 안에 끝남` : undefined} />
          <Card label="토큰 (리포트당 평균)" value={s.tokens ? `${count(s.tokens.input + s.tokens.output)}` : "-"} detail={s.tokens ? `입력 ${count(s.tokens.input)} · 출력 ${count(s.tokens.output)}` : undefined} />
        </div>
        <p className={styles.note}>응답 시간 · 토큰 · 검증은 리포트를 만든 요청만 셉니다. 범위 밖 질문은 분류만 하고 끝나서 뺐습니다.</p>
      </section>

      {s.verification && (
        <section className={styles.section} aria-labelledby="verification">
          <h2 id="verification">✅ 검증</h2>
          <div className={styles.cards}>
            <Card label="통과" value={percent(s.verification.pass, s.verification.checked)} detail={`${count(s.verification.pass)} / ${count(s.verification.checked)}건`} />
            <Card label="다시 쓰기" value={percent(s.verification.rewritten, s.verification.checked)} detail={`${count(s.verification.rewritten)}건`} />
            <Card label="확인 못 한 숫자" value={`${count(s.verification.unverified)}개`} detail={`숫자 ${count(s.verification.numbers)}개 중`} />
            <Card label="남은 권유 표현" value={`${count(s.verification.advice)}건`} detail="목표 0" />
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="depths">
        <h2 id="depths">깊이별 응답 시간</h2>
        {s.byDepth.length ? (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">깊이</th><th scope="col" className={styles.num}>요청</th><th scope="col" className={styles.num}>평균</th><th scope="col" className={styles.num}>90%</th></tr>
              </thead>
              <tbody>
                {s.byDepth.map((d) => (
                  <tr key={d.depth}>
                    <td>{depthLabels[d.depth] ?? d.depth}</td>
                    <td className={styles.num}>{count(d.count)}</td>
                    <td className={styles.num}>{seconds(d.avgMs)}</td>
                    <td className={styles.num}>{seconds(d.p90Ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.note}>성공한 요청이 없습니다.</p>
        )}
        {s.intents.length > 0 && (
          <p className={styles.note}>
            의도별 요청: {s.intents.map((x) => `${intentLabels[x.intent] ?? x.intent} ${count(x.count)}`).join(" · ")}
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="tools">
        <h2 id="tools">🔍 tool 별</h2>
        {s.tools.length ? (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">tool</th><th scope="col" className={styles.num}>호출</th><th scope="col" className={styles.num}>성공률</th><th scope="col" className={styles.num}>평균 시간</th></tr>
              </thead>
              <tbody>
                {s.tools.map((t) => (
                  <tr key={t.tool}>
                    <td>{labelFor(t.tool)}</td>
                    <td className={styles.num}>{count(t.calls)}</td>
                    <td className={`${styles.num} ${t.ok / t.calls < 0.9 ? styles.bad : ""}`}>{percent(t.ok, t.calls)}</td>
                    <td className={styles.num}>{seconds(t.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.note}>tool 호출 기록이 없습니다.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="failures">
        <h2 id="failures">최근 실패</h2>
        {s.failures.length ? (
          <ul className={styles.failures}>
            {s.failures.map((f) => (
              <li key={f.id}>
                <p className={styles.failureMeta}>
                  <time dateTime={f.at}>{kst(f.at)}</time> · {failureStages[f.stage] ?? f.stage}
                </p>
                <p className={styles.failureQuestion}>{f.question || "질문 없음"}</p>
                {f.error && <p className={styles.failureError}>{f.error}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>최근 {WINDOW_DAYS}일 동안 실패한 요청이 없습니다.</p>
        )}
      </section>
    </>
  );
}
