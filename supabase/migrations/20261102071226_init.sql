-- 저장함(reports) · 실행 로그(runs) 표. docs/web-spec.md 4.3 과 같은 모양입니다.
-- 적용은 리더가 Supabase SQL Editor 에 이 파일 전체를 붙여 한 번에 실행합니다 (한 번에 실행하면 한 트랜잭션이라, 중간에 실패하면 전부 취소됩니다).
-- 표는 서버의 secret 키만 읽고 씁니다. RLS 를 켜고 정책은 만들지 않으며, 표 권한도 service_role(secret 키)에만 줍니다.
-- Supabase 는 새 표에 권한을 자동으로 주지 않는 쪽으로 바뀌는 중이라, 권한을 여기에 직접 적습니다.

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

-- 줄 접근: RLS 를 켜고 정책은 만들지 않습니다. secret 키(service_role)는 RLS 를 거치지 않습니다.
alter table public.reports enable row level security;
alter table public.runs enable row level security;

-- 표 접근: 브라우저용 역할(anon · authenticated)에는 주지 않고 secret 키(service_role)에만 줍니다.
revoke all on table public.reports, public.runs from anon, authenticated;
grant select, insert, update, delete on table public.reports, public.runs to service_role;
