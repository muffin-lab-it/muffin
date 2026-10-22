import { z } from "zod";

/**
 * 리포트 구조 v2. 화면의 칸과 1:1 로 대응합니다.
 * 품질 원칙: 숫자와 원인은 tool 데이터에 근거해야 하고(증거 번호 인용), 근거가 없으면 없다고 드러나야 합니다.
 *
 *  writerSchema  ③ 작성 Agent 가 내는 것 (Structured Output). 출처 목록은 쓰지 않습니다.
 *  reportSchema  최종 리포트. 작성 출력에 코드가 검증 결과 · 출처 · 증거 장부를 붙인 것. 화면 · History · API 가 보는 모양.
 */

export const depths = ["easy", "standard", "deep"] as const;
export type Depth = (typeof depths)[number];

export const areas = ["fx", "etf", "news", "rate", "macro"] as const;
export type Area = (typeof areas)[number];

/** ① 접수가 분류하는 질문 의도 (2단계). 현황 / 원인 / 비교 / 판단 요청 / 범위 밖 */
export const intents = ["status", "cause", "compare", "decision", "out_of_scope"] as const;
export type Intent = (typeof intents)[number];

/** 리포트 모드. decision_facts 는 "사도 돼?" 같은 판단 요청에 거절 대신 판단에 필요한 사실만 정리해 답하는 모드. */
export const reportModes = ["research", "decision_facts", "out_of_scope"] as const;
export type ReportMode = (typeof reportModes)[number];

export const sourceSchema = z.object({ name: z.string(), url: z.string(), asOf: z.string() });

const numberItem = z.object({
  label: z.string().describe("예: KODEX 200 종가, USD/KRW"),
  value: z.string().describe("tool 데이터의 숫자 그대로, 단위 포함. 예: 101,605원, 1,341.49원"),
  change: z.string().describe("비교 기준과 변화. 예: 30일 -3.61%. 비교 데이터가 없으면 빈 문자열"),
  asOf: z.string().describe("기준일 YYYY-MM-DD. tool 데이터의 날짜"),
  ref: z
    .string()
    .nullable()
    .describe("이 숫자를 가져온 tool 결과의 id (예: E1, E3-2). tool 결과에 없는 숫자면 null"),
});

const whyItem = z.object({
  claim: z.string().describe("원인 또는 해석 한 문장"),
  evidence: z
    .string()
    .describe(
      "이 주장을 뒷받침하는 tool 데이터. 예: 'ETF 30일 수익률 -3.61% vs 기초지수 -4.37%'. " +
        "데이터로 확인되지 않은 일반적 설명이면 반드시 '데이터로 확인되지 않음' 이라고 쓴다",
    ),
  basis: z
    .enum(["data", "news", "none"])
    .describe("근거 종류. data: tool 의 숫자 데이터가 뒷받침 / news: 뉴스 기사 내용이 근거 / none: 데이터로 확인되지 않음"),
  refs: z.array(z.string()).describe('근거로 쓴 tool 결과 id 목록. 예: ["E1", "E3-2"]. none 이면 빈 배열'),
});

/** ③ 작성 Agent 의 출력. Structured Output 이라 모든 필드가 required 이고, 없으면 null 이나 빈 배열을 씁니다. */
export const writerSchema = z.object({
  summary: z.string().describe("한입 요약. 질문에 대한 답을 먼저, 그다음 핵심 숫자 하나"),
  numbers: z.array(numberItem).describe("오늘의 숫자. tool 이 반환한 값만 넣는다"),
  why: z.array(whyItem).describe("왜 그럴까요. 데이터가 뒷받침하는 원인을 먼저"),
  impact: z.array(z.string()).describe("사용자가 고른 관심 영역 관점에서 이 변화가 뜻하는 것. 권유 아님"),
  caveats: z.array(z.string()).describe("해석 시 주의점. tool 의 note 에 있는 내용(기준일 지연, 환율 영향 등)을 옮긴다"),
  dataGaps: z
    .array(z.string())
    .describe("질문에 답하려면 필요했지만 tool 로 확인하지 못한 것. 실패한 tool, 없는 데이터. 없으면 빈 배열"),
  nextTopics: z.array(z.string()).describe("더해볼 것. 이 질문 다음에 자연스럽게 궁금해질 주제 키워드"),
});
export type WriterOutput = z.infer<typeof writerSchema>;

/** 숫자 검증 상태. verified: 증거 값과 일치 / derived: Calc 결과 (계보 확인) / unverified: 검증 못 함 → 화면에서 회색 */
export const numberChecks = ["verified", "derived", "unverified"] as const;
export type NumberCheck = (typeof numberChecks)[number];

/** 증거 장부 한 줄. tool 결과(출처 단위)마다 하나. 리포트의 ref / refs 가 가리키는 대상이고, 화면의 "원본 보기" 가 됩니다. */
export const evidenceSchema = z.object({
  id: z.string().describe("E1, E3-2 (뉴스 기사), C1 (계산)"),
  tool: z.string(),
  label: z.string().describe("원본 보기 제목. 예: 금리 확인 · 한국은행 경제통계시스템(ECOS)"),
  values: z.record(z.string(), z.union([z.string(), z.number()])).describe("핵심 값만. 전체 데이터는 서버에만"),
  source: sourceSchema,
  note: z.string().optional().describe("tool 이 붙인 주의점 (기준일 지연, 단위 등). 작성 Agent 와 원본 보기가 봅니다"),
  lineage: z.object({ op: z.string(), inputs: z.array(z.string()) }).optional().describe("계산일 때: 연산과 입력 증거"),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * ② 조사 Agent 의 출력. Tool 을 부른 뒤 결과(id)마다 리포트에 쓸 만한 내용을 메모합니다.
 * 숫자의 진실은 증거 장부이고, 메모는 작성 Agent 가 맥락(무슨 일이 있었는지)을 잡는 데 씁니다.
 */
export const researchNotesSchema = z.object({
  notes: z
    .array(
      z.object({
        ref: z.string().describe("tool 결과 id (E1, E3-2)"),
        summary: z.string().describe("이 결과에서 질문과 관련된 내용 1~3문장. 숫자는 tool 이 준 값 그대로, 기준일과 함께"),
      }),
    )
    .describe("성공한 tool 결과마다 하나. 뉴스는 기사마다"),
  gaps: z.array(z.string()).describe("실패한 tool, 없는 데이터 등 확인하지 못한 것. 없으면 빈 배열"),
});
export type ResearchNotes = z.infer<typeof researchNotesSchema>;

/** ④ 검증 요약. skipped 는 검증기 없이 만든 리포트 (0단계, v1 기록). */
export const verificationSchema = z.object({
  status: z.enum(["pass", "partial", "skipped"]),
  numbers: z.object({ total: z.number(), verified: z.number(), derived: z.number(), unverified: z.number() }),
  why: z.object({ data: z.number(), news: z.number(), none: z.number(), unsupported: z.number() }),
  advice: z.number().describe("남은 권유 표현 수. 목표 0"),
  revisions: z.number().describe("검증 실패로 다시 쓴 횟수"),
  removed: z.array(z.string()).describe("검증 실패로 뺀 항목"),
});
export type Verification = z.infer<typeof verificationSchema>;

export const chartSchema = z.object({
  kind: z.enum(["line", "bar"]),
  title: z.string(),
  series: z.array(
    z.object({
      label: z.string(),
      ref: z.string().describe("점들의 출처가 되는 증거 번호"),
      points: z.array(z.object({ t: z.string(), v: z.number() })),
    }),
  ),
  events: z.array(z.object({ ref: z.string(), label: z.string(), at: z.string() })).optional().describe("차트 위에 표시할 뉴스 이벤트"),
});
export type Chart = z.infer<typeof chartSchema>;

/** 유의성 게이트 결과 (2단계). 90일 기준 z-score 로 이번 움직임이 평소 범위인지. */
export const movementSchema = z.object({
  ref: z.string(),
  zScore: z.number(),
  window: z.literal(90),
  level: z.enum(["normal", "notable", "extreme"]),
});

export const reportSchema = writerSchema.extend({
  version: z.literal(2),
  mode: z.enum(reportModes),
  notice: z.string().optional().describe("모드에 따른 상단 안내 (판단 요청 모드 등)"),
  numbers: z.array(numberItem.extend({ check: z.enum(numberChecks) })),
  sources: z.array(sourceSchema.extend({ id: z.string() })).describe("증거 장부에서 코드가 생성. 모델이 쓰지 않는다"),
  evidence: z.array(evidenceSchema),
  verification: verificationSchema,
  movement: movementSchema.optional(),
  charts: z.array(chartSchema).optional(),
  disclosure: z.string().describe("AI 생성 고지"),
});
export type Report = z.infer<typeof reportSchema>;

/** v1 리포트 (0단계 전에 저장된 History 기록). normalizeReport 가 v2 로 바꿉니다. */
export const legacyReportSchema = z.object({
  summary: z.string(),
  numbers: z.array(z.object({ label: z.string(), value: z.string(), change: z.string(), asOf: z.string() })),
  why: z.array(z.object({ claim: z.string(), evidence: z.string() })),
  impact: z.array(z.string()),
  caveats: z.array(z.string()),
  dataGaps: z.array(z.string()),
  sources: z.array(sourceSchema),
  nextTopics: z.array(z.string()),
});
export type LegacyReport = z.infer<typeof legacyReportSchema>;
