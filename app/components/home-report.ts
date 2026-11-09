import type { MuffinEvent } from "@/src/agent/events";
import { ApiError, streamReport, type ReportRequest, type ReportResponse } from "@/src/lib/api";
import { getReport, saveReport } from "@/src/lib/history";
import type { ProgressError } from "./Progress";

type State = {
  phase: "idle" | "research" | "saving" | "error" | "navigating";
  input?: ReportRequest;
  events: readonly MuffinEvent[];
  result?: ReportResponse;
  error?: ProgressError;
  retrySeconds: number;
};

/** 홈의 한 요청을 관리합니다. 중복 실행과 화면 이탈 후의 저장·이동을 막습니다. */
export function createHomeReport(deps = { streamReport, saveReport, getReport }, navigate: (url: string) => void) {
  let state: State = { phase: "idle", events: [], retrySeconds: 0 };
  let generation = 0;
  let retryAt = 0;
  const listeners = new Set<() => void>();
  const update = (next: State) => { state = next; listeners.forEach(listener => listener()); };
  const remaining = () => Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  const busy = () => ["research", "saving", "navigating"].includes(state.phase);

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
    update({ phase: "research", input, events: [], retrySeconds: 0 });
    let terminal = false;
    try {
      const result = await deps.streamReport(input, event => {
        if (token !== generation || terminal) return;
        terminal = event.type === "error" || event.type === "report";
        update({ ...state, events: [...state.events, event] });
      });
      if (token !== generation) return;
      await persist(token, input, result);
    } catch (error) {
      if (token !== generation) return;
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
