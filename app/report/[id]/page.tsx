"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { areaLabels, ReportView } from "@/app/components/ReportView";
import { getReport, subscribeHistory, type ReportRecord } from "@/src/lib/history";

const depthLabels = { easy: "Easy", standard: "Standard", deep: "Deep Dive" } as const;

/** 리포트 상세. 저장함(localStorage)에서 id 로 꺼내 보여줍니다. */
export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  // 서버 렌더링 때는 undefined(불러오는 중), 브라우저에서는 있으면 record, 없으면 null
  const getSnapshot = useCallback((): ReportRecord | null => getReport(id) ?? null, [id]);
  const record = useSyncExternalStore(subscribeHistory, getSnapshot, () => undefined);

  if (record === undefined) return <p className="muted">불러오는 중…</p>;
  if (record === null) {
    return (
      <>
        <h1>리포트를 찾을 수 없어요</h1>
        <p className="sub">이 브라우저의 저장함에 없는 리포트입니다. <Link href="/">홈에서 새로 만들기</Link></p>
      </>
    );
  }

  const { input } = record;
  return (
    <>
      <div className="report-head">
        <h1>Today&apos;s Muffin</h1>
        <div className="chips">
          {input.area && <span className="chip-static">{areaLabels[input.area]}</span>}
          <span className="chip-static">{depthLabels[input.depth]}</span>
          <span className="chip-static muted">{new Date(record.createdAt).toLocaleString("ko-KR")}</span>
        </div>
        <p className="sub">{input.question}</p>
      </div>
      <ReportView report={record.report} steps={record.steps} area={input.area} />
    </>
  );
}
