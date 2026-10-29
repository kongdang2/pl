-- 2026-10-30 (hong): 수정요청을 접수하면 소통 채널에 바로 「대기」 글이 올라가 PC 중계가 Claude 에게 넘긴다.
-- 중계(에이전트 계정)는 요청을 읽고 진행 단계(stage·progress·status)를 적을 수 있다.
alter table public.sk_channel add column if not exists request_id bigint references public.sk_requests(id) on delete set null;

create or replace function public.sk_request_to_channel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sk_channel (sender, recipient, topic, status, body, author_email, request_id)
  values ('hong', 'Claude', '수정요청 #' || new.id, '대기',
    '수정요청 #' || new.id || ' 접수 (' || coalesce(nullif(new.author_name, ''), new.author_email) || ')' || chr(10)
      || '제목: ' || new.title || ' · 구분: ' || new.kind || chr(10)
      || case when new.body <> '' then '설명: ' || new.body || chr(10) else '' end
      || '담은 항목 ' || jsonb_array_length(new.items) || '개 · 스냅샷 ' || coalesce(new.base_ym, '-') || ' / 엔진 ' || coalesce(new.engine_ver, '-') || chr(10)
      || '검토부터 진행해 주세요.',
    new.author_email, new.id);
  return new;
end $$;
revoke all on function public.sk_request_to_channel() from public, anon, authenticated;
create trigger sk_requests_to_channel after insert on public.sk_requests
  for each row execute function public.sk_request_to_channel();

create policy "relay reads requests" on public.sk_requests for select to authenticated using (public.sk_channel_is_relay());
create policy "relay updates request progress" on public.sk_requests for update to authenticated
  using (public.sk_channel_is_relay()) with check (public.sk_channel_is_relay());
