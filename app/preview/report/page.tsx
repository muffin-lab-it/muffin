import { notFound } from "next/navigation";
import { ReportPreview } from "./ReportPreview";
export default async function ReportPreviewPage({ searchParams }: {searchParams:Promise<{canvas?:string;sample?:string}>}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params=await searchParams;
  return <ReportPreview canvas={params.canvas === "1"} initialSample={params.sample} />;
}
