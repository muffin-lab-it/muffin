import { z } from "zod";

/** 리포트 구조 (Structured Output). 화면의 다섯 칸과 1:1 로 대응합니다. */
export const reportSchema = z.object({
  summary: z.string().describe("한입 요약. 2~3문장"),
  numbers: z
    .array(
      z.object({
        label: z.string().describe("예: USD/KRW"),
        value: z.string().describe("예: 1,362.50"),
        change: z.string().describe("예: -0.64% (전일 대비). 없으면 빈 문자열"),
      }),
    )
    .describe("오늘의 숫자"),
  why: z.array(z.string()).describe("왜 그럴까요. 원인 bullet"),
  impact: z.array(z.string()).describe("나에게 미치는 영향 bullet"),
  sources: z
    .array(z.object({ name: z.string(), url: z.string(), asOf: z.string() }))
    .describe("tool 이 반환한 source 를 그대로 옮긴다. 지어내지 않는다"),
  nextTopics: z.array(z.string()).describe("더해볼 것. 관련 주제 키워드"),
});

export type Report = z.infer<typeof reportSchema>;

export const depths = ["easy", "standard", "deep"] as const;
export type Depth = (typeof depths)[number];

export const areas = ["fx", "etf", "news", "rate", "macro"] as const;
export type Area = (typeof areas)[number];
