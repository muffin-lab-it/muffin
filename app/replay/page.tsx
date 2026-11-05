/**
 * 리플레이 화면 (리더, 시연용). 녹화된 실제 실행을 같은 이벤트로 다시 보여 줍니다. /replay?id=<녹화 id>&speed=2 로 열면 바로 재생합니다.
 * 목록은 서버에서 그리고(검색 봇 제외), 재생은 클라이언트 부분(Replay.tsx)이 합니다.
 */
import type { Metadata } from "next";
import { Replay } from "./Replay";

export const metadata: Metadata = { title: "리플레이 · Muffin Lab", robots: { index: false, follow: false } };

export default async function ReplayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : undefined;
  const speed = typeof params.speed === "string" ? Number(params.speed) || undefined : undefined;
  return <Replay initialId={id} initialSpeed={speed} />;
}
