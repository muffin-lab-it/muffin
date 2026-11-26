import type { MuffinEvent } from "@/src/agent/events";
import { ApiError, streamReport, type ReportRequest, type ReportResponse } from "@/src/lib/api";
import { getReport, saveReport } from "@/src/lib/history";
import type { ProgressError } from "./Progress";

/** 범위 밖 질문에 서버가 만든 안내와 대신 물어볼 질문 (미국 상장 ETF · 개별 주가 · 그 밖) */
export type ScopeInfo = { summary: string; topics: { question: string; reason?: string }[] };

type State = {
  phase: "idle" | "checking" | "unsupported" | "research" | "saving" | "error" | "navigating";
  input?: ReportRequest;
  events: readonly MuffinEvent[];
  result?: ReportResponse;
  error?: ProgressError;
  retrySeconds: number;
  scope?: ScopeInfo;
};

/** 범위 밖 리포트에서 홈 안내에 쓸 것만 (11/23 운영 검수: "QQQ 요즘 수익률 어때?" 에 서버가 만든 국내 ETF 안내 · 추천 질문이 버려지고 고정 문구만 보였음) */
export function scopeOf(report: ReportResponse["report"]): ScopeInfo | undefined {
  const summary = report.summary?.trim();
  if (!summary) return undefined;
  return { summary, topics: (report.nextTopics ?? []).slice(0, 3).map((question, index) => ({ question, reason: report.topicReasons?.[index] || undefined })) };
}

/** 홈의 한 요청을 관리합니다. 중복 실행과 화면 이탈 후의 저장·이동을 막습니다. */
export function createHomeReport(deps = { streamReport, saveReport, getReport }, navigate: (url: string) => void) {
  let state: State = { phase: "idle", events: [], retrySeconds: 0 };
  let generation = 0;
  let retryAt = 0;
  const listeners = new Set<() => void>();
  const update = (next: State) => { state = next; listeners.forEach(listener => listener()); };
  const remaining = () => Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  const busy = () => ["checking", "research", "saving", "navigating"].includes(state.phase);

  async function persist(token: number, input: ReportRequest, result: ReportResponse) {
    update({ ...state, phase: "saving", result, error: undefined });
    try {
      const record = await deps.saveReport(input, result.report, result.steps, result.id);
      if (token !== generation) return;
      // 현재 localStorage 구현은 쓰기 실패를 throw하지 않으므로 공개 API로 저장을 확인합니다.
      const stored = await deps.getReport(record.id);
      if (token !== generation) return;
      if (!stored) throw new Error("저장한 리포트를 확인하지 못했어요.");
      update({ ...state, phase: "navigating" });
      navigate(`/report/${encodeURIComponent(record.id)}`);
    } catch {
      if (token !== generation) return;
      update({ ...state, phase: "error", error: { kind: "save", id: result.id, message: "리포트를 저장하지 못했어요. 완성된 내용은 아래에서 확인하고, 저장을 다시 시도해 주세요." } });
    }
  }

  async function start(request: ReportRequest) {
    if (busy() || remaining() > 0 || !request.question.trim()) return;
    const token = ++generation;
    const input = { ...request, question: request.question.trim() };
    update({ phase: "checking", input, events: [], retrySeconds: 0 });
    let terminal = false;
    // 범위 밖이면 저장 · 이동은 하지 않지만, 뒤이어 오는 범위 밖 리포트의 안내 · 추천 질문은 받아 홈에 보여 줍니다
    let outOfScope = false;
    try {
      const result = await deps.streamReport(input, event => {
        if (token !== generation) return;
        if (outOfScope) {
          const scope = event.type === "report" ? scopeOf(event.report) : undefined;
          if (scope) update({ ...state, scope });
          return;
        }
        if (terminal) return;
        const unsupported = (event.type === "plan" && event.mode === "out_of_scope")
          || (event.type === "report" && event.report.mode === "out_of_scope");
        if (unsupported) {
          // The server may still finish verify/report. Never save it.
          outOfScope = true;
          terminal = true;
          const scope = event.type === "report" ? scopeOf(event.report) : undefined;
          update({ phase: "unsupported", input, events: [...state.events, event], retrySeconds: 0, ...(scope ? { scope } : {}) });
          return;
        }
        terminal = event.type === "error" || event.type === "report";
        const supportedPlan = state.events.some(previous => previous.type === "plan" && previous.mode !== "out_of_scope");
        const beganWork = supportedPlan && event.type === "stage" && event.stage === "research" && event.status === "start";
        update({ ...state, phase: beganWork && state.phase === "checking" ? "research" : state.phase, events: [...state.events, event] });
      });
      if (token !== generation) return;
      if (outOfScope || result.report.mode === "out_of_scope") {
        const scope = scopeOf(result.report) ?? state.scope;
        update({ phase: "unsupported", input, events: state.events, retrySeconds: 0, ...(scope ? { scope } : {}) });
        return;
      }
      await persist(token, input, result);
    } catch (error) {
      // 범위 밖 안내를 이미 띄웠으면 그 뒤의 연결 오류로 안내를 지우지 않습니다
      if (token !== generation || outOfScope) return;
      const streamError = state.events.find(event => event.type === "error");
      const failure: ProgressError = streamError?.type === "error"
        ? { message: streamError.message, id: streamError.id }
        : error instanceof ApiError
          ? { message: error.message, status: error.status, id: error.id }
          : { kind: "network", message: "연결이 끊겼거나 완성된 리포트를 받지 못했어요. 다시 시도해 주세요." };
      if (error instanceof ApiError && error.status === 429) {
        retryAt = Date.now() + (error.retryAfterSec ?? 60) * 1000;
      }
      update({ ...state, phase: "error", error: failure, retrySeconds: remaining() });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    async retry() {
      if (state.phase !== "error" || remaining() > 0 || !state.input) return;
      if (state.error?.kind === "save" && state.result) await persist(++generation, state.input, state.result);
      else if (![400, 403, 413, 503].includes(state.error?.status ?? 0)) await start(state.input);
    },
    edit() {
      if (busy()) return;
      generation++;
      update({ phase: "idle", events: [], retrySeconds: remaining() });
    },
    tick() {
      const retrySeconds = remaining();
      if (retrySeconds !== state.retrySeconds) update({ ...state, retrySeconds });
    },
    // 공통 API는 AbortSignal 미지원. 화면 이탈 후 도착한 결과는 무시합니다.
    detach() { generation++; },
  };
}

/** Request failures return to the home form; preserve completed content on save failure. */
export function showsHomeProgress(state: State): boolean {
  if (state.phase === "idle") return false;
  // 굽기를 누르면 바로 진행 화면으로 (11/21 QA 8: 홈에서 버튼 글자만 바뀐 채 2~6초 멈춰 있었음).
  // 11/26 사용자: 범위 밖이어도 진행 화면에 머물며 안내 · 추천 질문 · 질문 고치기를 보여 줌 (홈으로 튕겨 내려 아래에 안내가 붙던 것)
  if (state.phase === "checking" || state.phase === "unsupported") return !!state.input;
  if (state.phase === "error") return !!state.result;
  return true;
}
