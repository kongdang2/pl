-- 2026-11-07 (hong): 무료 한도 카드의 전송량을 Supabase 결제 주기에 맞춘다.
-- 조직 kongdang2's Org 의 주기는 매월 7일(UTC) 시작(Usage 화면: 07 Oct 2026 - 07 Nov 2026). 예전에는 한국 시간 매월 1일부터 셌다.
-- egress_month 이름은 화면 호환을 위해 그대로 두고, 주기 시작 시각을 cycle_start 로 함께 돌려준다.
create or replace function public.sk_usage() returns json
language plpgsql stable security definer set search_path = public, storage as $$
declare
  anchor int := 7; -- 결제 주기 시작일(UTC)
  m timestamptz := (date_trunc('month', now() at time zone 'UTC') + make_interval(days => anchor - 1)) at time zone 'UTC';
begin
  if public.sk_my_role() is null then raise exception 'NOT_MEMBER'; end if;
  if now() < m then m := ((date_trunc('month', now() at time zone 'UTC') - interval '1 month') + make_interval(days => anchor - 1)) at time zone 'UTC'; end if;
  return json_build_object(
    'db', pg_database_size(current_database()),
    'storage', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'egress_month', (select coalesce(sum(bytes), 0) from public.sk_egress where at >= m),
    'egress_today', (select coalesce(sum(bytes), 0) from public.sk_egress where at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    -- 항목별(이번 주기): 웹 조회(api N) · 중계 조회(relay api N) · 중계 파일(relay …) · 웹 파일(engine·snapshot 등)
    'egress_by', (select json_build_object(
        'web_api', coalesce(sum(bytes) filter (where what like 'api %'), 0),
        'relay_api', coalesce(sum(bytes) filter (where what like 'relay api %'), 0),
        'relay_file', coalesce(sum(bytes) filter (where what like 'relay %' and what not like 'relay api %'), 0),
        'web_file', coalesce(sum(bytes) filter (where what not like 'api %' and what not like 'relay %'), 0))
      from public.sk_egress where at >= m),
    'month_start', m, 'cycle_start', m, 'at', now());
end $$;
revoke all on function public.sk_usage() from public;
revoke execute on function public.sk_usage() from anon;
grant execute on function public.sk_usage() to authenticated;
