-- 실행 로그(runs)에 리포트 본문과 정제 결과를 남깁니다 (2026-11-21).
-- 11/20 베타 테스트 때 테스터가 받은 리포트를 다시 볼 수 없어(보관함은 브라우저에만 있음) 원인을 로그의 숫자만으로 추정했습니다.
-- 적용은 리더가 Supabase SQL Editor 에 이 파일 전체를 붙여 실행합니다. 적용 전에도 서버는 동작합니다 (이 두 칸 없이 저장).
alter table public.runs add column if not exists report jsonb;  -- Report v2 (화면이 받은 그대로). 성공한 실행만
alter table public.runs add column if not exists facts jsonb;   -- 정제 결과 { facts, dropped, unverified }. 정제가 실패했으면 null
