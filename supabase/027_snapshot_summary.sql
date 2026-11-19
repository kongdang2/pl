-- 027 (11/20, hong 「버전 개요 정도만 대기실에서도 볼 수 있으면」 → 카드 「자료별 핵심 숫자」): 사업계획 저장 직후 사이트가 계산한
-- 핵심 숫자(재무·관리 영업이익 합 억원, 상업수율, 나프타 첫 달→끝 달, 평균 환율)를 목록에 보이도록 둔다. 계산값이라 쓰기 권한자(writer·admin) 누구나 기록.
alter table public.sk_snapshots add column if not exists summary jsonb;
create or replace function public.sk_set_snapshot_summary(p_id uuid, p_summary jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.sk_my_role(), '') not in ('admin', 'writer') then raise exception 'NO_WRITE'; end if;
  if p_summary is not null and (jsonb_typeof(p_summary) <> 'object' or length(p_summary::text) > 2000) then raise exception 'BAD_SUMMARY'; end if;
  update public.sk_snapshots set summary = p_summary where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
revoke all on function public.sk_set_snapshot_summary(uuid, jsonb) from public, anon;
grant execute on function public.sk_set_snapshot_summary(uuid, jsonb) to authenticated;
