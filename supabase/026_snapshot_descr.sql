-- 026 (11/20, hong 「대기화면 자료목록에 자료명 옆에 설명란을 추가」): 자료(추정자료·사업계획) 설명 한 줄.
-- 고칠 수 있는 사람 = 이름 바꾸기(020)와 같음: 관리자는 모든 자료, 작성자(writer)는 내가 웹에 만든 자료만. 빈 값이면 설명을 지운다.
alter table public.sk_snapshots add column if not exists descr text;
create or replace function public.sk_set_snapshot_descr(p_id uuid, p_descr text) returns text
language plpgsql security definer set search_path = public as $$
declare r public.sk_snapshots; me text := lower(coalesce(auth.jwt() ->> 'email', '')); v text := nullif(left(trim(coalesce(p_descr, '')), 300), '');
begin
  select * into r from public.sk_snapshots where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.sk_my_role() = 'admin' or (public.sk_my_role() = 'writer' and r.source = 'web' and r.author_email = me)) then raise exception 'NOT_ALLOWED'; end if;
  update public.sk_snapshots set descr = v where id = p_id;
  return coalesce(v, '');
end $$;
revoke all on function public.sk_set_snapshot_descr(uuid, text) from public, anon;
grant execute on function public.sk_set_snapshot_descr(uuid, text) to authenticated;
