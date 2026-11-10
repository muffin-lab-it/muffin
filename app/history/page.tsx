"use client";

import styles from "../HomeHistory.module.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { homeAreaLabel } from "../components/home-form";
import { deleteReport, listReports, type ReportRecord } from "@/src/lib/history";

const depthLabels = { easy: "Easy", standard: "Standard", deep: "Deep Dive" } as const;

/** Existing history API remains the single storage interface. */
export default function HistoryPage() {
  const [records, setRecords] = useState<ReportRecord[]>();
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ReportRecord | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let alive = true;
    listReports().then(
      list => { if (alive) { setRecords(list); setError(null); } },
      () => { if (alive) { setRecords([]); setError("보관함을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."); } },
    );
    return () => { alive = false; };
  }, [reload]);

  async function remove(record: ReportRecord) {
    if (deleting) return;
    setDeleting(record.id); setError(null); setStatus("");
    try {
      await deleteReport(record.id);
      const remaining = await listReports();
      // The local history implementation can silently ignore failed writes.
      if (remaining.some(item => item.id === record.id)) throw new Error("Deletion did not persist");
      setRecords(remaining); setConfirmation(null); setStatus("리포트를 보관함에서 삭제했어요.");
    } catch {
      setError("삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally { setDeleting(null); }
  }

  const filtered = records?.filter(record => record.input.question.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <div className={`${styles.history} muffin-history`}>
      <header className={styles.historyHeading}><div><p className={styles.eyebrow}>MY MUFFINS</p><h1>보관함</h1><p>궁금했던 이야기와 완성된 리포트를 다시 만나보세요.</p></div><Link href="/" className={styles.newReport}>새 리포트 굽기 <span aria-hidden="true">↗</span></Link></header>
      <div className={styles.historyToolbar}><label htmlFor="history-search" className={styles.srOnly}>질문으로 리포트 검색</label><input id="history-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="어떤 이야기를 찾고 있나요?" /><p>{records === undefined ? "불러오는 중" : `전체 ${records.length}개`}</p></div>
      <p className={styles.storageNote}>이 브라우저에 저장된 리포트입니다. 각 리포트의 데이터 기준일을 확인해 주세요.</p>
      {error && <div className={styles.error} role="alert"><p>{error}</p>{!confirmation && <button type="button" onClick={() => { setRecords(undefined); setError(null); setReload(value => value + 1); }}>다시 불러오기</button>}</div>}
      <p className={styles.status} role="status">{status}</p>
      {confirmation && <section className={styles.deleteConfirmation} aria-label="리포트 삭제 확인"><h2>이 리포트를 삭제할까요?</h2><p>{confirmation.input.question}</p><small>삭제한 리포트는 되돌릴 수 없어요.</small><div><button type="button" disabled={!!deleting} onClick={() => setConfirmation(null)}>취소</button><button type="button" disabled={!!deleting} onClick={() => void remove(confirmation)}>{deleting ? "삭제 중…" : "삭제하기"}</button></div></section>}
      {records === undefined ? <div className={styles.empty} role="status"><span aria-hidden="true">◌</span><h2>리포트를 불러오고 있어요.</h2></div>
        : !error && records.length === 0 ? <section className={styles.empty}><span aria-hidden="true">♧</span><h2>아직 담아 둔 리포트가 없어요.</h2><p>작은 질문 하나로 나만의 경제 연구를 시작해 보세요.</p><Link href="/" className={styles.newReport}>첫 리포트 만들기</Link></section>
        : !error && filtered?.length === 0 ? <section className={styles.empty}><h2>찾는 리포트가 없어요.</h2><p>다른 단어로 검색해 보세요.</p><button type="button" onClick={() => setQuery("")}>검색 초기화</button></section>
        : <ul className={styles.historyGrid}>{filtered?.map(record => <li key={record.id} className={styles.historyCard}><Link href={`/report/${encodeURIComponent(record.id)}`} className={styles.cardLink}><div className={styles.cardChips}><span>{homeAreaLabel(record.input)}</span><span>{depthLabels[record.input.depth]}</span></div><h2>{record.input.question}</h2><p className={styles.cardSummary}>{record.report.summary}</p><div className={styles.cardFoot}><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}</time><span>리포트 읽기 ↗</span></div></Link><button type="button" className={styles.deleteButton} disabled={!!deleting} onClick={() => { setError(null); setConfirmation(record); }} aria-label={`${record.input.question} 리포트 삭제`}>삭제</button></li>)}</ul>}
    </div>
  );
}
