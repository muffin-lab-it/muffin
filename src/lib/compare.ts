/**
 * Easy / Deep 나란히 보기 (리더, 시연용 /compare) 의 가벼운 계산 모듈. 녹화 목록(src/replays/manifest.json)을 같은 질문끼리 묶고,
 * 리포트 두 장의 차이를 숫자로 요약합니다 (글자 수 · 숫자 카드 · 원인 · 영향 · 주의점 · 더해볼 것 · 출처 · 응답 시간). 무거운 import 없음.
 */
import type { Depth, Report } from "../agent/schema";
import type { ReplayMeta } from "./replay-meta";

export const depthOrder: readonly Depth[] = ["easy", "standard", "deep"];
export const depthLabels: Record<Depth, string> = { easy: "Easy", standard: "Standard", deep: "Deep Dive" };
export const depthHints: Record<Depth, string> = { easy: "쉽게 핵심만 빠르게", standard: "균형 잡힌 핵심과 배경", deep: "깊이 있는 리포트로 진지하게" };

/** 같은 질문의 녹화 묶음. 깊이가 둘 이상인 것만 비교 대상입니다 */
export type CompareGroup = { question: string; area?: ReplayMeta["area"]; replays: Partial<Record<Depth, ReplayMeta>> };

export function groupByQuestion(manifest: ReplayMeta[]): CompareGroup[] {
  const groups = new Map<string, CompareGroup>();
  for (const m of [...manifest].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const question = m.question.trim();
    // 같은 질문이라도 영역이 다르면 다른 비교입니다 (영역 차이가 깊이 차이로 보이지 않게)
    const key = `${m.area ?? ""}|${question}`;
    const g = groups.get(key) ?? { question, ...(m.area ? { area: m.area } : {}), replays: {} };
    // 같은 깊이가 여럿이면 최신 녹화
    g.replays[m.depth] = m;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => Object.keys(g.replays).length >= 2);
}

export type ReportStats = {
  chars: number;
  numbers: number;
  why: number;
  impact: number;
  caveats: number;
  nextTopics: number;
  sources: number;
  evidence: number;
  ms: number | null;
};

export const statLabels: Record<keyof ReportStats, string> = {
  chars: "글자 수",
  numbers: "숫자 카드",
  why: "원인",
  impact: "영향",
  caveats: "주의점",
  nextTopics: "더해볼 것",
  sources: "출처",
  evidence: "증거 항목",
  ms: "응답 시간",
};
export const statOrder: (keyof ReportStats)[] = ["chars", "numbers", "why", "impact", "caveats", "nextTopics", "sources", "evidence", "ms"];

/** 사용자가 읽는 글의 길이와 항목 수. 깊이별 차이를 한눈에 보려는 것 */
export function reportStats(report: Report, ms: number | null = null): ReportStats {
  const text = [report.summary, ...report.why.map((w) => `${w.claim} ${w.evidence}`), ...report.impact, ...report.caveats].join("");
  return {
    chars: text.length,
    numbers: report.numbers.length,
    why: report.why.length,
    impact: report.impact.length,
    caveats: report.caveats.length,
    nextTopics: report.nextTopics.length,
    sources: report.sources.length,
    evidence: report.evidence.length,
    ms,
  };
}

export function formatStat(key: keyof ReportStats, value: number | null): string {
  if (value === null) return "-";
  if (key === "ms") return `${(value / 1000).toFixed(1)}초`;
  if (key === "chars") return `${value.toLocaleString("ko-KR")}자`;
  return `${value}개`;
}
