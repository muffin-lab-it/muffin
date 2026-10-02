"use client";

import { useState } from "react";
import type { Report } from "@/src/agent/schema";

const areaOptions = [
  { value: "fx", label: "💵 환율" },
  { value: "etf", label: "📈 ETF" },
  { value: "news", label: "📰 경제뉴스" },
  { value: "rate", label: "🏦 금리" },
  { value: "macro", label: "📊 물가" },
] as const;

const depthOptions = [
  { value: "easy", label: "Easy" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep Dive" },
] as const;

export default function Home() {
  const [area, setArea] = useState<string>("fx");
  const [depth, setDepth] = useState<string>("standard");
  const [question, setQuestion] = useState("오늘 달러 환율이 얼마야?");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, depth, area }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setReport(json.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>🧁 오늘 무엇이 궁금하세요?</h1>
      <p className="sub">관심 주제를 고르면 Muffin 이 출처와 함께 리포트를 만들어 드려요.</p>

      <form onSubmit={onSubmit}>
        <label>
          관심 영역
          <div className="row">
            {areaOptions.map((o) => (
              <label className="chip" key={o.value}>
                <input type="radio" name="area" value={o.value} checked={area === o.value} onChange={() => setArea(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </label>
        <label>
          설명 깊이
          <div className="row">
            {depthOptions.map((o) => (
              <label className="chip" key={o.value}>
                <input type="radio" name="depth" value={o.value} checked={depth === o.value} onChange={() => setDepth(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </label>
        <label>
          질문
          <textarea id="question" value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button type="submit" disabled={loading}>{loading ? "Muffin 이 리포트를 만들고 있어요…" : "✨ 오늘의 Muffin 만들기"}</button>
      </form>

      {error && <div className="error">{error}</div>}

      {report && (
        <div className="report">
          <section><h2>한입 요약</h2><p>{report.summary}</p></section>
          <section>
            <h2>오늘의 숫자</h2>
            <div className="numbers">
              {report.numbers.map((n, i) => (
                <div className="num" key={i}><small>{n.label}</small><b>{n.value}</b><i>{n.change}</i></div>
              ))}
            </div>
          </section>
          <section><h2>왜 그럴까요?</h2><ul>{report.why.map((w, i) => <li key={i}>{w}</li>)}</ul></section>
          <section><h2>나에게 미치는 영향</h2><ul>{report.impact.map((w, i) => <li key={i}>{w}</li>)}</ul></section>
          <section>
            <h2>출처</h2>
            <ul>{report.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> · {s.asOf}</li>)}</ul>
          </section>
          <section><h2>더해볼 것</h2><p>{report.nextTopics.join(" · ")}</p></section>
        </div>
      )}
    </main>
  );
}
