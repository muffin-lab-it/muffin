import type { Source } from "../tools/types";
import type { Evidence } from "./schema";

/** tool 호출 1건의 기록. 진행상황 화면과 디버깅에 씁니다. */
export type ToolStep = {
  tool: string;
  status: "ok" | "error";
  ms: number;
  error?: string;
};

/**
 * research() 한 번에 하나씩 만들어 Agent 실행에 넘깁니다.
 * defineTool 래퍼가 여기에 증거 장부 · 출처 · 실행 기록을 쌓고, tool 이 끝날 때마다 onStep 을 부릅니다.
 */
export class ResearchContext {
  readonly sources: Source[] = [];
  readonly steps: ToolStep[] = [];
  /** 증거 장부. tool 결과(출처 단위)마다 한 줄. 리포트의 ref / refs 가 가리키는 대상. */
  readonly evidence: Evidence[] = [];
  private calls = 0;

  constructor(private readonly opts: { onStep?: (step: ToolStep) => void } = {}) {}

  /** 성공한 tool 호출마다 E1, E2 … 를 발급합니다. 실패한 호출은 번호를 쓰지 않습니다. */
  nextCallId(): string {
    this.calls += 1;
    return `E${this.calls}`;
  }

  addEvidence(entries: Evidence[]) {
    for (const e of entries) {
      this.evidence.push(e);
      this.addSources(e.source);
    }
  }

  addSources(source: Source | Source[]) {
    for (const s of Array.isArray(source) ? source : [source]) {
      if (!this.sources.some((x) => x.url === s.url && x.asOf === s.asOf)) this.sources.push(s);
    }
  }

  addStep(step: ToolStep) {
    this.steps.push(step);
    this.opts.onStep?.(step);
  }
}

/**
 * tool 이 실제로 반환한 출처를 우선하고, 모델이 적은 출처는 URL 이 겹치지 않는 것만 덧붙입니다.
 * v2 부터 출처는 증거 장부에서 만들고 모델은 출처를 쓰지 않으므로, v1 리포트 처리에만 남아 있습니다.
 */
export function mergeSources(collected: Source[], fromModel: Source[]): Source[] {
  const out = [...collected];
  for (const s of fromModel) {
    if (!s.url || out.some((x) => x.url === s.url)) continue;
    out.push(s);
  }
  return out;
}
