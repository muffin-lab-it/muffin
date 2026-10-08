/**
 * Tool 템플릿. 이 폴더를 복사해서 시작하세요.
 *
 *   cp -r src/tools/_template src/tools/<이름>
 *
 * 채울 것은 네 가지입니다: name / description / parameters / execute.
 * execute 는 반드시 ToolResult (data + source) 를 반환하고, 실패하면 throw 합니다.
 * 타임아웃·에러 처리·출처 수집은 defineTool 래퍼가 공통으로 처리합니다.
 *
 * 아래는 실제로 동작하는 예시입니다. 키 없이 쓸 수 있는 Frankfurter(ECB 환율) API 로
 * USD→KRW 환율을 조회합니다. 자기 tool 로 바꿀 때 전부 교체하세요.
 */
import { z } from "zod";
import { fetchJson } from "../../lib/http";
import { defineTool } from "../define";
import type { ToolResult } from "../types";

// 1) 입력 스키마. Agent 가 이 스키마를 보고 인자를 채웁니다.
//    모든 필드는 required 로 두세요 (optional 대신 nullable 사용).
export const parameters = z.object({
  base: z.enum(["USD", "EUR", "JPY"]).describe("기준 통화"),
  quote: z.enum(["KRW", "USD"]).describe("표시 통화"),
});

export type Input = z.infer<typeof parameters>;

// 외부 API 응답 모양. 응답을 어떻게 읽을지는 tool 담당자가 정합니다.
type FrankfurterLatest = { date: string; base: string; rates: Record<string, number> };

// 2) 실제 로직. Agent 없이도 호출할 수 있게 defineTool 바깥에 둡니다.
//    run.ts 와 index.test.ts 가 이 함수를 직접 부릅니다.
export async function execute({ base, quote }: Input): Promise<ToolResult> {
  const json = await fetchJson<FrankfurterLatest>(
    `https://api.frankfurter.app/latest?from=${base}&to=${quote}`,
  );

  const rate = json.rates[quote];
  if (rate === undefined) throw new Error(`No rate for ${base}/${quote}`);

  return {
    data: { pair: `${base}/${quote}`, rate, asOf: json.date },
    source: {
      name: "Frankfurter (ECB reference rates)",
      url: "https://www.frankfurter.app",
      asOf: json.date,
    },
    note: "ECB 고시 환율. 주말·공휴일은 직전 영업일 값입니다.",
  };
}

// 3) Agent 에 등록할 tool. 리더가 src/tools/index.ts 에 이 export 를 추가합니다.
export const sampleTool = defineTool({
  name: "get_sample_fx_rate",
  description:
    "USD/EUR/JPY 의 원화 또는 달러 환율 최신값을 조회한다. " +
    "환율이 지금 얼마인지 알고 싶을 때 사용. " +
    "과거 추이나 변동률은 제공하지 않음.",
  parameters,
  execute,
});
