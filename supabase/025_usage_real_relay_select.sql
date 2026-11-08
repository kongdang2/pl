-- 2026-11-08: 중계가 sk_usage_real 에 덮어쓰기(upsert = INSERT … ON CONFLICT DO UPDATE)할 때 403.
-- Postgres 는 ON CONFLICT DO UPDATE 에 SELECT 정책도 요구하는데, 중계 계정은 구성원이 아니라 읽기 정책(members read)에 걸린다.
-- 중계 계정도 이 한 줄을 읽을 수 있게 한다.
create policy "relay reads real usage" on public.sk_usage_real for select to authenticated using (public.sk_channel_is_relay());
