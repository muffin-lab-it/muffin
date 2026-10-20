import { findAdvice } from "./guard";
import { DISCLOSURE, UNSUPPORTED_EVIDENCE, summarizeWhy } from "./report";
import { legacyReportSchema, reportSchema, type Report, type WriterOutput } from "./schema";

/**
 * 저장된 리포트를 v2 모양으로 맞춥니다. History(localStorage · 서버)에서 읽을 때 씁니다.
 * v2 는 그대로, 0단계 전에 저장된 v1 은 검증 없음(skipped) · 숫자 미검증 · 출처 id S1… 로 바꿉니다.
 * 둘 다 아니면 throw 합니다 (깨진 기록은 화면이 건너뜁니다).
 */
export function normalizeReport(input: unknown): Report {
  const v2 = reportSchema.safeParse(input);
  if (v2.success) return v2.data;

  const v1 = legacyReportSchema.safeParse(input);
  if (!v1.success) throw new Error("리포트 형식이 아닙니다 (v1 도 v2 도 아님)");
  const r = v1.data;

  const why: WriterOutput["why"] = r.why.map((w) => ({
    ...w,
    basis: UNSUPPORTED_EVIDENCE.test(w.evidence) ? "none" : "data",
    refs: [],
  }));
  const text = { summary: r.summary, why, impact: r.impact, caveats: r.caveats, nextTopics: r.nextTopics };

  return {
    version: 2,
    mode: "research",
    summary: r.summary,
    numbers: r.numbers.map((n) => ({ ...n, ref: null, check: "unverified" })),
    why,
    impact: r.impact,
    caveats: r.caveats,
    dataGaps: r.dataGaps,
    nextTopics: r.nextTopics,
    sources: r.sources.map((s, i) => ({ id: `S${i + 1}`, ...s })),
    evidence: [],
    verification: {
      status: "skipped",
      numbers: { total: r.numbers.length, verified: 0, derived: 0, unverified: r.numbers.length },
      why: summarizeWhy(why),
      advice: findAdvice(text).length,
      revisions: 0,
      removed: [],
    },
    disclosure: DISCLOSURE,
  };
}
