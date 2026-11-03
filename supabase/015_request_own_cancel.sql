-- 수정요청(hong 11/03): 담당자는 자기 요청만 본다(관리자·중계는 전체) + 접수 취소
alter policy "members read requests" on public.sk_requests
  using (public.sk_my_role() = 'admin' or (public.sk_my_role() is not null and author_email = lower(coalesce(auth.jwt() ->> 'email',''))));
alter table public.sk_requests drop constraint sk_requests_status_check,
  add constraint sk_requests_status_check check (status in ('승인대기','접수','진행','완료','보류','반려','취소'));
-- 접수 취소: 본인(또는 관리자)이, 끝나지 않은 요청만. 아직 실행 전인 Claude 앞 대기 글은 닫는다(실행 중이면 그 실행은 끝까지 돈다)
create or replace function public.sk_cancel_request(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare r public.sk_requests; me text := lower(coalesce(auth.jwt() ->> 'email','')); adm boolean := public.sk_my_role() = 'admin';
begin
  select * into r from public.sk_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if public.sk_my_role() is null or (not adm and r.author_email <> me) then raise exception 'NOT_OWN'; end if;
  if r.status in ('완료','반려','취소') then raise exception 'CLOSED'; end if;
  update public.sk_requests set status = '취소', working = null, updated_at = now(),
    progress = progress || jsonb_build_array(jsonb_build_object('at', now(), 'stage', stage, 'text', '[' || coalesce((select name from public.sk_members where email = me), me) || '] 접수를 취소했습니다'))
  where id = p_id;
  update public.sk_channel set status = '완료', run_note = '요청 취소', updated_at = now()
  where request_id = p_id and status = '대기' and run_state is null;
  return case when exists (select 1 from public.sk_channel where request_id = p_id and run_state = '실행중') then 'running' else 'ok' end;
end $$;
revoke all on function public.sk_cancel_request(bigint) from public;
revoke execute on function public.sk_cancel_request(bigint) from anon;
grant execute on function public.sk_cancel_request(bigint) to authenticated;
