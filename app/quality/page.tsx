/**
 * 품질 숫자 (심사용 공개 페이지, 리더). /admin 은 비밀번호가 있어 심사위원이 볼 수 없으므로, 집계 숫자만 비밀번호 없이 보여 줍니다.
 * 데이터는 evals 표(주간 평가) · runs 표(최근 7일 집계) · 고정 숫자(src/lib/quality.ts). 한 시간마다 다시 읽습니다 (loadQuality 가 인스턴스 안에서 캐시).
 */
import type { Metadata } from "next";
import { loadQuality } from "@/src/lib/quality";
import { QualityView } from "./QualityView";

export const revalidate = 3600;
export const metadata: Metadata = { title: "품질 숫자 · Muffin Lab", robots: { index: false, follow: false } };

export default async function QualityPage() {
  const { weekly, ops, generatedAt } = await loadQuality();
  return <QualityView weekly={weekly} ops={ops} generatedAt={generatedAt} />;
}
