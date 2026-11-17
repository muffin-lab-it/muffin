import Link from "next/link";
import { formatCost } from "@/src/lib/pricing";
import { QUALITY_FACTS, type OpsPoint, type WeeklyPoint } from "@/src/lib/quality";
import styles from "./quality.module.css";

const kst = (iso: string, withTime = false) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(iso));
const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
const sec = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)}초`);

const EXAMPLES = ["요즘 원달러 환율이 왜 이렇게 움직여?", "KODEX 200 지금 사도 돼?", "최근 소비자물가 상승 원인은 뭐야?"];

/** 서버 컴포넌트. 숫자만 받아 그립니다 (테스트는 renderToStaticMarkup) */
export function QualityView({ weekly, ops, generatedAt }: { weekly: WeeklyPoint[]; ops: OpsPoint | null; generatedAt: string }) {
  const recent = weekly.slice(-6);
  const labels = [...new Set(recent.flatMap((p) => p.metrics.map((m) => m.label)))];
  const f = QUALITY_FACTS;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>MUFFIN LAB · 심사용 공개 페이지</p>
        <h1>머핀 품질 숫자</h1>
        <p className="sub">머핀은 숫자를 지어내지 않고, 원인에는 근거를 붙이고, 판단은 사용자에게 맡깁니다. 그 약속을 매주 같은 질문으로 재서 여기에 숫자로 둡니다. 비밀번호 없이 볼 수 있고, 집계 숫자만 있으며 질문 원문은 없습니다. 한 시간마다 갱신됩니다.</p>
      </header>

      <section className={styles.section} aria-labelledby="q-weekly">
        <h2 id="q-weekly">1. 주간 자동 평가</h2>
        <p className={styles.note}>매주 금요일 아침 GitHub Actions 가 같은 19문항을 실제 모델 · 실제 데이터로 돌리고, 코드가 채점합니다. 기준에 못 미치면 이슈가 자동으로 열립니다.</p>
        {recent.length === 0 ? (
          <p className={styles.empty}>아직 기록이 없습니다. 매주 금요일 아침에 자동으로 쌓입니다.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">지표</th>
                  {recent.map((p) => (
                    <th key={p.at} scope="col">{kst(p.at)}<small>{p.questions}문항{p.errors ? ` · 오류 ${p.errors}` : ""}</small></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.map((label) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {recent.map((p) => {
                      const m = p.metrics.find((x) => x.label === label);
                      if (!m) return <td key={p.at}>-</td>;
                      return (
                        <td key={p.at} className={m.ok === false ? styles.bad : m.ok ? styles.good : undefined}>
                          {pct(m.rate)}<small>{m.pass}/{m.total}{m.threshold !== null ? ` · 기준 ${Math.round(m.threshold * 100)}%` : ""}</small>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row">리포트 평균 시간</th>
                  {recent.map((p) => <td key={p.at}>{sec(p.avgMs)}</td>)}
                </tr>
                <tr>
                  <th scope="row">모든 지표 기준 안</th>
                  {recent.map((p) => <td key={p.at} className={p.allOk === false ? styles.bad : p.allOk ? styles.good : undefined}>{p.allOk === null ? "-" : p.allOk ? "예" : "아니오"}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="q-baseline">
        <h2 id="q-baseline">2. tool 과 검증이 더한 것 (기준선 비교)</h2>
        <p className={styles.note}>같은 {f.baselineQuestions}문항을 같은 모델에게 tool · 증거 장부 · 검증 없이 물은 답과 머핀 리포트를 같은 잣대로 쟀습니다 ({f.baselineAsOf} 실측).</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th scope="col">지표</th><th scope="col">tool 없는 같은 모델</th><th scope="col">머핀</th></tr></thead>
            <tbody>
              {f.baseline.map((b) => (
                <tr key={b.label}><th scope="row">{b.label}</th><td>{b.without}</td><td className={styles.good}>{b.muffin}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="q-ops">
        <h2 id="q-ops">3. 운영 최근 7일</h2>
        <p className={styles.note}>배포된 사이트에서 실제로 만들어진 리포트의 집계입니다. 연습 · 재생은 뺍니다.{ops?.truncated ? " 7일치가 한 번에 읽는 상한을 넘어 최신 기록만 집계했습니다." : ""}</p>
        {!ops ? (
          <p className={styles.empty}>실행 기록을 지금 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
        ) : (
          <dl className={styles.tiles}>
            <div><dt>리포트</dt><dd>{ops.reports}건</dd></div>
            <div><dt>성공률</dt><dd>{pct(ops.successRate)}</dd></div>
            <div><dt>응답 시간 p90</dt><dd>{sec(ops.p90Ms)}<small>예산 55초</small></dd></div>
            <div><dt>평균 응답</dt><dd>{sec(ops.avgMs)}</dd></div>
            <div><dt>리포트당 비용</dt><dd>{ops.cost ? formatCost(ops.cost) : "-"}<small>모델별 토큰 × 단가</small></dd></div>
          </dl>
        )}
      </section>

      <section className={styles.section} aria-labelledby="q-build">
        <h2 id="q-build">4. 만든 것 ({f.asOf} 기준)</h2>
        <dl className={styles.tiles}>
          <div><dt>테스트</dt><dd>{f.tests.toLocaleString("ko-KR")}개<small>API 키 없이 CI 통과</small></dd></div>
          <div><dt>머지한 PR</dt><dd>{f.mergedPrs}개<small>6명 · 10/2 ~</small></dd></div>
          <div><dt>Codex 리뷰</dt><dd>{f.codexReviewedPrs}개 PR<small>지적 {f.codexFindingsFixed}건 반영</small></dd></div>
          <div><dt>근거 판정 정확도</dt><dd>{f.judgeAccuracy}%<small>사람이 매긴 정답 쌍 {f.judgePairs}개</small></dd></div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="q-try">
        <h2 id="q-try">5. 직접 확인하기</h2>
        <ul className={styles.links}>
          <li><Link href="/">홈</Link> — 질문을 넣고 리포트를 받습니다. 리포트 위의 &lsquo;검증이 한 일 보기&rsquo; 에서 숫자 대조 내역을 펼칠 수 있습니다.</li>
          <li><Link href="/compare">깊이별 비교</Link> — 같은 질문을 Easy · Deep 으로 나란히, 실시간 또는 녹화.</li>
          <li><Link href="/replay">녹화 재생</Link> — 실제 실행을 그대로 다시 봅니다. 모델 호출 없음.</li>
        </ul>
        <p className={styles.note}>바로 써 볼 질문: {EXAMPLES.map((q, i) => <span key={q}>{i ? " · " : ""}<q>{q}</q></span>)}</p>
      </section>

      <footer className={styles.foot}>
        <p>자료: evals 표(주간 평가) · runs 표(실행 기록 집계) · docs/eval/baseline(기준선) · GitHub muffin-lab-it/muffin. 생성 {kst(generatedAt, true)} (한국 시간). 리포트는 투자 권유가 아니며 모든 화면에 AI 생성 고지가 붙습니다.</p>
      </footer>
    </div>
  );
}
