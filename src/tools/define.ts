/**
 * 모든 tool 을 감싸는 공통 래퍼. 팀원은 SDK 의 tool() 대신 이걸 씁니다.
 *
 * 래퍼가 하는 일 (tool 마다 똑같이 적용되는 것만):
 *  - 타임아웃: execute 가 timeoutMs(기본 10초) 안에 끝나지 않으면 실패 처리
 *  - 에러: execute 가 throw 하면 Agent 전체를 멈추지 않고, 모델에게 "이 tool 은 실패했다" 고 알립니다
 *  - 출처 수집: 반환값의 source 를 ResearchContext 에 쌓아 리포트 sources 에 반드시 들어가게 합니다
 *  - 실행 기록: 어떤 tool 이 몇 ms 걸렸는지, 성공했는지 기록합니다 (진행상황 화면용)
 *
 * 응답 파싱, 값 계산, 데이터 해석은 각 tool 의 execute 가 담당합니다.
 */
import { tool, type FunctionTool, type RunContext } from "@openai/agents";
import type { z } from "zod";
import { ResearchContext } from "../agent/context";
import type { ToolResult } from "./types";

export type ToolSpec<P extends z.ZodObject> = {
  /** 모델이 보는 이름. get_<영역>_<무엇> */
  name: string;
  /** 무엇을 / 언제 / 못 하는 것. 모델은 이것만 보고 tool 을 고릅니다 */
  description: string;
  /** 입력 스키마. 모든 필드 required (optional 대신 nullable) */
  parameters: P;
  /** 실제 로직. 실패하면 throw. 빈 값을 돌려주지 않습니다 */
  execute: (input: z.infer<P>) => Promise<ToolResult>;
  /** 기본 10_000ms */
  timeoutMs?: number;
};

export function defineTool<P extends z.ZodObject>(
  spec: ToolSpec<P>,
): FunctionTool<ResearchContext, z.ZodObject, unknown> {
  const timeoutMs = spec.timeoutMs ?? 10_000;

  return tool<z.ZodObject, ResearchContext, unknown>({
    name: spec.name,
    description: spec.description,
    // 제네릭 P 는 spec 의 타입 추론용이고, SDK 에는 ZodObject 로 넘깁니다.
    parameters: spec.parameters as z.ZodObject,
    timeoutMs,
    execute: async (input, runContext?: RunContext<ResearchContext>) => {
      const ctx = runContext?.context instanceof ResearchContext ? runContext.context : undefined;
      const started = Date.now();
      try {
        const result = await spec.execute(input as z.infer<P>);
        ctx?.addSources(result.source);
        ctx?.steps.push({ tool: spec.name, status: "ok", ms: Date.now() - started });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx?.steps.push({ tool: spec.name, status: "error", ms: Date.now() - started, error: message });
        return {
          error: `${spec.name} 호출 실패: ${message}`,
          instruction: "이 tool 의 데이터 없이 리포트를 작성하고, 해당 데이터를 확인하지 못했다고 명시할 것. 값을 추측하지 말 것.",
        };
      }
    },
  });
}
