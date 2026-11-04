import { notFound } from "next/navigation";
import { ProgressPreview } from "./ProgressPreview";

/** 로컬 개발 전용. 기존 RootLayout 안에서 진행 화면을 확인합니다. */
export default function ProgressPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ProgressPreview />;
}
