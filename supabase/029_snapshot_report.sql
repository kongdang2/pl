-- 029 (11/25, hong 「웹 자료목록에서 현재 보고를 위한 최신본을 강조표시」 → 1안 + 「보고본이 항상 젤 위로 고정」):
-- 보고본 = 탭(손익추정·사업계획)마다 하나. 관리자만 지정·해제. 지정하면 같은 탭의 다른 보고본은 풀린다. 자료 내용·저장 시각(updated_at)은 그대로.
alter table public.sk_snapshots add column if not exists report_at timestamptz;
create or replace function public.sk_set_report(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.sk_snapshots;
begin
  if coalesce(public.sk_my_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.sk_snapshots where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.sk_snapshots set report_at = null where report_at is not null and coalesce(mode, 'sonik') = coalesce(r.mode, 'sonik');
  if p_on then update public.sk_snapshots set report_at = now() where id = p_id; end if;
end $$;
revoke all on function public.sk_set_report(uuid, boolean) from public, anon;
grant execute on function public.sk_set_report(uuid, boolean) to authenticated;
