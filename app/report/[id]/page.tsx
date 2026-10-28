"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { areaLabels, ReportView } from "@/app/components/ReportView";
import { getReport, type ReportRecord } from "@/src/lib/history";

const depthLabels = { easy: "Easy", standard: "Standard", deep: "Deep Dive" } as const;

/** 불러온 결과. id 를 같이 들고 있어서 주소가 바뀌면 다시 "불러오는 중" 이 됩니다. */
type Loaded = { id: string; record: ReportRecord | null } | { id: string; failed: true };

/** 리포트 상세. 저장함에서 id 로 꺼내 보여줍니다. */
export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getReport(id).then(
      (record) => alive && setLoaded({ id, record }),
      () => alive && setLoaded({ id, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  if (!loaded || loaded.id !== id) return <p className="muted" role="status">불러오는 중…</p>;
  if ("failed" in loaded) {
    return (
      <div className="error" role="alert">
        리포트를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요. <Link href="/history">저장함으로</Link>
      </div>
    );
  }
  const { record } = loaded;
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
