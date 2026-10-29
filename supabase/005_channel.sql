-- 2026-10-30: 소통 채널(hong · Codex · Claude). PC 소통\채널.md 를 대신한다.
-- Codex 같은 에이전트 계정은 sk_members 에 넣지 않고 sk_agents 에만 둔다.
-- 그래서 기존 정책(sk_my_role() is not null)은 그대로이고, 에이전트는 스냅샷·엔진·수정요청을 볼 수 없다.
-- Claude 는 서비스 권한 SQL 로 읽고 쓴다(sender = 'Claude').
create table if not exists public.sk_agents (
  email text primary key check (email = lower(email)),
  name text not null unique check (name in ('Codex')),
  created_at timestamptz not null default now()
);
alter table public.sk_agents enable row level security;
create policy "admin manages agents" on public.sk_agents for all to authenticated
  using (public.sk_my_role() = 'admin') with check (public.sk_my_role() = 'admin');

-- 채널에서 쓰는 이름: 관리자 = 'hong', 에이전트 = sk_agents.name, 그 밖 = null(읽기·쓰기 불가)
create or replace function public.sk_channel_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'hong' from public.sk_members where email = lower(coalesce(auth.jwt() ->> 'email','')) and role = 'admin'),
    (select name from public.sk_agents where email = lower(coalesce(auth.jwt() ->> 'email',''))))
$$;
revoke all on function public.sk_channel_name() from public;
revoke execute on function public.sk_channel_name() from anon;
grant execute on function public.sk_channel_name() to authenticated;

create table if not exists public.sk_channel (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  sender text not null check (sender in ('hong','Codex','Claude')),
  recipient text not null check (recipient in ('hong','Codex','Claude','모두')),
  topic text not null default '',
  status text not null default '대기' check (status in ('대기','답변','완료','안내')),
  reply_to bigint references public.sk_channel(id) on delete set null,
  body text not null default '',
  author_email text not null,
  updated_at timestamptz not null default now()
);
create index if not exists sk_channel_at on public.sk_channel (at desc);
alter table public.sk_channel enable row level security;
create policy "channel read" on public.sk_channel for select to authenticated
  using (public.sk_channel_name() is not null);
create policy "channel write own" on public.sk_channel for insert to authenticated
  with check (sender = public.sk_channel_name() and author_email = lower(auth.jwt() ->> 'email'));
create policy "channel set status" on public.sk_channel for update to authenticated
  using (public.sk_channel_name() is not null) with check (public.sk_channel_name() is not null);
-- 글 내용은 고치지 않는다: 상태만 바꿀 수 있다
revoke update on public.sk_channel from authenticated;
grant update (status, updated_at) on public.sk_channel to authenticated;
