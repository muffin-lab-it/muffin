# 🧁 Muffin Lab — Money & Finance Intelligence Agent

환율, ETF, 경제뉴스, 금리, 물가 등 궁금한 금융 영역을 고르면 Agent가 필요한 Tool을 판단해 데이터를 조사하고, 핵심 변화와 원인을 **출처와 함께** 정리해주는 AI 금융 리서치 웹 서비스입니다.

> 내가 궁금한 것부터, 내가 이해할 수 있는 깊이로.

## 핵심 기능

- 관심 영역 선택: 환율 / ETF / 뉴스 / 금리 / 물가
- 설명 깊이 선택: `Easy` / `Standard` / `Deep Dive`
- 자유 질문 입력
- Agent 실행 과정 실시간 표시
- 출처가 포함된 구조화 리포트 (한입 요약 · 오늘의 숫자 · 왜 그럴까요 · 영향 · 더해볼 것)
- 리포트 History
- (선택) PDF / Notion / Google Sheets Export

## 기술 스택

Next.js (App Router) · React · TypeScript · OpenAI Agents SDK · Zod · Codex · GitHub Actions · Vercel

---

## 아키텍처

```
[Muffin Web — Next.js]
   app/(ui)/…                 프론트: 홈, 진행상황, 리포트, History
   app/api/report/route.ts    백엔드: Agent 실행 + 스트리밍 + 저장
        │
   src/agent/muffin.ts        Orchestrator Agent (리더)
        │  tools: [...]
   src/tools/index.ts         Tool 레지스트리
        ├─ fx/      💵 FX Tool     환율
        ├─ etf/     📈 ETF Tool    ETF·시장 데이터
        ├─ news/    📰 News Tool   경제뉴스
        ├─ rate/    🏦 Rate Tool   금리
        └─ macro/   📊 Macro Tool  주요 경제지표
```

사용자 흐름: 관심 영역 + 깊이 + 질문 → Agent가 tool 선택·호출 → Structured Report → History 저장

## 디렉토리 구조

```
muffin-lab/
├─ app/
│  ├─ page.tsx                 홈 (영역·깊이 선택, 질문 입력)
│  ├─ report/[id]/page.tsx     리포트 상세
│  ├─ history/page.tsx         저장한 리포트
│  └─ api/report/route.ts      POST /api/report (SSE 스트리밍)
├─ src/
│  ├─ agent/
│  │  ├─ muffin.ts             Orchestrator Agent
│  │  ├─ instructions.ts       깊이별 instruction
│  │  └─ schema.ts             리포트 zod 스키마 (Structured Output)
│  ├─ tools/
│  │  ├─ index.ts              레지스트리 (리더만 수정)
│  │  ├─ _template/            새 tool 시작용 템플릿
│  │  ├─ fx/ etf/ news/ rate/ macro/
│  │  └─ types.ts              ToolResult / Source 공통 타입
│  └─ lib/                     공통 유틸 (fetch 래퍼, 날짜, 캐시)
├─ .env.example
└─ README.md
```

---

## 시작하기

```bash
git clone https://github.com/<ORG>/muffin-lab.git
cd muffin-lab
pnpm install
cp .env.example .env.local   # 키 입력
pnpm dev                     # http://localhost:3000
```

`.env.local` 예시 (실제 키는 절대 커밋하지 않습니다)

```
OPENAI_API_KEY=
FX_API_KEY=
NEWS_API_KEY=
FRED_API_KEY=
```

---

## Tool 만들기 가이드 (팀원용)

하나의 tool은 **파일 하나**입니다. `src/tools/_template`을 복사해서 시작하세요.

```bash
cp -r src/tools/_template src/tools/fx
```

### 1. 규격

`name / description / parameters / execute` 4개를 채우면 됩니다.

```ts
// src/tools/fx/index.ts
import { tool } from "@openai/agents";
import { z } from "zod";
import type { ToolResult } from "../types";

export const fxTool = tool({
  name: "get_fx_rate",
  description:
    "USD/JPY/EUR의 원화 환율(한국은행 매매기준율)과 최근 N일 변동률을 조회한다. " +
    "환율이 올랐는지 내렸는지, 얼마나 움직였는지 알고 싶을 때 사용.",
  parameters: z.object({
    currency: z.enum(["USD", "JPY", "EUR"]).describe("조회할 통화"),
    days: z.number().int().min(1).max(365).describe("비교 기간(일)"),
  }),
  execute: async ({ currency, days }): Promise<ToolResult> => {
    const res = await fetch(`https://api.example.com/fx?base=${currency}&days=${days}`, {
      headers: { Authorization: `Bearer ${process.env.FX_API_KEY}` },
    });
    if (!res.ok) throw new Error(`FX API ${res.status}`);
    const json = await res.json();

    return {
      data: {
        currency,
        rate: json.latest,
        change: json.latest - json.past,
        changePct: ((json.latest - json.past) / json.past) * 100,
        asOf: json.date,
      },
      source: {
        name: "한국은행 경제통계시스템",
        url: "https://ecos.bok.or.kr",
        asOf: json.date,
      },
    };
  },
});
```

### 2. 반환 규격 — `source`는 필수

리포트의 출처 표시가 핵심 기능이라, 모든 tool은 아래 타입을 반환합니다.

```ts
// src/tools/types.ts
export type Source = {
  name: string;   // "한국은행 경제통계시스템", "Investing.com"
  url: string;    // 사용자가 클릭해 확인할 수 있는 링크
  asOf: string;   // 데이터 기준 시각 (ISO 8601)
};

export type ToolResult<T = unknown> = {
  data: T;              // Agent가 읽을 데이터 (JSON 직렬화 가능해야 함)
  source: Source;       // 출처 1개 (여러 개면 Source[])
  note?: string;        // 데이터 해석 시 주의점 (선택)
};
```

### 3. description 작성 팁

Agent는 `description`만 보고 어떤 tool을 쓸지 결정합니다.
- **무엇을** 반환하는지 + **언제** 쓰는지 두 문장으로
- 입력 예시를 넣으면 선택 정확도가 올라갑니다
- 못 하는 것도 적어두면 오호출이 줄어듭니다 ("개별 종목 시세는 제공하지 않음")

### 4. 체크리스트 (PR 올리기 전)

- [ ] `pnpm test src/tools/<이름>` 통과 (최소 1개: 정상 응답 파싱)
- [ ] API 키는 `process.env`로만 접근, 코드에 하드코딩 없음
- [ ] 외부 API 실패 시 `throw new Error(...)`로 명확히 실패 (빈 값 반환 금지)
- [ ] `source.url`이 실제로 열리는 링크
- [ ] `src/tools/<이름>/README.md`에 데이터 소스·키 발급 방법·제한(rate limit) 기록
- [ ] Codex 리뷰 1회 이상 반영

### 5. 로컬에서 단독 실행

```bash
pnpm tsx src/tools/fx/run.ts --currency USD --days 30
```

(`_template/run.ts`에 단독 실행용 스크립트가 있습니다. Agent 없이 tool만 테스트할 때 사용.)

---

## Tool 연결 (리더)

레지스트리에 한 줄 추가하면 Agent가 사용합니다.

```ts
// src/tools/index.ts
import { fxTool } from "./fx";
import { etfTool } from "./etf";
import { newsTool } from "./news";
import { rateTool } from "./rate";
import { macroTool } from "./macro";

export const muffinTools = [fxTool, etfTool, newsTool, rateTool, macroTool];
```

```ts
// src/agent/muffin.ts
import { Agent, run } from "@openai/agents";
import { muffinTools } from "../tools";
import { reportSchema } from "./schema";
import { instructionsFor, type Depth } from "./instructions";

export function createMuffinAgent(depth: Depth) {
  return new Agent({
    name: "Muffin Research Agent",
    instructions: instructionsFor(depth),
    tools: muffinTools,
    outputType: reportSchema,
  });
}

export async function research(question: string, depth: Depth) {
  const agent = createMuffinAgent(depth);
  return run(agent, question);                 // 스트리밍은 { stream: true }
}
```

리포트 스키마(Structured Output)

```ts
// src/agent/schema.ts
import { z } from "zod";

export const reportSchema = z.object({
  summary: z.string().describe("한입 요약, 2~3문장"),
  numbers: z.array(z.object({ label: z.string(), value: z.string(), change: z.string() })),
  why: z.array(z.string()).describe("왜 그럴까요 — 원인 bullet"),
  impact: z.array(z.string()).describe("나에게 미치는 영향 bullet"),
  sources: z.array(z.object({ name: z.string(), url: z.string(), asOf: z.string() })),
  nextTopics: z.array(z.string()).describe("더해볼 것 — 관련 주제 키워드"),
});
```

---

## 협업 규칙

**브랜치**
- `main`: 배포 브랜치, 직접 push 금지
- `feat/<tool>-<내용>` / `fix/…` / `docs/…` 에서 작업 → `main`으로 PR

**PR**
- 제목: `[fx] 환율 변동률 계산 추가`
- 본문: 무엇을 / 왜 / 테스트 방법 / 스크린샷(화면이면)
- CI(lint + test) 통과 + 리뷰 1명 승인 후 머지
- 리뷰어: 자기 tool → 리더, 백/프론트 → 같은 파트 팀원 1명

**Codex 활용**
- 구현: "이 tool 규격에 맞춰 ETF 시세 조회 tool을 만들어줘" + `_template` 경로 첨부
- 테스트: "이 tool의 정상/실패 케이스 테스트 작성해줘"
- 리뷰: PR 올리기 전 "이 변경에서 에러 처리와 타입 누락 찾아줘"
- Codex가 만든 코드도 본인이 읽고 이해한 뒤 올립니다

**커밋**
- `feat:` `fix:` `docs:` `test:` `chore:` prefix 사용

---

## 팀

| 역할 | 담당 | GitHub |
|---|---|---|
| 리더 — Orchestrator · 인프라 · 배포 | | |
| 💵 FX Tool | | |
| 📈 ETF Tool | | |
| 📰 News Tool | | |
| 🏦 Rate Tool | | |
| 📊 Macro Tool | | |

4주차부터 백엔드 2 / 프론트 3으로 Muffin Web을 분담합니다.

## 일정

| 주차 | 날짜 | 주제 | 결과물 |
|---|---|---|---|
| OT | 10/2 | 팀 빌딩, 역할 배정 | Org 레포, tool 배정 |
| 1 | 10/9 | 문제 정의 & Muffin 설계 | Research Question / UI·Agent 구조 |
| 2 | 10/16 | 금융 데이터 & Tools | 5개 Tool MVP |
| 3 | 10/23 | OpenAI Research Agent | Tool Calling / Structured Report |
| 4 | 10/30 | Personalized Report | Easy · Standard · Deep Dive |
| 5 | 11/6 | Muffin Web 통합 | React UI + Agent 실행 + History |
| 6 | 11/13 | Integration & Ship | 배포 / Demo / 회고 |
| 고도화 | 11/14~11/30 | 기능 보완, README, 발표 준비 | 최종 배포 |
| 발표 | 12/16 | 성과공유회 | 발표 + 라이브 데모 |

---

## 운영 원칙

- 머핀랩은 **투자 종목을 추천하는 서비스가 아닙니다.** 금융 정보를 찾고 이해하기 위한 리서치 도구입니다. 리포트에 매수/매도 권유 표현을 넣지 않습니다.
- 개인 금융정보를 수집·저장하지 않습니다.
- API Key 등 민감정보는 `.env.local`에만 두고 저장소에 올리지 않습니다.

## License

MIT
