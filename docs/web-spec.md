# 머핀 Web 명세서: 백엔드 · 프론트 할 일과 계약

백엔드와 프론트가 맞춰야 할 계약과 각자 할 일을 한 파일에 모았습니다. 이 파일을 그대로 AI 에게 주고 자기 이름의 할 일을 맡기면 됩니다. 날짜는 정하지 않고 순서(6절)만 둡니다. 첫 목표는 홈 → 진행 → 상세 → 저장함 흐름을 Mock 으로 시연하는 것입니다.

## 0. AI 에게 맡길 때 지킬 것

1. 이 파일 전체와 `AGENTS.md` 를 먼저 읽고, 5절에서 **자기 이름의 할 일만** 합니다.
2. 고치는 파일은 2절에서 자기 담당인 것만입니다. 다른 파일이 필요하면 멈추고 사람에게 묻습니다.
3. 3 · 4절의 계약(요청 · 응답 · 이벤트 · 함수 모양 · 표)은 바꾸지 않습니다. 바꿔야 하면 멈추고 Discord 에 "어느 화면에 어떤 필드" 로 적습니다.
4. 6절의 "먼저 끝나야 하는 것" 이 아직 머지 전이면 그 파일은 건드리지 않고 기다립니다.
5. Next.js 16 입니다. 코드를 쓰기 전에 `node_modules/next/dist/docs/` 에서 해당 문서를 읽습니다.
6. 브랜치는 `feat/<영역>-<내용>`, 커밋은 `feat:` · `fix:` · `test:` · `docs:` + 한국어 한 줄입니다. main 에 직접 push 하지 않습니다.
7. PR 전에 `pnpm lint && pnpm typecheck && pnpm test` 를 통과시키고, 본문은 `.github/PULL_REQUEST_TEMPLATE.md` 를 따릅니다.
8. 키는 `process.env` 로만 읽고 커밋하지 않습니다. 라이브러리 추가는 Discord 에 공유한 뒤 PR 본문에 적습니다.
9. 화면은 리더에게 받은 실제 키로 개발합니다. `MUFFIN_MOCK=1` 은 키가 막혔을 때와 Mock 시연에만 씁니다.

## 1. 흐름

1. 홈(`app/page.tsx`)에서 질문하면 `streamReport` 가 `POST /api/report/stream` 을 부릅니다. 헤더 `X-Muffin-Client` 는 `api.ts` 가 붙입니다.
2. 라우트는 출처 검사 → 호출 제한 → 바디 검사 → `research()`(분류 → 조사 → 정제 → 작성 → 검증) 순서로 돌고, 진행 이벤트를 NDJSON 으로 흘립니다. 끝나면 실행 로그를 남깁니다.
3. 진행 화면(`Progress.tsx`)이 이벤트를 그립니다. 마지막 `report` 이벤트가 오면 `saveReport` 로 저장하고 `/report/<id>` 로 이동합니다.
4. 상세(`app/report/[id]`)는 `getReport(id)` 로 리포트를 그립니다. 저장함(`app/history`)은 `listReports` · `deleteReport` 를 씁니다.
5. 저장은 1차가 브라우저 localStorage, 2차가 `/api/history` → Supabase 입니다. 실행 로그도 2차부터 Supabase `runs` 표에 들어갑니다.

```mermaid
flowchart LR
  Home["홈 page.tsx"] --> API["src/lib/api.ts"] --> R["/api/report/stream · /api/report"]
  R --> G["출처 → 호출 제한 → 바디 → research() → log"]
  R -- NDJSON --> Prog["Progress.tsx"] -- report --> HIS["src/lib/history.ts"] --> Detail["report/[id]"]
  Hist["history/page.tsx"] --> HIS
  HIS -. 2차 .-> HAPI["/api/history"] -.-> DB[("Supabase reports · runs")]
  G -. 2차 .-> DB
```

## 2. 파일과 담당

| 파일 | 하는 일 | 담당 |
| --- | --- | --- |
| `app/page.tsx` | 홈 폼, 스트림 연결, 완료 후 저장 → 상세 이동 | 은경(전환) → 은선(스트림) → 하니(폼) 순서 |
| `app/components/Progress.tsx` (신규) | 다섯 단계 진행 화면 | 은선 |
| `app/components/ReportView.tsx` | 리포트 칸 순서 · 배치 | 은선 |
| `app/components/ReportEvidence.tsx` | 숫자 배지 · 원인 아이콘 · 원본 보기 · 계산 계보 · 출처 · 검증 한 줄 | 소희 |
| `app/components/ReportNotice.tsx` (신규) | 판단 요청 · 범위 밖 배너, AI 고지 | 하니 |
| `app/history/page.tsx`, `app/report/[id]/page.tsx` | 저장함 · 상세 화면 | 하니 (비동기 전환의 호출부 수정만 은경) |
| `app/components/useHistory.ts` (선택) | 비동기 history 를 화면에서 쓰는 훅 | 하니 |
| `app/layout.tsx`, `app/components/Sidebar.tsx`, `app/globals.css` | 공용 | 전원 (바꾸기 전 Discord 한 줄) |
| `src/lib/api.ts`, `src/lib/client.ts` (신규) | fetch 창구, 브라우저 익명 id | 리더 |
| `src/lib/history.ts` | 저장 함수 4개 | 은경 |
| `app/api/report/route.ts`, `app/api/report/stream/route.ts` | 리포트 생성 API | 서영(호출 제한 · 에러 코드 · 실행 로그) → 은경(출처 검사 · 바디 크기) |
| `src/lib/ratelimit.ts` (신규) | 호출 제한 | 서영 |
| `src/lib/log.ts` | 실행 로그, `RunStage` 에 `limited`, 2차 `runs` 저장 | 서영 |
| `src/lib/guard.ts` (신규. `src/agent/guard.ts` 와 다른 파일) | 출처 검사, 바디 크기 | 은경 |
| `src/lib/db.ts` (신규) | Supabase 서버 클라이언트 · 표 타입 | 리더 |
| `app/api/history/route.ts`, `app/api/history/[id]/route.ts` (신규) | History API | 은경 |
| `supabase/migrations/*.sql` (신규) | 표 정의 · 적용 | 리더 |
| `src/agent/events.ts`, `src/agent/schema.ts` | 이벤트 · 리포트 모양 | 리더 (변경은 Discord 로 요청) |
| `app/admin/`, `src/lib/admin.ts` · `admin-auth.ts` · `admin.sample.ts`, `proxy.ts` (신규) | 관리자 화면(실행 로그), `/admin` 비밀번호 | 리더 |

## 3. 계약: 리포트 생성

### 3.1 요청 · 응답

| 항목 | 내용 |
| --- | --- |
| 경로 | `POST /api/report/stream` (진행 화면용 NDJSON). `POST /api/report` (JSON 한 번에. 스트림이 안 될 때 대체 · curl 확인용) |
| 요청 바디 | `{ question: string, depth?: "easy" \| "standard" \| "deep", area?: "fx" \| "etf" \| "news" \| "rate" \| "macro" }`. question 은 trim 후 1~500자, depth 기본 standard |
| 요청 헤더 ✚ | `X-Muffin-Client: <uuid v4>` 브라우저 익명 id. `api.ts` 가 자동으로 붙임. 서버는 `readClientId(req.headers)`(`src/lib/client.ts`)로 읽고, 없거나 uuid v4 가 아니면 undefined → IP 로 처리 |
| 요청 id | `newRunId()`. 응답의 `id`, 스트림 헤더 `X-Request-Id`, 로그, 저장 기록 id 가 모두 같은 값 |
| 200 (JSON) | `{ report: Report, steps: ToolStep[], rewrites: number, id: string }` |
| 400 | `{ error: "question(필수), depth, area 를 확인하세요.", id }` |
| 403 ✚ | `{ error: "허용되지 않은 출처입니다.", id }` 출처 검사 실패 (은경) |
| 413 ✚ | `{ error: "요청이 너무 큽니다.", id }` 바디 크기 초과 (은경) |
| 429 ✚ | `{ error: "요청이 많아요. N분 뒤 다시 시도해 주세요.", id, retryAfterSec }` + 헤더 `Retry-After: <초>` (서영) |
| 503 | `{ error: "리포트 서비스 설정을 확인해 주세요.", id }` 키 없음. JSON 라우트는 지금 500 이라 503 으로 통일 ✚ (서영) |
| 500 | `{ error: "조사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", id }` 실행 중 실패 |

- 라우트 처리 순서: 출처 검사(403) → 호출 제한(429, 헤더만 봄) → 바디 크기(413) · 형식(400) → 키 확인(503) → `research()`.
- 스트림 라우트도 400 · 403 · 413 · 429 · 503 은 스트림을 열기 전에 JSON 으로 돌려줍니다. `streamReport` 가 `!res.ok` 로 잡아 `ApiError`(`status` · `id` · `retryAfterSec`, message 는 `"<error> (요청 id: <id>)"`)를 throw 합니다.
- 55초 제한(`STREAM_TIMEOUT_MS`): 넘으면 `error` 이벤트 "조사 시간이 초과되었습니다…" 를 보내고 닫습니다. 실제 소요는 30~60초입니다.
- 에러 · 이벤트 · 로그는 `redactSecrets` 를 거칩니다 (이미 있음).
- `MUFFIN_MOCK=1` 이면 같은 라우트가 키 없이 샘플 리포트와 다섯 단계 이벤트를 지연을 두고 보냅니다. 질문에 "사도 돼" 가 있으면 판단 요청 샘플입니다.
- 리플레이(11/5, 리더): 바디가 `{ replay: "<녹화 id>", speed?: 0.25~10 }` 이면 녹화된 실제 실행(`src/replays/<id>.json`, `src/lib/replay.ts`)의 stage · plan · step · verify 이벤트를 원래 간격(÷speed, 간격 상한 15초)으로 보내고 `report` 로 끝냅니다. OpenAI · tool 을 부르지 않고 키도 필요 없습니다. 없는 id 는 404 `{ error: "저장된 실행을 찾을 수 없습니다.", id }`, 속도 범위 밖은 400. 요청한 속도로 55초 안에 못 끝나면 끝날 만큼 속도를 올립니다 (`fitSpeed`). 리포트 `notice` 앞에 "🎞️ 저장된 실행 다시 보기 · M/D HH:MM 에 실제로 만든 리포트입니다. 지금 데이터가 아닙니다." 가 붙고, 로그는 `mock: true` · `model: "replay:<id>"` 로 남아 운영 통계에서 빠집니다. 화면은 `/replay`(목록 · 재생, `?id=&speed=` 로 바로 재생)이고, 홈의 진행 화면도 같은 이벤트라 `streamReport({ replay, speed })` 로 붙일 수 있습니다. 녹화는 `pnpm replay:record --question … --area … --id …`, 형식 검사는 `pnpm test`.

### 3.2 스트림 이벤트 (`src/agent/events.ts`, 한 줄에 JSON 하나)

| type | 필드 | 언제 | 화면 |
| --- | --- | --- | --- |
| `stage` | `stage: "plan" \| "research" \| "edit" \| "write" \| "verify"`, `status: "start" \| "done"` | 단계 시작 · 끝 | 단계 표시. 라벨은 `stageLabels` (질문 살펴보기 · 자료 찾기 · 핵심 추리기 · 답변 쓰기 · 근거 확인하기) |
| `plan` | `intent`, `mode`, `tools: string[]` | 분류 끝 | "이렇게 조사할게요" 한 줄. tool 이름은 `labelFor(name)` |
| `step` | `step: { tool, status: "ok" \| "error", ms, error?, fallbackAgeMs?, breaker? }` | tool 하나 끝날 때마다 | tool 한 줄. 계산(`calc_metrics`) · 움직임 비교(`calc_movement`, 원인 질문만) step 은 edit 단계 안에서 옴. `fallbackAgeMs` 가 있으면 조회는 실패했고 그만큼 전에 받은 저장 응답을 쓴 것 — `ReportView` 가 🟡 "저장된 응답(N시간 전)" 으로 표시 (`formatAge`, `src/lib/age.ts`). 리포트 `dataGaps` 에도 같은 내용이 한 줄 들어감. `breaker` 가 `open` 이면 연속 실패로 외부 호출을 건너뛴 것, `half_open` 이면 짧게 한 번 찔러 본 것 |
| `verify` | `verification` | 검증 끝 | 검증 한 줄 |
| `report` | `report`, `steps`, `rewrites`, `id` | 마지막 줄 | 저장 후 상세로 이동 |
| `error` | `message`, `id?` | 실패 · 시간 초과 (마지막 줄) | 메시지 + 요청 id + 다시 시도 |

- 단계 이벤트는 단계마다 한 번만 옵니다. 검증 실패로 작성을 1회 다시 돌리면 verify 단계 안에서 처리하고 write 이벤트를 다시 보내지 않습니다. 그래서 verify 가 10~15초 길어질 수 있습니다. 남은 시간이 15초보다 적으면 다시 쓰지 않고 검증에 걸린 부분만 뺍니다(`REVISION_RESERVE_MS`).
- 범위 밖 질문은 plan 뒤에 research · edit · write 없이 verify → report 로 끝납니다. 건너뛴 단계를 표시해야 합니다.

### 3.3 리포트 필드 → 화면 (`src/agent/schema.ts` 의 `reportSchema`)

| 필드 | 화면 | 담당 |
| --- | --- | --- |
| `mode` (research · decision_facts · out_of_scope), `notice`, `movement` | 상단 배너. 문구는 서버가 준 것을 그대로. `notice` 는 판단 요청 · 범위 밖, 그리고 원인 질문(research 모드)의 움직임 크기에서 옵니다 (예: "USD/KRW 30일 변화(-1.06%)는 직전 90일 기준 평소 폭(±1.69%)의 0.63배로, 평소 범위 안의 움직임입니다."). `movement`(`level`: normal · notable · extreme)는 같은 내용의 값이라 배지 색 등에 쓸 수 있음 | 하니 |
| `disclosure` | AI 생성 고지, 리포트 하단 고정 | 하니 |
| `summary`, `impact[]`, `caveats[]`, `dataGaps[]`, `nextTopics[]` | 각 칸 | 은선 |
| `numbers[]` (`check`: verified 값 대조 · derived 계산값 · reported 기사 보도 · unverified 미검증, `ref`) | 숫자 카드, 배지, 원본 보기. reported 는 뉴스 제목에 나온 숫자라 공식 데이터로 확인한 것이 아님을 배지로 알림. unverified 는 예전(v1) 기록에서만 나옴 | 소희 |
| `why[]` (`basis`: data 📊 · news 📰 · none ❔, `refs`) | 원인, 아이콘, 원본 보기 | 소희 |
| `evidence[]` (E1 · E3-1 · C1, `lineage`), `sources[]` | 원본 보기, 계산 계보, 출처 목록 | 소희 |
| `verification` | 검증 한 줄, 검사 후 제외한 항목. `revisionSkipped` 면 "시간이 부족해 한 번 더 검토하지 못했어요" 를 보여 줄 수 있음 | 소희(내용) · 은선(위치) |

정제 단계의 사실 목록(facts)은 리포트에 들어 있지 않습니다.

## 4. 계약: 저장 · 로그 · 보호

### 4.1 `src/lib/history.ts` (프론트는 이것만 씁니다. 함수는 비동기)

```ts
type ReportRecord = {
  id: string;        // 리포트 생성 응답의 요청 id 를 그대로
  createdAt: string; // ISO
  input: { question: string; depth: Depth; area?: Area };
  report: Report;
  steps: ToolStep[];
};

saveReport(input, report, steps, id?: string): Promise<ReportRecord> // id 없으면 새로 만듦
listReports(): Promise<ReportRecord[]>                                // 최신순, 최대 100
getReport(id: string): Promise<ReportRecord | null>                   // 없으면 null
deleteReport(id: string): Promise<void>
```

- 지금은 동기 함수이고 화면 세 곳이 부릅니다: `app/page.tsx` 의 `saveReport`, `app/history/page.tsx` 와 `app/report/[id]/page.tsx` 의 `useSyncExternalStore`. 전환 PR(은경)이 이 세 곳을 `await saveReport(...)` 와 `useEffect` + 상태(불러오는 중 · 없음 · 있음)로 같이 고칩니다. 하니는 이 PR 이 머지될 때까지 두 페이지를 고치지 않습니다.
- `subscribeHistory` 는 뺍니다. 서버 저장에서는 다른 탭의 변경을 알 수 없어서, 저장함 · 상세는 열 때와 지운 뒤에 다시 불러옵니다 (다른 탭에서 바꾼 기록은 새로고침하면 보입니다).
- 1차: 구현은 localStorage(`muffin.history.v1`) 그대로 두고 함수만 Promise 를 돌려줍니다.
- 2차: History API 호출로 바꾸고 `X-Muffin-Client` 는 `getClientId()` 로 붙입니다. 1차 브라우저 기록은 서버로 옮기지 않습니다.
- 읽을 때 `normalizeReport` 로 v1 기록을 v2 모양으로 맞추는 것은 유지합니다.

### 4.2 History API (2차, 은경)

| 요청 | 응답 |
| --- | --- |
| `GET /api/history?limit=20&before=<ISO>` | 200 `{ records: ReportRecord[] }` 최신순 |
| `GET /api/history/:id` | 200 `{ record }` · 404 `{ error, id }` (다른 브라우저의 기록도 404) |
| `POST /api/history`, 바디 `{ id?, input, report, steps }` | 201 `{ record }`. report 는 `reportSchema.parse`, steps 100개 이하, 바디 512KB 이하. 같은 브라우저가 같은 id 를 다시 보내면 200 으로 기존 것, 다른 브라우저의 id 면 409 |
| `DELETE /api/history/:id` | 204 · 404 |
| 공통 | 헤더 `X-Muffin-Client` 가 없거나 uuid 가 아니면 400 (`readClientId` 가 undefined). 출처 검사(4.6) 적용. 브라우저당 100개를 넘으면 오래된 것부터 삭제. 호출 제한은 없음 |

로그인은 넣지 않습니다(맨 뒤 순위). 나중에 붙여도 표에 `user_id` 열만 더하면 되게 둡니다. 한계: 브라우저 id 를 아는 사람은 그 브라우저의 기록을 볼 수 있습니다.

### 4.3 DB: Supabase Postgres (리더 소유 조직, 무료 플랜, 리전 도쿄 `ap-northeast-1`, 프로젝트 `muffin`)

- 서버 전용 환경 변수: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`(`sb_secret_` 로 시작). `NEXT_PUBLIC_` 를 붙이지 않고, 브라우저용 publishable 키는 쓰지 않습니다.
- 라이브러리는 `@supabase/supabase-js` 하나입니다. 클라이언트는 `src/lib/db.ts` 의 `getDb()` 를 같이 쓰고, 표 한 줄의 타입도 여기 있습니다(`Tables<"runs">` · `TablesInsert<"reports">`).
- RLS 는 켜고 정책은 만들지 않으며, 표 권한은 secret 키(service_role)에만 줍니다. Supabase 가 새 표에 권한을 자동으로 주지 않는 쪽으로 바뀌는 중이라 권한을 마이그레이션에 직접 적습니다.
- 마이그레이션은 `supabase/migrations/<타임스탬프>_init.sql` 로 커밋하고, 적용은 리더가 SQL Editor 에서 합니다.
- 무료 플랜은 7일 동안 요청이 적으면 일시 정지됩니다. 다시 켜면 데이터는 그대로입니다.

```sql
create table public.reports (
  id text primary key,                 -- 요청 id
  client_id uuid not null,
  created_at timestamptz not null default now(),
  input jsonb not null,                -- { question, depth, area }
  report jsonb not null,               -- Report v2
  steps jsonb not null default '[]'
);
create index reports_client_created on public.reports (client_id, created_at desc);

create table public.runs (             -- src/lib/log.ts 의 RunLog 와 같은 필드
  id text primary key,
  at timestamptz not null,
  ok boolean not null,
  stage text not null,                 -- started | input | config | limited | agent | ok
  mock boolean not null default false,
  client_id uuid,
  ip_hash text,                        -- sha256(ip + RATE_LIMIT_SALT) 앞 16자. 원문 IP 는 저장하지 않음
  input jsonb,                         -- { question, depth, area }
  ms integer not null,
  model text,
  usage jsonb,                         -- { requests, inputTokens, outputTokens }
  steps jsonb,
  rewrites integer,
  quality jsonb,
  verification jsonb,                  -- { status, numbers, why, advice, revisions }
  intent text,
  error text
);
create index runs_at on public.runs (at desc);
create index runs_client_at on public.runs (client_id, at desc);
create index runs_ip_at on public.runs (ip_hash, at desc);

create table public.evals (            -- 평가(scripts/promptfoo/run.ts) 한 번의 요약. 주간 Action 과 로컬 실행이 넣고 /admin 이 읽음 (11/4, 별도 마이그레이션)
  id text primary key,                 -- Action 은 GitHub run id, 로컬은 날짜-시각(-tag)
  at timestamptz not null,
  source text not null,                -- ci | local
  tag text,                            -- 모델 비교 같은 실험 이름. 주간 평가는 null
  set_name text,                       -- 돌린 세트. null 이면 전부
  questions integer not null,
  errors integer not null,
  avg_ms integer,
  models jsonb,                        -- 작성 단계에 쓴 모델들
  tokens jsonb,                        -- { prompt, completion }
  rates jsonb not null,                -- { intent: { pass, total, rate }, ... }
  thresholds jsonb not null,
  failed jsonb not null,               -- [{ metric, rate, threshold }]
  run_url text,
  summary text                         -- 요약 markdown
);
create index evals_at on public.evals (at desc);

create table public.tool_cache (       -- tool 응답 캐시 (src/tools/cache.ts). 같은 호출(tool + 입력)의 마지막 성공 응답. 조회가 실패하면 24시간 안의 것을 폴백으로 (11/4, 별도 마이그레이션)
  key text primary key,                -- tool 이름 + 입력 (키 정렬한 JSON)
  tool text not null,
  at timestamptz not null,             -- 이 응답을 받은 시각
  result jsonb not null                -- ToolResult (data · source · note)
);
create index tool_cache_at on public.tool_cache (at desc);

-- 줄 접근: RLS 를 켜고 정책은 만들지 않습니다. secret 키(service_role)는 RLS 를 거치지 않습니다.
alter table public.reports enable row level security;
alter table public.runs enable row level security;
alter table public.evals enable row level security;
alter table public.tool_cache enable row level security;

-- 표 접근: 브라우저용 역할(anon · authenticated)에는 주지 않고 secret 키(service_role)에만 줍니다.
revoke all on table public.reports, public.runs, public.evals, public.tool_cache from anon, authenticated;
grant select, insert, update, delete on table public.reports, public.runs, public.evals, public.tool_cache to service_role;
```

### 4.4 실행 로그 (서영)

`logRun` 은 지금처럼 콘솔(Vercel Logs, `muffin.run`)에 남기고, 2차부터 `runs` 에도 남깁니다. 요청의 줄은 호출 제한 v2 가 시작할 때 먼저 넣고(4.5), 끝나면 `logRun` 이 같은 id 의 줄을 갱신합니다. 갱신은 응답을 늦추지 않게 `next/server` 의 `after()` 로 하고, 실패해도 응답은 그대로 나가게 try/catch 후 콘솔에만 남깁니다. DB 는 `db.ts` 의 `getDb()` 를 씁니다.

`RunLog` 에 `verification`(리포트 `verification` 의 status · numbers · why · advice · revisions)과 `intent`(`research()` 결과의 `plan.intent`)를 더해 `runs` 의 같은 칸에 넣습니다. 관리자 화면(4.7)의 검증 통과율 · 다시 쓰기 비율 · 의도별 요청 수가 이 두 칸을 씁니다.

### 4.5 호출 제한 (서영)

- 키 두 개를 함께 셉니다. 브라우저 키는 `readClientId(req.headers)` 값(없으면 IP 키만), IP 키는 `x-forwarded-for` 의 첫 IP 를 `RATE_LIMIT_SALT` 와 함께 sha256 한 값입니다. 원문 IP 는 저장 · 로그하지 않습니다.
- 한도는 환경 변수에서만 읽습니다(비우면 기본값): 브라우저 키 `RATE_LIMIT_10M=10`(10분 10회) · `RATE_LIMIT_DAY=60`(하루 60회), IP 키 `RATE_LIMIT_IP_10M=30`(10분 30회). 숫자를 코드 곳곳에 쓰지 않고 기본값은 `ratelimit.ts` 한 곳에 둡니다. 상한은 Vercel 환경 변수만 바꿔 올립니다.
- 리포트 생성 두 라우트에만, 바디를 읽기 전에 적용합니다(출처 검사 바로 뒤). 넘으면 429 와 `Retry-After`, 로그는 `stage: "limited"` 입니다.
- v1 은 메모리 `Map` 입니다. 인스턴스마다 따로 세는 한계를 파일 머리에 적습니다.
- v2(2차)는 요청을 받자마자 `runs` 에 그 요청의 줄을 먼저 넣고(`stage: "started"`), 그 줄까지 포함해 셉니다. 한도를 넘으면 그 줄을 `limited` 로 바꾸고 429 를 돌려줍니다. 끝난 요청만 세면 동시에 들어온 요청이 모두 통과하기 때문입니다.

```ts
// src/lib/ratelimit.ts (모양 고정. 구현을 바꿔도 라우트는 그대로)
export async function checkLimit(keys: { clientId?: string; ipHash: string }): Promise<{ ok: true } | { ok: false; retryAfterSec: number }>;
```

### 4.6 출처 검사 · 바디 크기 (은경)

- POST · DELETE 라우트 전부에서 Origin(없으면 Referer)이 `ALLOWED_ORIGINS`(쉼표 구분)에 없으면 403 입니다. 기본값은 `https://muffin-kappa.vercel.app`, `https://*-thdude37-2971s-projects.vercel.app`, `http://localhost:3000` 입니다. 둘 다 없는 요청(curl 등)은 개발 환경에서만 통과합니다.
- 출처 검사는 라우트 맨 앞(호출 제한보다 앞)에 둡니다. 바디는 지금의 `req.json()` 대신 `readJsonLimited` 로 읽습니다. 한도는 리포트 생성 16KB, History POST 512KB 이고, 넘으면 413 입니다.
- `pnpm eval` 은 라우트를 거치지 않으므로 영향이 없습니다.

```ts
// src/lib/guard.ts
export function checkOrigin(req: Request): { ok: true } | { ok: false; status: 403 };
export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown>; // 넘으면 throw → 413
```

### 4.7 관리자 화면 `/admin` (리더)

- 실행 모니터링 화면입니다. 기간은 최근 24시간(1시간 칸) · 7일(6시간 칸, 기본)이고, 화면이 보이는 동안 60초마다 다시 그립니다. 칸 경계는 한국 시간 정각입니다.
- 보여 주는 것: 전체 상태(정상 · 주의 · 장애) · 핵심 지표 6개(요청 · 성공률 · 응답 시간 p90 · 평균 응답 · 검증 통과 · 남은 권유 표현) · 요청 추이(성공 · 실패 · 호출 제한) · 리포트별 응답 시간(예산 55초 · p90 선) · tool 상태등 · 이벤트(실패 · 멈춤 · 호출 제한 · tool 실패, 최근 12건) · 검증 · 깊이별 응답 시간 · 질문 의도 · 토큰.
- 상태 기준(`src/lib/admin.ts` 의 `THRESHOLDS`): 성공률 95% 이상 정상 · 85% 이상 주의, 응답 시간 p90 45초 안 정상 · 예산 55초 안 주의, 검증 통과 90% · 75%, tool 성공률 95% · 85%, 남은 권유 표현은 1건이라도 장애. 전체 상태는 성공률 · 응답 시간 · 권유 표현 중 가장 나쁜 것이고, 검증은 전체를 주의까지만 올립니다. tool 실패는 리포트가 나가므로 tool 상태등과 이벤트에만 표시합니다.
- 응답 시간 · 토큰 · 검증은 리포트를 만든 요청만 셉니다 (범위 밖 질문은 분류만 하고 끝나서 뺍니다). Mock 요청은 모든 숫자에서 빼고, 호출 제한(`limited`)은 성공률에서 따로 셉니다. 2분 넘게 `started` 로 남은 줄은 중간에 멈춘 실패로 셉니다.
- 보호는 브라우저 기본 로그인 창(HTTP Basic)입니다. 비밀번호는 서버 전용 환경 변수 `ADMIN_PASSWORD` 하나이고 아이디는 보지 않습니다. 비어 있으면 `/admin` 은 404 입니다. `proxy.ts`(Next.js 16 의 proxy, 예전 middleware)가 `/admin` 앞에서 막고 페이지도 한 번 더 확인합니다. 검색 노출은 막습니다(noindex).
- 데이터는 `src/lib/admin.ts` 의 `loadRuns` 하나로 읽습니다. `runs` 표의 최근 7일(가장 긴 기간, 끝은 화면을 그리는 시각으로 고정)을 시각 · id 순으로 1000줄씩 읽습니다. 다음 쪽은 줄 번호가 아니라 마지막 줄의 (시각, id) 뒤부터 이어 읽어, 읽는 중에 새 요청이 들어와도 같은 줄을 두 번 세거나 건너뛰지 않습니다(최대 10쪽, 그 뒤에 줄이 더 있는 것을 확인했을 때만 최신 것만 집계했다고 표시). `client_id` · `ip_hash` 는 읽지 않습니다. Supabase 환경 변수가 없으면 예시 데이터를 보여 주고 화면 맨 위에 "예시 데이터"라고 표시합니다. `/admin?source=sample` 로 예시 화면을 볼 수 있고 기간을 바꿔도 유지됩니다(스크린샷 · 시연 연습). 센 요청이 없으면 "아직 기록이 없습니다"에 표가 빈 것인지(7일 동안 0줄) 세지 않는 줄(Mock · 2분 안의 진행 중)뿐인지를 적고 예시 화면 링크를 보여 줍니다. 기록은 실행 로그 저장(4.4, 서영)이 들어온 뒤부터 쌓입니다. 조회가 실패하면(프로젝트 일시 정지 등) 안내문만 보여 줍니다.
- 가드레일 작동 횟수는 아직 로그 칸이 없어 "남은 권유 표현"(`verification.advice`)으로 대신합니다.
- tool 상태(11/4, PR #65 뒤): 성공률은 외부 API 가 실제로 답한 비율(`live / calls`)이고, 조회가 실패해 저장 응답(`tool_cache`)으로 나간 호출 · 회로 차단기가 열려 건너뛴 호출 · 마지막 실패 시각을 같이 보여 줍니다 (`ToolStat` 의 `live` · `fallbacks` · `skipped` · `lastFailAt`). 저장 응답으로 리포트가 나갔어도 API 쪽은 실패로 셉니다.
- 상용 AI 상태 패널(11/4): `src/lib/admin-status.ts` 의 `loadVendorStatus` 가 OpenAI 상태 페이지의 Statuspage 호환 JSON(`status.openai.com/api/v2/summary.json`, 키 없음, 4초 제한)을 읽어 전체 상태 · 우리가 쓰는 구성 요소(Responses · Agents · Chat Completions · Codex) · 진행 중 장애를 보여 주고, 오른쪽에 `windowStats` 의 최근 1시간 실측(요청 · 성공률 · 리포트 평균 응답)을 나란히 둡니다. `vendorVerdict` 가 둘을 합쳐 한 줄로 판단합니다 (벤더 장애 → 장애, 벤더 정상인데 우리 실패 85% 미만 → 우리 쪽 확인, 요청 3건 미만이면 보류). 상태 페이지를 못 읽어도 실측은 그대로 그립니다.
- 캐시 예열(11/4): `scripts/warm/run.ts`(`pnpm warm`)가 `tool_cache` 표의 호출을 같은 입력으로 다시 불러 저장 응답을 갱신합니다. `.github/workflows/warm.yml` 이 매시 7분에 돌리고 결과 요약을 실행 페이지에 남깁니다. 모델은 부르지 않습니다.
- 품질 평가 패널(11/4): `evals` 표(4.3)의 최신 12줄을 `src/lib/admin-evals.ts` 의 `loadEvals` 로 읽습니다. 주간 평가(Action 에서 전체 세트를 돌린 것, tag · set_name 없음)의 최신 결과를 지표별 통과율 · 기준 · 상태 표로 보여 주고, 주간 평가끼리 "기준 안 지표 비율" 추이를 그리며, 세트 일부만 고른 수동 실행 · 로컬 · 실험(tag) 실행은 전체 세트와 비교할 수 없어 기록 목록에만 둡니다. 주간 평가는 최근 기록과 따로 읽어, 실험 실행이 많아도 밀려 사라지지 않습니다. 깊이 · 모델을 바꾼 실행은 `run.ts` 가 실험 이름(tag)을 자동으로 붙여 주간 줄에서 빠집니다. 주간 평가가 아직 없으면 그렇게 적고 기록만 보여 줍니다. 로컬 실행의 id 는 promptfoo 의 evalId 라 같은 분에 두 번 돌려도 겹치지 않습니다. 표가 없거나 조회가 실패하면 패널 안에 안내문만 보이고 나머지 화면은 그대로입니다. 줄은 `scripts/promptfoo/run.ts` 가 Supabase 환경 변수가 있을 때 넣습니다 (Action 에는 Secrets `SUPABASE_URL` · `SUPABASE_SECRET_KEY` 필요).

## 5. 할 일과 완료 조건

### 백엔드

| 누구 | 할 일 | 완료 조건 |
| --- | --- | --- |
| 은경 | history 비동기 전환: `history.ts` 함수 4개를 Promise 로(`saveReport` 에 `id?` 추가, `subscribeHistory` 는 뺌), 화면 세 곳 호출부까지. 구현은 localStorage 그대로 | 세 화면이 전과 같이 동작, `pnpm test` 통과, 하니에게 미리 알림 |
| 서영 | 호출 제한 v1: `ratelimit.ts` + 테스트, 두 라우트에서 바디를 읽기 전에 호출, 429, `RunStage` 에 `limited`, JSON 라우트 키 없음 500 → 503 | 11번째 요청 429 + `Retry-After`, 브라우저 id 를 바꿔도 IP 상한에서 429, 가짜 시계로 10분 뒤 풀림, 환경 변수로 한도가 바뀜, 라우트 테스트에 429 응답 1건 |
| 은경 | 출처 검사 · 바디 크기: `src/lib/guard.ts` + 테스트, 두 라우트에 적용 | 허용 Origin 통과, 다른 Origin 403, 큰 바디 413 |
| 은경 | History API: 엔드포인트 4개 + 테스트(`db.ts` 의 `getDb` 는 모킹), `history.ts` 2차 구현 | 같은 브라우저에서만 보이고 다른 브라우저에서는 안 보임, 삭제 동작 |
| 서영 | 실행 로그 DB: `logRun` 이 `runs` 에도 insert (`verification` · `intent` 포함, 4.4) | Supabase 표에 한 줄, 쓰기가 실패해도 응답은 그대로 |
| 서영 | 호출 제한 v2: 요청 시작 때 `runs` 에 먼저 넣고 세기 | 인스턴스가 달라도 같은 수로 셈, 같은 브라우저에서 동시에 11건이 와도 10건만 통과 |

### 프론트

| 누구 | 할 일 | 쓰는 계약 | 완료 조건 |
| --- | --- | --- | --- |
| 은선 | 진행 화면 `Progress.tsx`: 다섯 단계(대기 · 진행 · 완료 · 건너뜀), plan 한 줄, step 목록(라벨 · 성공/실패 · 시간), verify 한 줄, error(메시지 · 요청 id · 다시 시도) | 3.2 | Mock 으로 다섯 단계가 순서대로 보임, 범위 밖("비트코인 지금 얼마야?")에서 건너뛴 단계 표시, 55초 초과 메시지 표시 |
| 은선 | 홈 스트림 연결: `createReport` → `streamReport`, 끝나면 `await saveReport(input, report, steps, result.id)` 후 `/report/<id>` 로 이동 | 3.1, 4.1 | 실제 키로 질문 → 진행 → 상세까지 한 번에 |
| 은선 | 리포트 칸 배치: `ReportView.tsx` 의 칸 순서 · 묶음, 소희 · 하니 부품 배치 | 3.3 | 모임에서 화면 제안 |
| 하니 | 배너 · AI 고지 `ReportNotice.tsx`: mode 별 배너, disclosure 하단 고정. `ReportEvidence.tsx` 의 `ReportVerification` 안에 있는 고지 글자를 이리로 옮김(소희와 순서 조율) | `mode` `notice` `disclosure` | "KODEX 200 지금 사도 돼?" 에서 배너, 모든 리포트에 고지 |
| 하니 | 홈 폼: 영역 · 깊이 · 질문, 키보드 조작, 오류 표시(429 메시지 포함) | 3.1 | 키보드만으로 제출 가능 |
| 하니 | 저장함 · 상세 화면: 목록 · 삭제 · 빈 상태 · 불러오는 중, 상세의 없음 처리 | 4.1 | 세 상태가 보임 |
| 소희 | 숫자 배지 · 원인 아이콘: `check` 4종(기사 보도 포함), `basis` 3종 디자인 | 3.3 | Mock 샘플에서 값 대조 · 계산값 · 기사 보도("외국인 주식 순매도 (보도)") 확인, 미검증은 v1 기록으로 확인 |
| 소희 | 원본 보기 · 계산 계보: ref → evidence 항목(라벨 · 값 · 출처 · 기준일 · note), lineage 면 입력 E 번호로 이동, 뉴스 기사별 항목, 출처 목록 | 3.3 | C1 을 누르면 계산식과 E1 · E2 로 이동 |
| 소희 | 검증 한 줄 내용 | `verification` | "숫자 4개 중 2개 값 대조 · 1개 계산값 · 1개 기사 보도 · 권유 0" 형태 (`numbers.reported` 는 예전 기록에 없으면 0) |

프론트 공통: fetch 는 `src/lib/api.ts` 만, 저장은 `src/lib/history.ts` 만 씁니다. 화면 테스트는 `app/components/ReportView.test.tsx` 와 같은 방식(vitest)입니다.

### 리더

- `src/lib/client.ts` 의 `getClientId()`: `crypto.randomUUID()` 를 localStorage `muffin.client` 에 저장하고, 서버 렌더링에서는 빈 문자열을 돌려줍니다. `api.ts` 가 `X-Muffin-Client` 를 자동으로 붙이고, 429 의 `retryAfterSec` 를 에러 메시지에 반영합니다.
- Supabase 새 조직 · 프로젝트 · 키를 만들고, `.env.local` 과 Vercel 환경 변수(`SUPABASE_URL` · `SUPABASE_SECRET_KEY` · `ALLOWED_ORIGINS` · `RATE_LIMIT_*` · `RATE_LIMIT_SALT`)에 넣습니다. `db.ts`(클라이언트 · 표 타입)와 마이그레이션 SQL 을 만들고 적용합니다.
- `events.ts` · `schema.ts` 변경 창구와 AGENTS.md 관리, 응답 시간(55초) 줄이기를 맡습니다.
- 관리자 화면 `/admin`(4.7)을 만들고 Vercel 환경 변수 `ADMIN_PASSWORD` 를 넣습니다. `loadRuns` 는 `runs` 표를 읽습니다(11/4). 기록은 서영의 실행 로그 저장(4.4) 뒤부터 쌓입니다.

## 6. 순서

| 단계 | 누구 | 할 일 | 먼저 끝나야 하는 것 |
| --- | --- | --- | --- |
| 1. Mock 시연 | 은경 | history 비동기 전환 PR (화면 세 곳 호출부 포함) | 없음 |
| 1. Mock 시연 | 리더 | `client.ts` + `api.ts` 식별 헤더 | 없음 |
| 1. Mock 시연 | 은선 · 하니 · 소희 | `Progress.tsx` · `ReportNotice.tsx` · `ReportEvidence.tsx` (새 파일이거나 각자 파일이라 바로 시작) | 없음 |
| 1. Mock 시연 | 서영 | `ratelimit.ts` + 테스트 | 없음 |
| 1. Mock 시연 | 은선 | `page.tsx` 스트림 연결 | 은경 전환 PR 머지 |
| 1. Mock 시연 | 하니 | `page.tsx` 폼 · 오류, 저장함 · 상세 화면 | 은선 `page.tsx` PR 머지 (같은 파일) |
| 1. Mock 시연 | 서영 | 라우트에 호출 제한 연결, 429, 503 통일 | 없음 |
| 1. Mock 시연 | 은경 | `guard.ts` + 라우트 적용 | 서영 라우트 PR 머지 (같은 파일) |
| 1. Mock 시연 | 전원 | Mock 으로 홈 → 진행 → 상세 → 저장함 시연 | 위 화면 PR |
| 2. Supabase | 리더 | 조직 · 프로젝트 · 키 · Vercel 환경 변수, `db.ts` · 마이그레이션 SQL · 적용 | 없음 |
| 2. Supabase | 은경 | History API · `history.ts` 2차 | 리더 `db.ts` · 마이그레이션 머지 |
| 2. Supabase | 서영 | `runs` 로그 저장 → 호출 제한 v2 | 리더 `db.ts` · 마이그레이션 머지 |
| 2. Supabase | 하니 | 저장함 서버 전환 확인 | 은경 History API 머지 |
| 3. 시연 | 전원 | 실제 키로 홈 → 진행 → 상세 → 저장함 | 2단계 |

같은 파일을 여러 사람이 고치는 곳은 넷입니다: `app/page.tsx`(은경 → 은선 → 하니), 저장함 · 상세 페이지(은경 → 하니), 두 라우트(서영 → 은경), `ReportEvidence.tsx`(소희 → 하니, 고지 글자 옮기기). 뒤 사람은 앞 사람 PR 이 머지된 뒤 `git pull` 하고 시작합니다. 순서 조율은 Discord 의 별도 채널에서 하고, 바뀐 순서는 이 표에 적습니다.

## 7. 자주 나올 질문

- **키 없이 화면을 만들 수 있나?** `MUFFIN_MOCK=1` 로 모든 이벤트와 리포트 상태를 볼 수 있습니다. 마무리 확인은 실제 키로 합니다.
- **History 가 비동기가 되면 지금 화면이 깨지나?** 은경의 전환 PR 이 세 화면의 호출부를 같이 고치므로 머지 직후에도 동작합니다.
- **429 가 오면 화면은?** `streamReport` · `createReport` 가 `ApiError` 를 throw 합니다. 홈은 `message`("요청이 많아요… (요청 id: …)")를 그대로 보여 주고, `retryAfterSec` 동안 다시 시도 버튼을 막을 수 있습니다.
- **리포트에 필드를 더하고 싶다.** 코드에서 바꾸지 말고 Discord 에 "어느 화면에 어떤 필드" 로 적습니다. 리더가 `schema.ts` 와 이 문서를 고칩니다.
- **테스트는 어디까지?** 백엔드는 라우트 · 헬퍼 단위 테스트(외부는 모킹), 프론트는 컴포넌트 테스트입니다. 실제 키로 확인한 것은 PR 본문 "테스트 방법" 에 적습니다.
