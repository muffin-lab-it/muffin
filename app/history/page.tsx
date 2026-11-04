"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { areaLabels } from "@/app/components/ReportView";
import { deleteReport, listReports, type ReportRecord } from "@/src/lib/history";

const depthLabels = { easy: "Easy", standard: "Standard", deep: "Deep Dive" } as const;

/** 저장한 리포트 목록. 최신순. */
export default function HistoryPage() {
  // undefined = 불러오는 중
  const [records, setRecords] = useState<ReportRecord[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listReports().then(
      (list) => alive && setRecords(list),
      () => {
        if (!alive) return;
        setRecords([]);
        setError("저장함을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  async function remove(id: string) {
    setError(null);
    try {
      await deleteReport(id);
      setRecords((prev) => prev?.filter((r) => r.id !== id));
    } catch {
      setError("삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  return (
    <>
      <h1>🔖 저장한 리포트</h1>
      <p className="sub">이 브라우저에 저장된 리포트입니다.</p>
      {error && <div className="error" role="alert">{error}</div>}
      {records === undefined ? (
        <p className="muted" role="status">불러오는 중…</p>
      ) : records.length === 0 ? (
        !error && <p className="muted">아직 없어요. <Link href="/">홈에서 첫 리포트 만들기</Link></p>
      ) : (
        <ul className="history">
          {records.map((r) => (
            <li key={r.id}>
              <Link href={`/report/${r.id}`} className="history-item">
                <div className="chips">
                  {r.input.area && <span className="chip-static">{areaLabels[r.input.area]}</span>}
                  <span className="chip-static">{depthLabels[r.input.depth]}</span>
                </div>
                <b>{r.input.question}</b>
                <small>{new Date(r.createdAt).toLocaleString("ko-KR")}</small>
              </Link>
              <button type="button" className="ghost" onClick={() => remove(r.id)} aria-label="삭제">삭제</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
