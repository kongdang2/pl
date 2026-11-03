-- 팀 공용화 1단계(hong 11/03): ① 담당자(작성자·조회자)별 챗봇 — 자기 대화만, 읽기 전용(⚡) 질의응답
-- ② 담당자 수정요청은 「승인대기」 → 관리자 승인(접수로 바꿈) 때 Claude 앞 대기 글이 생긴다 ③ 무료 한도 현황(보관·DB·이번 달 내려받기)

-- ① 담당자 대화 ─────────────────────────────
alter table public.sk_channel add column if not exists owner text;   -- 담당자 대화의 주인 이메일(hong·에이전트 대화는 null)
create index if not exists sk_channel_owner on public.sk_channel (owner) where owner is not null;
alter table public.sk_channel drop constraint sk_channel_sender_check,
  add constraint sk_channel_sender_check check (sender in ('hong','Codex','Claude','담당'));
alter table public.sk_channel drop constraint sk_channel_recipient_check,
  add constraint sk_channel_recipient_check check (recipient in ('hong','Codex','Claude','모두','담당'));

-- 관리자가 아닌 명단 회원의 이메일(아니면 null)
create or replace function public.sk_member_email() returns text
language sql stable security definer set search_path = public as $$
  select email from public.sk_members where email = lower(coalesce(auth.jwt() ->> 'email','')) and role in ('writer','viewer')
$$;
revoke all on function public.sk_member_email() from public;
revoke execute on function public.sk_member_email() from anon;
grant execute on function public.sk_member_email() to authenticated;

create policy "member reads own chat" on public.sk_channel for select to authenticated
  using (owner is not null and owner = public.sk_member_email());
-- 담당자는 자기 대화에만, ⚡ 읽기 전용(quick)으로만, 첨부 없이 Claude·Codex·모두에게 묻는다. 이어 쓰기는 자기 대화의 글에만
create policy "member writes own chat" on public.sk_channel for insert to authenticated
  with check (sender = '담당' and owner = public.sk_member_email() and author_email = owner
    and recipient in ('Claude','Codex','모두') and status = '대기' and quick and files = '[]'::jsonb and run_state is null
    and (reply_to is null or exists (select 1 from public.sk_channel c where c.id = reply_to and c.owner = public.sk_member_email())));
create policy "member sets own chat status" on public.sk_channel for update to authenticated
  using (owner is not null and owner = public.sk_member_email()) with check (owner is not null and owner = public.sk_member_email());
create policy "members read relay" on public.sk_relay for select to authenticated using (public.sk_my_role() is not null);

-- ② 수정요청 승인 ───────────────────────────
alter table public.sk_requests drop constraint sk_requests_status_check,
  add constraint sk_requests_status_check check (status in ('승인대기','접수','진행','완료','보류','반려'));
create policy "members add requests pending approval" on public.sk_requests for insert to authenticated
  with check (public.sk_my_role() is not null and author_email = lower(auth.jwt() ->> 'email') and status = '승인대기');

create or replace function public.sk_request_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.sk_members where email = new.author_email and role = 'admin') then new.status := '승인대기'; end if;
  return new;
end $$;
revoke all on function public.sk_request_gate() from public, anon, authenticated;
create trigger sk_requests_gate before insert on public.sk_requests for each row execute function public.sk_request_gate();

create or replace function public.sk_request_to_channel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('접수','진행') then return new; end if;
  insert into public.sk_channel (sender, recipient, topic, status, body, author_email, request_id)
  values ('hong', 'Claude', '수정요청 #' || new.id, '대기',
    '수정요청 #' || new.id || ' 접수 (' || coalesce(nullif(new.author_name, ''), new.author_email) || ')'
      || case when tg_op = 'UPDATE' then ' · hong 승인' else '' end || chr(10)
      || '제목: ' || new.title || ' · 구분: ' || new.kind || chr(10)
      || case when new.body <> '' then '설명: ' || new.body || chr(10) else '' end
      || '담은 항목 ' || jsonb_array_length(new.items) || '개 · 스냅샷 ' || coalesce(new.base_ym, '-') || ' / 엔진 ' || coalesce(new.engine_ver, '-') || chr(10)
      || '검토부터 진행해 주세요.',
    new.author_email, new.id);
  return new;
end $$;
revoke all on function public.sk_request_to_channel() from public, anon, authenticated;
create trigger sk_requests_approved after update of status on public.sk_requests
  for each row when (old.status = '승인대기' and new.status = '접수') execute function public.sk_request_to_channel();

-- ③ 무료 한도 현황 ──────────────────────────
-- 내려받기(egress)는 Supabase 가 바깥으로 알려 주지 않아서, 사이트·중계가 받은 파일 크기를 직접 적는다(추정치)
create table if not exists public.sk_egress (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  email text not null,
  bytes bigint not null check (bytes >= 0),
  what text not null default ''
);
create index if not exists sk_egress_at on public.sk_egress (at);
alter table public.sk_egress enable row level security;
create policy "members log own egress" on public.sk_egress for insert to authenticated
  with check ((public.sk_my_role() is not null or public.sk_channel_is_relay()) and email = lower(auth.jwt() ->> 'email'));
create policy "admin reads egress" on public.sk_egress for select to authenticated using (public.sk_my_role() = 'admin');

create or replace function public.sk_usage() returns json
language plpgsql stable security definer set search_path = public, storage as $$
declare m timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if public.sk_my_role() is null then raise exception 'NOT_MEMBER'; end if;
  return json_build_object(
    'db', pg_database_size(current_database()),
    'storage', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'egress_month', (select coalesce(sum(bytes), 0) from public.sk_egress where at >= m),
    'egress_today', (select coalesce(sum(bytes), 0) from public.sk_egress where at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'month_start', m, 'at', now());
end $$;
revoke all on function public.sk_usage() from public;
revoke execute on function public.sk_usage() from anon;
grant execute on function public.sk_usage() to authenticated;
alter publication supabase_realtime add table public.sk_egress;
