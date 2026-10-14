import type { ToolStep } from "@/src/agent/context";
import { labelFor } from "@/src/agent/events";
import type { Area, Report } from "@/src/agent/schema";

export const areaLabels: Record<Area, string> = {
  fx: "환율",
  etf: "ETF",
  news: "경제뉴스",
  rate: "금리",
  macro: "물가",
};

/** change 문자열에서 방향을 읽어 색을 정합니다. "-3.61%" → down, "+0.43%" → up */
function direction(change: string): "up" | "down" | "flat" {
  if (/[-−]\s*\d/.test(change)) return "down";
  if (/[+▲]\s*\d/.test(change)) return "up";
  return "flat";
}

/**
 * 리포트 한 장. 홈과 리포트 상세가 같이 씁니다.
 * 프론트 팀은 이 컴포넌트를 기준으로 디자인을 올리면 됩니다. 데이터 모양은 src/agent/schema.ts.
 */
export function ReportView({ report, steps, area }: { report: Report; steps?: ToolStep[]; area?: Area }) {
  return (
    <div className="report">
      <section>
        <h2>한입 요약</h2>
        <p>{report.summary}</p>
      </section>

      <section>
        <h2>오늘의 숫자</h2>
        <div className="numbers">
          {report.numbers.map((n, i) => (
            <div className="num" key={i}>
              <small>{n.label}</small>
              <b>{n.value}</b>
              <i className={direction(n.change)}>{n.change}{n.asOf ? ` · ${n.asOf}` : ""}</i>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>왜 그럴까요?</h2>
        {report.why.length === 0 ? (
          <p className="muted">이 질문의 원인을 설명할 데이터가 아직 없습니다. 아래 「확인하지 못한 것」을 보세요.</p>
        ) : (
          <ul>
            {report.why.map((w, i) => (
              <li key={i}>
                {w.claim}
                <br />
                <small className="evidence">근거: {w.evidence}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>{area ? `내가 선택한 ${areaLabels[area]}에 무슨 영향인가요?` : "나에게 미치는 영향"}</h2>
        <ul>{report.impact.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </section>

      <section>
        <h2>출처</h2>
        <ul>
          {report.sources.map((s, i) => (
            <li key={i}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> · {s.asOf}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>더해볼 것</h2>
        <div className="chips">{report.nextTopics.map((t, i) => <span className="chip-static" key={i}>{t}</span>)}</div>
      </section>

      {(report.caveats.length > 0 || report.dataGaps.length > 0) && (
        <section className="fine">
          {report.caveats.length > 0 && (
            <>
              <h2>주의점</h2>
              <ul>{report.caveats.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </>
          )}
          {report.dataGaps.length > 0 && (
            <>
              <h2>확인하지 못한 것</h2>
              <ul>{report.dataGaps.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </>
          )}
        </section>
      )}

      {steps && steps.length > 0 && (
        <section className="fine">
          <h2>사용한 Tool</h2>
          <ul>
            {steps.map((s, i) => (
              <li key={i}>
                {s.status === "ok" ? "✅" : "❌"} {labelFor(s.tool)} · {s.ms}ms{s.error ? ` · ${s.error}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
