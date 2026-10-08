import type { Source } from "../tools/types";

/** tool 호출 1건의 기록. 진행상황 화면과 디버깅에 씁니다. */
export type ToolStep = {
  tool: string;
  status: "ok" | "error";
  ms: number;
  error?: string;
};

/**
 * research() 한 번에 하나씩 만들어 Agent 실행에 넘깁니다.
 * defineTool 래퍼가 여기에 출처와 실행 기록을 쌓습니다.
 */
export class ResearchContext {
  readonly sources: Source[] = [];
  readonly steps: ToolStep[] = [];

  addSources(source: Source | Source[]) {
    for (const s of Array.isArray(source) ? source : [source]) {
      if (!this.sources.some((x) => x.url === s.url && x.asOf === s.asOf)) this.sources.push(s);
    }
  }
}

/** tool 이 실제로 반환한 출처를 우선하고, 모델이 적은 출처는 URL 이 겹치지 않는 것만 덧붙입니다. */
export function mergeSources(collected: Source[], fromModel: Source[]): Source[] {
  const out = [...collected];
  for (const s of fromModel) {
    if (!s.url || out.some((x) => x.url === s.url)) continue;
    out.push(s);
  }
  return out;
}
