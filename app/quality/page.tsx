/**
 * 품질 숫자 (심사용 공개 페이지, 리더). /admin 은 비밀번호가 있어 심사위원이 볼 수 없으므로, 집계 숫자만 비밀번호 없이 보여 줍니다.
 * 데이터는 evals 표(주간 평가) · runs 표(최근 7일 집계) · 고정 숫자(src/lib/quality.ts). 한 시간마다 다시 만듭니다.
 */
import type { Metadata } from "next";
import { loadRuns, summarizeRuns } from "@/src/lib/admin";
import { loadEvals } from "@/src/lib/admin-evals";
import { opsPoint, weeklyPoints } from "@/src/lib/quality";
import { QualityView } from "./QualityView";

export const revalidate = 3600;
export const metadata: Metadata = { title: "품질 숫자 · Muffin Lab", robots: { index: false, follow: false } };

export default async function QualityPage() {
  const now = new Date();
  // 둘 중 하나가 실패해도 나머지는 그대로 그립니다 (DB 가 멈춰 있어도 고정 숫자와 안내는 보이게)
  const [evals, runs] = await Promise.all([loadEvals().catch(() => null), loadRuns(now).catch(() => null)]);
  const weekly = evals ? weeklyPoints(evals.weekly) : [];
  // DB 환경 변수가 없으면 loadRuns 는 예시 데이터를 돌려줍니다 (/admin 연습용). 공개 페이지에 예시 숫자를 운영 실적처럼 내보내지 않습니다 (Codex 리뷰)
  const ops = runs && runs.source === "runs" ? opsPoint(summarizeRuns(runs.rows, now, "7d")) : null;
  return <QualityView weekly={weekly} ops={ops} generatedAt={now.toISOString()} />;
}
