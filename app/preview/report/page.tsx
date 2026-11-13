import { notFound } from "next/navigation";
import { PreviewReport } from "./PreviewReport";

export default function ReportPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PreviewReport />;
}
