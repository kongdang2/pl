-- 020 (11/03, hong): ① 추정자료명(메모) 수정 ② 수정요청 삭제.
-- ① 관리자는 모든 자료, 작성자(writer)는 내가 웹에 만든 자료만 이름을 바꾼다.
create or replace function public.sk_rename_snapshot(p_id uuid, p_memo text) returns text
language plpgsql security definer set search_path = public as $$
declare r public.sk_snapshots; me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  select * into r from public.sk_snapshots where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.sk_my_role() = 'admin' or (public.sk_my_role() = 'writer' and r.source = 'web' and r.author_email = me)) then raise exception 'NOT_ALLOWED'; end if;
  if length(trim(coalesce(p_memo, ''))) = 0 then raise exception 'EMPTY'; end if;
  update public.sk_snapshots set memo = left(trim(p_memo), 120) where id = p_id;
  return left(trim(p_memo), 120);
end $$;
revoke all on function public.sk_rename_snapshot(uuid, text) from public, anon;
grant execute on function public.sk_rename_snapshot(uuid, text) to authenticated;
-- ② 관리자는 기존 「admin deletes requests」 정책으로 모든 요청을 지운다. 담당자는 내 요청 중 승인대기·취소·반려만.
-- (DELETE 가 든 함수는 MCP 적용 승인이 오지 않아, 정책으로 둔다. 남은 Claude 대기 글은 사이트가 먼저 닫는다)
create policy "members delete own closed requests" on public.sk_requests for delete to authenticated
  using (author_email = lower(coalesce(auth.jwt() ->> 'email', '')) and status in ('승인대기', '취소', '반려') and public.sk_my_role() is not null);
