/**
 * Promptfoo 평가 테스트 (리더). 모델을 부르지 않습니다. 테스트 생성(tests.ts) · 채점 함수(asserts.ts) · 요약(summary.ts)의 모양을 확인합니다.
 * 리포트는 mock 모드의 샘플(src/agent/fixtures/report.v2.sample.json)로 만들고, 근거 판정은 run 을 모킹합니다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  return { ...actual, run: vi.fn() };
});

import { run } from "@openai/agents";
import { createJudgeAgent } from "../../src/agent/judge";
import { mockResearch } from "../../src/agent/mock";
import type { Area } from "../../src/agent/schema";
import { loadAllQuestionSets } from "../questions/schema";
import * as asserts from "./asserts";
import type { EvalOutput } from "./provider";
import { PROMPTFOO_VERSION, promptfooArgs, promptfooEnv, runFailure } from "./runner";
import { defaultThresholds, metricRates, summarize, type PromptfooOutput, type PromptfooRow } from "./summary";
import { assertsFor, buildTests, loadSets } from "./tests";

const runMock = run as unknown as ReturnType<typeof vi.fn>;
afterEach(() => {
  runMock.mockReset();
  vi.unstubAllEnvs();
});

async function mockOutput(question = "환율이 왜 내렸어?", area: Area = "fx"): Promise<EvalOutput> {
  vi.stubEnv("MUFFIN_MOCK_DELAY_MS", "0");
  const r = await mockResearch({ question, depth: "standard", area });
  return { question, depth: "standard", area, report: r.report, plan: r.plan, steps: r.steps, rewrites: r.rewrites, facts: r.facts, elapsedMs: 1234 };
}

const metricsOf = (q: ReturnType<typeof assertsFor>) => q.map((a) => a.metric);

describe("tests.ts — 질문 세트에서 테스트 만들기", () => {
  const sets = loadAllQuestionSets();
  const all = buildTests(sets);
  const find = (id: string) => all.find((t) => t.vars.id === id)!;

  it("질문마다 테스트 하나, 설명은 id 로 시작하고 vars 에 질문 · 깊이 · 정답 의도 · 기대 tool 이 그대로 들어간다", () => {
    expect(all).toHaveLength(sets.reduce((n, s) => n + s.questions.length, 0));
    const t = find("common-fx-cause-1");
    expect(t.description.startsWith("common-fx-cause-1 [standard] ")).toBe(true);
    expect(t.vars).toMatchObject({ question: expect.any(String), depth: "standard", intent: "cause", area: "fx", expectTools: ["get_fx_krw_rate"] });
    expect(t.metadata).toMatchObject({ set: "common", area: "fx", intent: "cause", depth: "standard" });
    // 영역 없는 질문은 area 를 넣지 않는다 (metadata 에는 none)
    const none = find("common-none-out-of-scope-1");
    expect(none.vars).not.toHaveProperty("area");
    expect(none.metadata.area).toBe("none");
  });

  it("범위 밖 질문은 tool 선택만 재고 숫자 · 원인 · 근거 판정은 재지 않는다. 기대 tool 이 없는 보통 질문은 tool 선택을 재지 않는다", () => {
    const outOfScope = metricsOf(find("common-none-out-of-scope-1").assert);
    expect(outOfScope).toContain("tools");
    expect(outOfScope).not.toContain("numbers");
    expect(outOfScope).not.toContain("why");
    expect(outOfScope).not.toContain("judge");
    const cause = metricsOf(find("common-fx-cause-1").assert);
    expect(cause).toEqual(["intent", "tools", "numbers", "why", "judge", "refs", "advice", "verification", "rewrites", "latency"]);
    // etf-status-3 은 expectTools 가 비어 있다
    const noTools = metricsOf(find("etf-status-3").assert);
    expect(noTools).not.toContain("tools");
    expect(noTools).toContain("numbers");
    // 지표 함수 이름은 asserts.ts 의 export 와 같아야 promptfoo 가 찾는다
    for (const a of find("common-fx-cause-1").assert) {
      if (a.type === "javascript") expect(typeof (asserts as Record<string, unknown>)[a.metric]).toBe("function");
    }
  });

  it("근거 판정은 뺄 수 있고, 깊이 all 이면 질문마다 세 깊이가 나온다", () => {
    const noJudge = buildTests(sets, { judge: false });
    expect(noJudge.every((t) => !metricsOf(t.assert).includes("judge"))).toBe(true);
    const deep = buildTests(sets, { depth: "all" });
    expect(deep).toHaveLength(all.length * 3);
    expect(deep.filter((t) => t.vars.id === "common-fx-cause-1").map((t) => t.vars.depth)).toEqual(["easy", "standard", "deep"]);
  });

  it("MUFFIN_EVAL_SET 으로 세트를 고르고, 비어 있으면 전부 읽는다", () => {
    expect(loadSets("common,etf").map((s) => s.set)).toEqual(["common", "etf"]);
    expect(loadSets("").length).toBe(sets.length);
    expect(loadSets(undefined).length).toBe(sets.length);
  });
});

describe("asserts.ts — 채점 함수 (샘플 리포트)", () => {
  it("의도 · tool 선택은 vars 의 정답과 비교한다", async () => {
    const output = await mockOutput();
    expect(asserts.intent(output, { vars: { intent: "cause" } })).toMatchObject({ pass: true, score: 1 });
    expect(asserts.intent(output, { vars: { intent: "status" } })).toMatchObject({ pass: false, reason: expect.stringContaining("분류 cause") });
    expect(asserts.intent(output, { vars: {} })).toMatchObject({ pass: true, reason: expect.stringContaining("볼 것 없음") });

    expect(asserts.tools(output, { vars: { intent: "cause", expectTools: ["get_fx_krw_rate"] } })).toMatchObject({ pass: true });
    expect(asserts.tools(output, { vars: { intent: "cause", expectTools: ["get_nothing"] } })).toMatchObject({ pass: false, reason: expect.stringContaining("get_nothing 없음") });
    expect(asserts.tools(output, { vars: { intent: "out_of_scope", expectTools: [] } })).toMatchObject({ pass: false, reason: expect.stringContaining("범위 밖") });
    expect(asserts.tools(output, { vars: { intent: "status", expectTools: [] } })).toMatchObject({ pass: true, reason: expect.stringContaining("볼 것 없음") });
  });

  it("숫자 · 번호 · 원인 · 권유 · 검증 · 다시 쓰기는 리포트만 보고 정한다 (scoring.ts 와 같은 값)", async () => {
    const output = await mockOutput();
    // 샘플: 숫자 ✓3 C1 제거 0, 원인 3개 중 근거 없는 것 1개, 검증 partial(권유 문장 1개 뺌)
    expect(asserts.numbers(output)).toEqual({ pass: true, score: 1, reason: "✓3 C1 제거0" });
    // 숫자가 하나도 없는 리포트(뉴스 현황 · 판단 요청)는 뺀 것도 없으니 통과, 뺀 숫자가 있으면 실패
    const noNumbers: EvalOutput = { ...output, report: { ...output.report, verification: { ...output.report.verification, numbers: { ...output.report.verification.numbers, verified: 0, derived: 0 } } } };
    expect(asserts.numbers(noNumbers)).toEqual({ pass: true, score: 1, reason: "✓0 C0 제거0 (숫자 없음)" });
    const removed: EvalOutput = { ...output, report: { ...output.report, verification: { ...output.report.verification, removed: ["숫자 환율 1,392원 — 장부에 없음"] } } };
    expect(asserts.numbers(removed)).toEqual({ pass: false, score: 0.8, reason: "✓3 C1 제거1" });
    expect(asserts.refs(output)).toMatchObject({ pass: true });
    const why = asserts.why(output);
    expect(why.pass).toBe(false);
    expect(why.reason).toBe("📊1 📰1 ❔1 (원인 3개)");
    expect(why.score).toBeCloseTo(2 / 3);
    expect(asserts.advice(output)).toMatchObject({ pass: true, reason: "권유 표현 없음" });
    expect(asserts.verification(output)).toMatchObject({ pass: false, reason: expect.stringContaining("partial") });
    expect(asserts.rewrites(output).reason).toMatch(/^다시 쓰기 \d+회$/);
  });

  it("근거 판정은 judge.ts 를 부르고 contradicted 가 있으면 실패, 모델 실패는 '판정 못 함'", async () => {
    const output = await mockOutput();
    const agent = createJudgeAgent();
    // 판정 대상은 근거(refs)가 있는 원인 2개 → 모델 번호 1, 2
    runMock.mockResolvedValueOnce({ finalOutput: { verdicts: [{ index: 1, verdict: "supported", reason: "E2 · C1 방향 일치" }, { index: 2, verdict: "supported", reason: "제목이 말함" }] } });
    const ok = await asserts.judge(output, undefined, agent);
    expect(ok).toMatchObject({ pass: true, score: 1 });
    expect(ok.reason.startsWith("✓2 ✗0 ⚡0")).toBe(true);
    expect(runMock).toHaveBeenCalledTimes(1);

    runMock.mockResolvedValueOnce({ finalOutput: { verdicts: [{ index: 1, verdict: "contradicted", reason: "방향 반대" }, { index: 2, verdict: "unsupported", reason: "제목에 없음" }] } });
    const bad = await asserts.judge(output, undefined, agent);
    expect(bad).toMatchObject({ pass: false, score: 0 });
    expect(bad.reason).toContain("⚡1");
    expect(bad.reason).toContain("방향 반대");

    runMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await asserts.judge(output, undefined, agent)).toEqual({ pass: false, score: 0, reason: "판정 못 함 (모델 호출 실패)" });

    // 원인이 모두 basis none 이면 모델을 부르지 않는다
    const none: EvalOutput = { ...output, report: { ...output.report, why: output.report.why.map((w) => ({ ...w, basis: "none" as const, refs: [] })) } };
    expect(await asserts.judge(none, undefined, agent)).toMatchObject({ pass: true, reason: expect.stringContaining("판정할 원인 없음") });
    expect(runMock).toHaveBeenCalledTimes(3);
  });
});

describe("summary.ts — 결과 요약", () => {
  // promptfoo 모양 그대로: 채점 실패(failureReason 1)도 error 칸에 첫 실패 이유가 적힌다. provider 오류는 failureReason 2
  const row = (id: string, parts: [string, boolean, string][], latencyMs: number): PromptfooRow => {
    const firstFail = parts.find((p) => !p[1]);
    return {
      success: !firstFail,
      failureReason: firstFail ? 1 : 0,
      ...(firstFail ? { error: firstFail[2] } : {}),
      latencyMs,
      vars: { id, depth: "standard" },
      gradingResult: { pass: !firstFail, componentResults: parts.map(([metric, pass, reason]) => ({ pass, score: pass ? 1 : 0, reason, assertion: { type: metric === "latency" ? "latency" : "javascript", metric } })) },
    };
  };
  const out: PromptfooOutput = {
    config: { metadata: { thresholds: { intent: 1 } } },
    results: {
      timestamp: "2026-11-03T12:00:00.000Z",
      results: [
        row("common-fx-cause-1", [["intent", true, "분류 cause · 정답 cause"], ["tools", true, "모두 호출"], ["latency", false, "Latency 61000ms is greater than threshold 55000ms"]], 61000),
        row("common-news-status-1", [["intent", false, "분류 cause · 정답 status"], ["tools", true, "모두 호출"]], 30000),
        { success: false, failureReason: 2, error: "research 실패: timeout", response: { error: "research 실패: timeout" }, vars: { id: "etf-cause-1", depth: "standard" }, gradingResult: null },
      ],
    },
  };

  it("지표마다 통과 수 / 전체 수를 세고 오류 행은 세지 않는다", () => {
    const rates = metricRates(out);
    expect(rates.intent).toEqual({ pass: 1, total: 2, rate: 0.5 });
    expect(rates.tools).toEqual({ pass: 2, total: 2, rate: 1 });
    expect(rates.latency).toEqual({ pass: 0, total: 1, rate: 0 });
    expect(rates.judge).toEqual({ pass: 0, total: 0, rate: null });
  });

  it("기준은 설정의 thresholds 가 우선이고 없으면 기본값. 기준 아래 지표 · 오류 · 틀린 이유가 markdown 에 들어간다", () => {
    const s = summarize(out);
    expect(s.questions).toBe(3);
    expect(s.errors).toBe(1);
    expect(s.failed).toEqual([
      { metric: "intent", rate: 0.5, threshold: 1 },
      { metric: "latency", rate: 0, threshold: defaultThresholds.latency },
    ]);
    expect(s.markdown).toContain("# 리포트 평가 (Promptfoo) 2026-11-03 12:00");
    expect(s.markdown).toContain("❌ 기준 아래 지표 2개: 의도 일치 50% < 100%, 55초 안 0% < 70%");
    expect(s.markdown).toContain("| 의도 일치 | 1/2 | 50% | 100% | - | ❌ |");
    expect(s.markdown).toContain("| tool 선택 | 2/2 | 100% | 80% | - | ✅ |");
    expect(s.markdown).toContain("| common-news-status-1 | standard | ✗ | ✓ | - | 30.0s |");
    expect(s.markdown).toContain("| etf-cause-1 | standard | 오류 | 오류 | 오류 | research 실패: timeout |");
    expect(s.markdown).toContain("- common-news-status-1 · 의도 일치: 분류 cause · 정답 status");
    expect(s.markdown).toContain("- etf-cause-1: 오류 — research 실패: timeout");
    // 근거 판정처럼 잰 적 없는 지표는 표에 나오지 않는다
    expect(s.markdown).not.toContain("| 근거 판정 |");
  });

  it("지난 결과가 있으면 통과율 차이를 p 로 보여 준다", () => {
    const baseline: PromptfooOutput = { results: { results: [row("common-fx-cause-1", [["intent", true, "ok"], ["tools", false, "x"]], 1000), row("common-news-status-1", [["intent", true, "ok"], ["tools", true, "ok"]], 1000)] } };
    const s = summarize(out, { baseline });
    expect(s.markdown).toContain("| 의도 일치 | 1/2 | 50% | 100% | 100% (-50p) | ❌ |");
    expect(s.markdown).toContain("| tool 선택 | 2/2 | 100% | 80% | 50% (+50p) | ✅ |");
    expect(s.markdown).toContain("지난 번과 비교");
  });

  it("모두 기준 안이고 오류가 없으면 ✅ 한 줄로 시작한다", () => {
    const good: PromptfooOutput = { results: { results: [row("q-1", [["intent", true, "ok"], ["advice", true, "ok"]], 20000)] } };
    const s = summarize(good);
    expect(s.failed).toEqual([]);
    expect(s.markdown).toContain("✅ 모든 지표가 기준 안");
    expect(s.markdown).toContain("- (없음)");
  });
});

describe("runner.ts — promptfoo 실행 명령과 실패 판단", () => {
  it("고정 버전을 pnpm --silent dlx 로 부르고, 세트 · 깊이 · 근거 판정 여부는 환경 변수로 넘긴다", () => {
    const args = promptfooArgs("docs/eval/promptfoo/x.json", { concurrency: "1" });
    expect(args.slice(0, 4)).toEqual(["--silent", "dlx", `promptfoo@${PROMPTFOO_VERSION}`, "eval"]);
    expect(args).toContain("-o");
    expect(args).toContain("docs/eval/promptfoo/x.json");
    expect(args).toContain("--no-cache");
    expect(args.slice(-2)).toEqual(["-j", "1"]);
    expect(promptfooArgs("x.json")).not.toContain("-j");

    const env = promptfooEnv({ OPENAI_API_KEY: "k" }, { set: "common,etf", depth: "all", judge: false });
    expect(env).toMatchObject({ OPENAI_API_KEY: "k", MUFFIN_EVAL_SET: "common,etf", MUFFIN_EVAL_DEPTH: "all", MUFFIN_EVAL_NO_JUDGE: "1", PROMPTFOO_FAILED_TEST_EXIT_CODE: "0", PROMPTFOO_DISABLE_TELEMETRY: "1" });
    const plain = promptfooEnv({}, { judge: true });
    expect(plain).not.toHaveProperty("MUFFIN_EVAL_SET");
    expect(plain).not.toHaveProperty("MUFFIN_EVAL_NO_JUDGE");
  });

  it("exit 가 0 이 아니거나 결과 파일이 없거나 실행 자체가 안 되면 실패다 (이전 결과를 요약하지 않음)", () => {
    expect(runFailure({ status: 0, signal: null }, true)).toBeNull();
    expect(runFailure({ status: 1, signal: null }, true)).toContain("exit 1");
    expect(runFailure({ status: null, signal: "SIGKILL" }, true)).toContain("SIGKILL");
    expect(runFailure({ status: 0, signal: null }, false)).toContain("결과 파일이 없습니다");
    expect(runFailure({ status: null, signal: null, error: new Error("spawn pnpm ENOENT") }, false)).toContain("ENOENT");
  });
});
