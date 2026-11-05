/**
 * Easy / Deep 나란히 보기 (리더, 시연용). 같은 질문을 깊이별로 만든 리포트를 두세 열로 나란히 보여 줍니다.
 * 녹화(src/replays, 같은 질문에 깊이가 둘 이상인 것)를 재생하거나 실시간으로 만듭니다. /compare?question=…&speed=4 로 열면 바로 재생합니다.
 */
import type { Metadata } from "next";
import { Compare } from "./Compare";

export const metadata: Metadata = { title: "깊이별 비교 · Muffin Lab", robots: { index: false, follow: false } };

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const question = typeof params.question === "string" ? params.question : undefined;
  const speed = typeof params.speed === "string" ? Number(params.speed) || undefined : undefined;
  return <Compare initialQuestion={question} initialSpeed={speed} />;
}
