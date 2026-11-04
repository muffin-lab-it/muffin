import { describe, expect, it } from "vitest";
import sample from "../agent/fixtures/report.v2.sample.json";
import { reportSchema } from "../agent/schema";
import { formatStat, groupByQuestion, reportStats } from "./compare";
import type { ReplayMeta } from "./replay-meta";

const meta = (id: string, question: string, depth: ReplayMeta["depth"], recordedAt: string, area: ReplayMeta["area"] = "fx"): ReplayMeta => ({ id, question, depth, area, recordedAt, ms: 20_000 });

describe("Easy / Deep 나란히 보기", () => {
  it("같은 질문의 녹화를 깊이별로 묶고, 깊이가 하나뿐인 질문은 뺀다. 같은 깊이가 여럿이면 최신 녹화", () => {
    const groups = groupByQuestion([
      meta("fx-cause", "요즘 원달러 환율이 왜 이렇게 움직여?", "standard", "2026-11-04T16:40:00Z"),
      meta("fx-cause-easy", "요즘 원달러 환율이 왜 이렇게 움직여? ", "easy", "2026-11-04T17:00:00Z"),
      meta("fx-cause-deep", "요즘 원달러 환율이 왜 이렇게 움직여?", "deep", "2026-11-04T17:01:00Z"),
      meta("fx-cause-deep-old", "요즘 원달러 환율이 왜 이렇게 움직여?", "deep", "2026-11-03T17:01:00Z"),
      meta("rate-compare", "한국 기준금리랑 미국 금리 차이가 요즘 어때?", "standard", "2026-11-04T15:00:00Z", "rate"),
      // 같은 질문이라도 영역이 다르면 다른 묶음 (여기선 하나뿐이라 비교 대상에서 빠짐)
      meta("fx-cause-etf", "요즘 원달러 환율이 왜 이렇게 움직여?", "easy", "2026-11-04T17:30:00Z", "etf"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.question).toBe("요즘 원달러 환율이 왜 이렇게 움직여?");
    expect(groups[0]!.area).toBe("fx");
    expect(Object.keys(groups[0]!.replays).sort()).toEqual(["deep", "easy", "standard"]);
    expect(groups[0]!.replays.deep?.id).toBe("fx-cause-deep");
  });

  it("리포트의 글자 수 · 항목 수 · 응답 시간을 요약하고 표시 문자열을 만든다", () => {
    const report = reportSchema.parse((sample as { report: unknown }).report);
    const s = reportStats(report, 24_500);
    expect(s).toMatchObject({ numbers: report.numbers.length, why: report.why.length, impact: report.impact.length, sources: report.sources.length, evidence: report.evidence.length, ms: 24_500 });
    expect(s.chars).toBeGreaterThan(report.summary.length);
    expect(formatStat("ms", 24_500)).toBe("24.5초");
    expect(formatStat("chars", 1234)).toBe("1,234자");
    expect(formatStat("numbers", 3)).toBe("3개");
    expect(formatStat("ms", null)).toBe("-");
  });
});
