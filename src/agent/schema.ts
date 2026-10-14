import { z } from "zod";

/**
 * 리포트 구조 (Structured Output). 화면의 칸과 1:1 로 대응합니다.
 * 품질 원칙: 숫자와 원인은 tool 데이터에 근거해야 하고, 근거가 없으면 없다고 드러나야 합니다.
 */
export const reportSchema = z.object({
  summary: z.string().describe("한입 요약. 질문에 대한 답을 먼저, 그다음 핵심 숫자 하나"),
  numbers: z
    .array(
      z.object({
        label: z.string().describe("예: KODEX 200 종가, USD/KRW"),
        value: z.string().describe("tool 데이터의 숫자 그대로, 단위 포함. 예: 101,605원, 1,341.49원"),
        change: z.string().describe("비교 기준과 변화. 예: 30일 -3.61%. 비교 데이터가 없으면 빈 문자열"),
        asOf: z.string().describe("기준일 YYYY-MM-DD. tool 데이터의 날짜"),
      }),
    )
    .describe("오늘의 숫자. tool 이 반환한 값만 넣는다"),
  why: z
    .array(
      z.object({
        claim: z.string().describe("원인 또는 해석 한 문장"),
        evidence: z
          .string()
          .describe(
            "이 주장을 뒷받침하는 tool 데이터. 예: 'ETF 30일 수익률 -3.61% vs 기초지수 -4.37%'. " +
              "데이터로 확인되지 않은 일반적 설명이면 반드시 '데이터로 확인되지 않음' 이라고 쓴다",
          ),
      }),
    )
    .describe("왜 그럴까요. 데이터가 뒷받침하는 원인을 먼저"),
  impact: z.array(z.string()).describe("사용자가 고른 관심 영역 관점에서 이 변화가 뜻하는 것. 권유 아님"),
  caveats: z.array(z.string()).describe("해석 시 주의점. tool 의 note 에 있는 내용(기준일 지연, 환율 영향 등)을 옮긴다"),
  dataGaps: z
    .array(z.string())
    .describe("질문에 답하려면 필요했지만 tool 로 확인하지 못한 것. 실패한 tool, 없는 데이터. 없으면 빈 배열"),
  sources: z
    .array(z.object({ name: z.string(), url: z.string(), asOf: z.string() }))
    .describe("tool 이 반환한 source 를 그대로 옮긴다. 지어내지 않는다"),
  nextTopics: z.array(z.string()).describe("더해볼 것. 이 질문 다음에 자연스럽게 궁금해질 주제 키워드"),
});

export type Report = z.infer<typeof reportSchema>;

export const depths = ["easy", "standard", "deep"] as const;
export type Depth = (typeof depths)[number];

export const areas = ["fx", "etf", "news", "rate", "macro"] as const;
export type Area = (typeof areas)[number];
