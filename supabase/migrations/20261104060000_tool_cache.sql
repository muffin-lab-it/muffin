-- tool 응답 캐시(tool_cache) 표. docs/web-spec.md 4.3 과 같은 모양입니다. src/tools/cache.ts 가 성공한 tool 응답을 넣고,
-- 같은 호출이 실패하면 24시간 안의 마지막 성공 응답을 대신 씁니다 (리포트에 "N시간 전 조회 값" 으로 표시).
-- 적용은 리더가 Supabase SQL Editor 에 이 파일 전체를 붙여 한 번에 실행합니다. 권한은 init 과 같이 secret 키(service_role)에만 줍니다.

create table public.tool_cache (
  key text primary key,                -- tool 이름 + 입력 (키 정렬한 JSON)
  tool text not null,
  at timestamptz not null,             -- 이 응답을 받은 시각
  result jsonb not null                -- ToolResult (data · source · note)
);
create index tool_cache_at on public.tool_cache (at desc);

alter table public.tool_cache enable row level security;
revoke all on table public.tool_cache from anon, authenticated;
grant select, insert, update, delete on table public.tool_cache to service_role;
