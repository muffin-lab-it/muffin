import { notFound } from "next/navigation";
import { ReportView } from "@/app/components/ReportView";
import { reportSchema } from "@/src/agent/schema";
import fixture from "@/src/agent/fixtures/report.v2.sample.json";

/** 로컬에서 샘플 데이터로 완성된 리포트 디자인을 확인합니다. */
export default function ReportPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <>
      <div className="report-head">
        <h1>Today&apos;s Muffin</h1>
        <div className="chips">
          <span className="chip-static">환율</span>
          <span className="chip-static">Standard</span>
          <span className="chip-static muted">디자인 미리보기 · 샘플 데이터</span>
        </div>
      </div>
      <ReportView report={reportSchema.parse(fixture.report)} steps={[]} area="fx" question={fixture.input.question} />
    </>
  );
}
