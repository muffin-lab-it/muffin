/**
 * 모든 tool 을 감싸는 공통 래퍼. 팀원은 SDK 의 tool() 대신 이걸 씁니다.
 *
 * 래퍼가 하는 일 (tool 마다 똑같이 적용되는 것만):
 *  - 타임아웃: execute 가 timeoutMs(기본 10초) 안에 끝나지 않으면 실패 처리
 *  - 재시도: 연결 실패 · 5xx 처럼 빨리 실패했으면(제한 시간의 절반 전) 잠깐 뒤 execute 를 한 번 더 돌립니다. 4xx · 429 는 다시 하지 않습니다.
 *    fetchJson 의 8초 시간 초과는 남은 시간이 없어 보통 바로 폴백으로 갑니다 (tool 이 짧은 timeoutMs 를 준 경우만 재시도)
 *  - 회로 차단기: 같은 tool 이 5분 안에 2번 일시적 실패하면 1분 동안 호출을 건너뛰고 바로 폴백으로, 그 뒤 3초 제한으로 한 번 찔러 봅니다 (src/tools/breaker.ts)
 *  - 폴백: 그래도 실패하면 같은 입력으로 마지막에 성공한 응답(24시간 안, src/tools/cache.ts)이 있을 때 그것을 대신 씁니다.
 *    장부 note 에 "N시간 전 응답" 이라고 적고 실행 기록에 fallbackAgeMs 를 남깁니다. 외부 API 가 잠깐 느릴 때 리포트가 빈칸이 되지 않게 (시연 대비)
 *  - 에러: 폴백도 없으면 Agent 전체를 멈추지 않고, 모델에게 "이 tool 은 실패했다" 고 알립니다
 *  - 증거 번호: 성공한 결과마다 E1, E2 … 를 붙여 증거 장부에 기록하고, 모델에게도 같은 id 를 돌려줍니다.
 *    모델은 리포트의 숫자와 원인에 이 id 를 인용하고, 검증은 이 id 로 원본과 대조합니다. 계산 tool(kind: calc)은 C1, C2 … 와 lineage.
 *    출처를 목록으로 돌려주는 tool(뉴스)은 항목마다 E3-1, E3-2 … (1건이어도 E3-1)
 *  - 핵심 값: 장부에는 data 전체가 아니라 핵심 값만 남깁니다. 기본은 data 의 짧은 원시값이고,
 *    tool 이 `evidence` 로 직접 고를 수 있습니다 (아래 ToolSpec 참고)
 *  - 출처 수집: 반환값의 source 를 ResearchContext 에 쌓아 리포트 sources 에 반드시 들어가게 합니다
 *  - 실행 기록: 어떤 tool 이 몇 ms 걸렸는지, 성공했는지 기록하고 진행 화면에 알립니다 (onStep)
 *  - 키 가리기: 에러 메시지에 .env 의 키 값이 섞여 있으면 모델·로그에 닿기 전에 지웁니다
 *
 * 응답 파싱, 데이터 해석은 각 tool 의 execute 가 담당합니다. 값 계산은 계산 tool(src/tools/calc)이 담당합니다.
 */
import { tool, type FunctionTool, type RunContext } from "@openai/agents";
import type { z } from "zod";
import { ResearchContext } from "../agent/context";
import { labelFor } from "../agent/events";
import type { Evidence } from "../agent/schema";
import { isRetryable } from "../lib/http";
import { redactSecrets } from "../lib/redact";
import { formatAge } from "../lib/age";
import { PROBE_TIMEOUT_MS, before as breakerBefore, onFailure as breakerFailure, onNonTransient as breakerNonTransient, onSuccess as breakerSuccess } from "./breaker";
import { RECALL_TIMEOUT_MS, recall, remember } from "./cache";
import type { ToolResult } from "./types";

/** 재시도 전에 잠깐 쉬는 시간 */
export const RETRY_DELAY_MS = 300;

/** 증거 장부에 올리는 핵심 값. 숫자 · 날짜 · 짧은 라벨만 (불리언은 문자열로 바뀜). */
export type EvidenceValues = Record<string, string | number>;

/** 기본 선택에서 이보다 긴 문자열(정의문 · 기사 본문 · URL 목록)은 장부에 올리지 않습니다. */
export const MAX_VALUE_LENGTH = 200;
/** 기본 선택이 중첩 객체를 따라 들어가는 깊이 (latest.previousYear.change 까지). 배열은 따라가지 않습니다. */
export const MAX_VALUE_DEPTH = 3;
/** 기본 선택이 장부 한 항목에 올리는 값의 최대 개수. */
export const MAX_VALUES = 40;

export type ToolSpec<P extends z.ZodObject, D = unknown> = {
  /** 모델이 보는 이름. get_<영역>_<무엇> */
  name: string;
  /** 무엇을 / 언제 / 못 하는 것. 모델은 이것만 보고 tool 을 고릅니다 */
  description: string;
  /** 입력 스키마. 모든 필드 required (optional 대신 nullable) */
  parameters: P;
  /**
   * 실제 로직. 실패하면 throw. 빈 값을 돌려주지 않습니다.
   * 두 번째 인자로 실행 컨텍스트(장부)가 오지만 데이터 tool 은 쓰지 않습니다. 계산 tool 만 장부의 값을 읽습니다.
   */
  execute: (input: z.infer<P>, ctx?: ResearchContext) => Promise<ToolResult<D>>;
  /** 기본 10_000ms */
  timeoutMs?: number;
  /**
   * data(기본): 외부 데이터를 가져오는 tool. 성공마다 E 번호.
   * calc: 장부의 값으로 계산하는 tool. 성공마다 C 번호를 쓰고 반환값의 lineage 를 장부에 남깁니다. src/tools/calc 하나뿐입니다.
   */
  kind?: "data" | "calc";
  /**
   * 증거 장부에 올릴 핵심 값 (선택). 리포트의 숫자가 인용하고, 검증이 원본과 대조하는 값입니다.
   *  - 생략하면 data 안의 원시값 중 200자 이하인 것을 올립니다. 중첩 객체는 `latest.close` 처럼 점으로 이어
   *    3단계까지 따라가고 배열은 건너뜁니다. 출처가 여러 개(뉴스)면 출처 수와 길이가 같은 배열(articles 등)에서 항목마다 고릅니다.
   *  - 객체 하나를 돌려주면 모든 출처에 같은 값이 붙고, 출처 수와 같은 길이의 배열을 돌려주면
   *    출처마다 하나씩 붙습니다 (E3-1, E3-2).
   *  - 긴 설명문(정의 · 본문)은 data 에만 두세요. 모델은 data 전체를 보고, 장부는 검증과 "원본 보기" 에 씁니다.
   *  - 이 함수가 throw 하거나 배열 길이가 출처 수와 다르면 기본 선택으로 돌아갑니다. tool 호출은 실패 처리하지 않습니다.
   */
  evidence?: (data: D) => EvidenceValues | EvidenceValues[];
};

/**
 * data 의 원시값을 뽑아 증거 장부의 "핵심 값" 으로 둡니다. 중첩 객체는 `latest.close` 처럼 점으로 이어 3단계까지,
 * 배열과 긴 문자열은 뺍니다. 전체 데이터는 모델에게만 가고, 리포트(History)에는 이 값만 남습니다.
 */
export function pickPrimitives(data: unknown): EvidenceValues {
  const out: EvidenceValues = {};
  const walk = (obj: unknown, prefix: string, depth: number) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (Object.keys(out).length >= MAX_VALUES) return;
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
      else if (typeof v === "boolean") out[key] = String(v);
      else if (typeof v === "string" && v.length <= MAX_VALUE_LENGTH) out[key] = v;
      else if (v && typeof v === "object" && !Array.isArray(v) && depth < MAX_VALUE_DEPTH) walk(v, key, depth + 1);
    }
  };
  walk(data, "", 1);
  return out;
}

/**
 * 출처가 여러 개(뉴스 기사)면 data 안에서 출처 수와 길이가 같은 객체 배열(articles 등)을 찾아
 * 기사마다 그 기사의 핵심 값을 둡니다. 그래야 E3-2 를 인용한 원인을 그 기사로 확인할 수 있습니다. 없으면 undefined.
 */
export function perSourceValues(data: unknown, count: number): EvidenceValues[] | undefined {
  if (count < 2 || !data || typeof data !== "object" || Array.isArray(data)) return undefined;
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length === count && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      return v.map(pickPrimitives);
    }
  }
  return undefined;
}

/** tool 이 evidence 로 고른 값을 장부 형식에 맞게 정리합니다. 길이 제한은 두지 않습니다 (직접 고른 값이므로). */
function sanitizeValues(values: unknown): EvidenceValues {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  const out: EvidenceValues = {};
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = String(v);
    else if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** 출처 수(count)만큼의 핵심 값 목록. tool 의 evidence 가 있으면 그것을, 없거나 틀리면 기본 선택을 씁니다. */
export function evidenceValues<D>(spec: Pick<ToolSpec<z.ZodObject, D>, "evidence">, data: D, count: number): EvidenceValues[] {
  if (spec.evidence) {
    try {
      const picked = spec.evidence(data);
      if (Array.isArray(picked)) {
        if (picked.length === count) return picked.map(sanitizeValues);
      } else if (picked && typeof picked === "object") {
        const one = sanitizeValues(picked);
        return Array.from({ length: count }, () => one);
      }
    } catch {
      // evidence 가 틀려도 데이터 조회는 성공이므로, 아래 기본 선택으로 돌아갑니다.
    }
  }
  const aggregate = pickPrimitives(data);
  const perItem = perSourceValues(data, count);
  return Array.from({ length: count }, (_, k) => perItem?.[k] ?? aggregate);
}

export function defineTool<P extends z.ZodObject, D = unknown>(
  spec: ToolSpec<P, D>,
): FunctionTool<ResearchContext, z.ZodObject, unknown> {
  const timeoutMs = spec.timeoutMs ?? 10_000;
  const cacheable = spec.kind !== "calc";

  return tool<z.ZodObject, ResearchContext, unknown>({
    name: spec.name,
    description: spec.description,
    // 제네릭 P 는 spec 의 타입 추론용이고, SDK 에는 ZodObject 로 넘깁니다.
    parameters: spec.parameters as z.ZodObject,
    // 시간 초과는 아래에서 먼저 잡아 폴백 · 실행 기록을 남깁니다. SDK 의 제한은 그 뒤의 안전장치입니다 (캐시 표 쓰기 2초 · 읽기 1.5초가 그 안에 듦).
    timeoutMs: timeoutMs + 3_000,
    execute: async (input, runContext?: RunContext<ResearchContext>) => {
      const ctx = runContext?.context instanceof ResearchContext ? runContext.context : undefined;
      const started = Date.now();
      let result: ToolResult<D>;
      let fallbackAgeMs: number | undefined;
      // 회로 차단기: 연속 실패한 tool 은 호출을 건너뛰거나(open) 짧게 한 번만 찔러 봅니다(half_open). 계산 tool 은 외부 호출이 없어 해당 없음
      const gate = cacheable ? breakerBefore(spec.name) : { skip: false as const, probe: false };
      const breaker: "open" | "half_open" | undefined = gate.skip ? "open" : gate.probe ? "half_open" : undefined;
      // 제한 시간은 재시도를 포함한 전체에 걸립니다 (찔러 볼 때는 3초). 한 번 돌리기 = 남은 시간 안에 execute 가 끝나야 함
      const limitMs = gate.probe ? Math.min(PROBE_TIMEOUT_MS, timeoutMs) : timeoutMs;
      const runOnce = async (): Promise<ToolResult<D>> => {
        const remaining = started + limitMs - Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<never>((_, reject) => {
          // name 을 TimeoutError 로 두어 isRetryable 이 일시적 실패로 보게 합니다 (회로 차단기가 멈춘 API 를 셀 수 있게)
          timer = setTimeout(() => reject(Object.assign(new Error(`${limitMs / 1000}초 안에 끝나지 않음 (timeout)`), { name: "TimeoutError" })), Math.max(0, remaining));
        });
        try {
          return await Promise.race([spec.execute(input as z.infer<P>, ctx), limit]);
        } finally {
          clearTimeout(timer);
        }
      };
      try {
        if (gate.skip) {
          throw new Error(`회로 차단기 열림: 최근 연속 실패해 호출을 건너뜀 (${Math.ceil(gate.retryAfterMs / 1000)}초 뒤 다시 시도)`);
        }
        try {
          result = await runOnce();
        } catch (err) {
          // 빨리 실패한 일시적 오류(5xx · 연결 · 짧은 시간 초과)만 한 번 더. 제한 시간의 절반을 넘겼거나 찔러 보는 중이면 바로 폴백으로
          if (gate.probe || !isRetryable(err) || Date.now() - started > limitMs / 2) throw err;
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          result = await runOnce();
        }
        if (cacheable) breakerSuccess(spec.name);
        // 성공한 응답은 다음에 같은 호출이 실패할 때를 위해 기억해 둡니다. 표 쓰기까지 기다리는 것은
        // 서버리스에서 응답이 끝나면 뒤에 남은 일이 죽을 수 있어서이고, 2초를 넘기면 메모리에만 남기고 갑니다.
        if (cacheable) await remember(spec.name, input, result);
      } catch (err) {
        // 일시적 실패만 회로에 셉니다. 입력 잘못(4xx)은 다른 입력까지 막으면 안 되고 API 가 답한 것이므로 회로는 닫습니다. 건너뛴 호출은 실패가 아닙니다
        if (cacheable && !gate.skip) (isRetryable(err) ? breakerFailure : breakerNonTransient)(spec.name);
        // tool 이 직접 만든 에러 메시지에 키가 섞여도 모델과 로그로 새지 않게 합니다.
        const message = redactSecrets(err instanceof Error ? err.message : String(err));
        // 표 조회는 SDK 의 안전장치(+3초)보다 먼저 끝나야 실행 기록 · 실패 응답을 우리가 남길 수 있습니다
        const budget = Math.max(200, Math.min(RECALL_TIMEOUT_MS, started + timeoutMs + 2_500 - Date.now()));
        const cached = cacheable ? await recall(spec.name, input, { timeoutMs: budget }) : null;
        if (!cached) {
          ctx?.addStep({ tool: spec.name, status: "error", ms: Date.now() - started, error: message, ...(breaker ? { breaker } : {}) });
          return {
            error: `${spec.name} 호출 실패: ${message}`,
            instruction: "이 tool 의 데이터 없이 리포트를 작성하고, 해당 데이터를 확인하지 못했다고 명시할 것. 값을 추측하지 말 것.",
          };
        }
        // 마지막 성공 응답으로 폴백. 모델과 장부에 그 사실을 적어 리포트가 "지금 값" 처럼 말하지 않게 합니다.
        fallbackAgeMs = cached.ageMs;
        const age = formatAge(cached.ageMs);
        const stale = cached.result as ToolResult<D>;
        result = {
          ...stale,
          note: `${stale.note ? `${stale.note} ` : ""}이번 조회는 실패해 ${age} 전에 받은 같은 조회의 응답을 다시 썼습니다. 데이터 기준일은 출처의 asOf 그대로입니다. 리포트에서 이 값을 "지금 값" 이 아니라 "직전 조회 값" 으로 쓸 것 (확인하지 못한 것 목록에는 자동으로 적힙니다).`,
        };
      }
      if (!ctx) return result;

      // 출처를 목록으로 돌려주는 tool(뉴스 기사)은 E3-1, E3-2 처럼 나눠서 기사 하나하나를 인용할 수 있게 합니다.
      // 기사가 1건이어도 E3-1 입니다. 건수에 따라 E3 · E3-1 로 모양이 바뀌면 모델이 없는 번호를 인용합니다. 계산은 C 번호입니다.
      const got = result;
      const id = spec.kind === "calc" ? ctx.nextCalcId() : ctx.nextCallId();
      const listed = Array.isArray(got.source);
      const sources = Array.isArray(got.source) ? got.source : [got.source];
      const withIds = sources.map((s, k) => ({ id: listed ? `${id}-${k + 1}` : id, ...s }));
      const values = evidenceValues(spec, got.data, sources.length);
      const entries: Evidence[] = withIds.map((s, k) => ({
        id: s.id,
        tool: spec.name,
        label: `${labelFor(spec.name)} · ${s.name}`,
        values: values[k],
        source: { name: s.name, url: s.url, asOf: s.asOf },
        ...(got.note ? { note: got.note } : {}),
        ...(got.lineage ? { lineage: got.lineage } : {}),
      }));
      ctx.addEvidence(entries);
      ctx.addStep({ tool: spec.name, status: "ok", ms: Date.now() - started, ...(fallbackAgeMs !== undefined ? { fallbackAgeMs } : {}), ...(breaker ? { breaker } : {}) });
      // 목록이면 인용할 수 있는 번호 목록(ids: E3-1 …)만 돌려줍니다. 호출 번호(E3)는 장부에 없어서 모델에게 보여 주지 않습니다.
      return listed ? { ids: withIds.map((s) => s.id), ...got, source: withIds } : { id, ...got, source: withIds[0] };
    },
  });
}
