"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Area, Depth } from "@/src/agent/schema";
import { createReport } from "@/src/lib/api";
import { saveReport } from "@/src/lib/history";

const areaOptions: { value: Area; label: string }[] = [
  { value: "fx", label: "💵 환율" },
  { value: "etf", label: "📈 ETF" },
  { value: "news", label: "📰 경제뉴스" },
  { value: "rate", label: "🏦 금리" },
  { value: "macro", label: "📊 물가" },
];

const depthOptions: { value: Depth; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "쉽게 핵심만 빠르게" },
  { value: "standard", label: "Standard", hint: "균형 잡힌 핵심과 배경" },
  { value: "deep", label: "Deep Dive", hint: "깊이 있는 리포트로 진지하게" },
];

/**
 * 홈. 질문을 보내면 리포트를 저장함에 넣고 리포트 페이지로 이동합니다.
 * 로딩 중 화면은 "진행상황" 화면의 자리입니다. 스트리밍이 붙으면 tool 단계 목록으로 바뀝니다.
 */
export default function Home() {
  const router = useRouter();
  const [area, setArea] = useState<Area>("etf");
  const [depth, setDepth] = useState<Depth>("standard");
  const [question, setQuestion] = useState("KODEX 200 요즘 어때?");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { report, steps } = await createReport({ question, depth, area });
      const record = saveReport({ question, depth, area }, report, steps);
      router.push(`/report/${record.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="progress" role="status" aria-live="polite">
        <h1>🧁 Muffin이 리포트를 만들고 있어요…</h1>
        <p className="sub">데이터를 확인하고 핵심 포인트를 분석 중이에요.</p>
        <div className="bar" aria-hidden="true"><span /></div>
        <p className="muted">질문: {question}</p>
      </div>
    );
  }

  return (
    <>
      <h1>🧁 오늘 무엇이 궁금하세요?</h1>
      <p className="sub">관심 주제를 고르면 Muffin이 출처와 함께 리포트를 만들어 드려요.</p>

      <form onSubmit={onSubmit}>
        <fieldset>
          <legend>관심 영역</legend>
          <div className="row">
            {areaOptions.map((o) => (
              <label className="chip" key={o.value}>
                <input type="radio" name="area" value={o.value} checked={area === o.value} onChange={() => setArea(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>설명 깊이</legend>
          <div className="row">
            {depthOptions.map((o) => (
              <label className="chip depth" key={o.value}>
                <input type="radio" name="depth" value={o.value} checked={depth === o.value} onChange={() => setDepth(o.value)} />
                <span><b>{o.label}</b><small>{o.hint}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          질문
          <textarea id="question" required maxLength={500} aria-describedby="question-limit" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="예: 오늘 원/달러 환율이 왜 내려갔는지 궁금해요." />
          <small id="question-limit">최대 500자 · {question.length}/500</small>
        </label>
        <button type="submit" disabled={loading || question.trim().length === 0}>✨ 오늘의 Muffin 만들기</button>
      </form>

      {error && <div className="error" role="alert">{error}</div>}
    </>
  );
}
