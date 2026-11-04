-- 평가 결과(evals) 표. docs/web-spec.md 4.3 과 같은 모양입니다. scripts/promptfoo/run.ts 가 한 번 돌 때마다 한 줄을 넣고(주간 Action · 로컬), /admin 이 읽습니다.
-- 적용은 리더가 Supabase SQL Editor 에 이 파일 전체를 붙여 한 번에 실행합니다. 권한은 init 과 같이 secret 키(service_role)에만 줍니다.

create table public.evals (
  id text primary key,                 -- Action 은 GitHub run id, 로컬은 날짜-시각(-tag)
  at timestamptz not null,
  source text not null,                -- ci | local
  tag text,                            -- 모델 비교 같은 실험 이름. 주간 평가는 null
  set_name text,                       -- 돌린 세트 (쉼표로 여러 개). null 이면 전부
  questions integer not null,
  errors integer not null,
  avg_ms integer,
  models jsonb,                        -- ["gpt-6-luna", ...] 작성 단계에 쓴 모델
  tokens jsonb,                        -- { prompt, completion }
  rates jsonb not null,                -- { intent: { pass, total, rate }, ... }
  thresholds jsonb not null,           -- { intent: 0.8, ... }
  failed jsonb not null,               -- [{ metric, rate, threshold }]
  run_url text,                        -- Action 실행 페이지
  summary text                         -- 요약 markdown
);
create index evals_at on public.evals (at desc);

alter table public.evals enable row level security;
revoke all on table public.evals from anon, authenticated;
grant select, insert, update, delete on table public.evals to service_role;
