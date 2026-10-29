-- (미적용 초안: 중계 방식 결정 후 적용)
-- 2026-10-30: PC 중계 프로그램(소통\중계.cjs). 웹 「소통」의 대기 글을 보고 codex exec / claude -p 를 실행해 답을 올린다.
-- 중계는 Codex 에이전트 계정으로 로그인한다. can_relay 인 에이전트는 Codex·Claude 이름으로 글을 쓸 수 있다.
alter table public.sk_agents add column if not exists can_relay boolean not null default false;

create or replace function public.sk_channel_is_relay() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select can_relay from public.sk_agents where email = lower(coalesce(auth.jwt() ->> 'email',''))), false)
$$;
revoke all on function public.sk_channel_is_relay() from public;
revoke execute on function public.sk_channel_is_relay() from anon;
grant execute on function public.sk_channel_is_relay() to authenticated;

-- 기존 「channel write own」(자기 이름) 정책에 더해, 중계 계정은 Codex·Claude 이름으로 쓸 수 있다(정책은 OR 로 합쳐진다)
create policy "relay writes as agents" on public.sk_channel for insert to authenticated
  with check (author_email = lower(auth.jwt() ->> 'email') and sender in ('Codex','Claude') and public.sk_channel_is_relay());

-- 글마다 중계 실행 상태: null(대상 아님·아직) · 실행중 · 완료 · 실패 · 건너뜀
alter table public.sk_channel add column if not exists run_state text check (run_state in ('실행중','완료','실패','건너뜀'));
alter table public.sk_channel add column if not exists run_note text not null default '';
grant update (run_state, run_note) on public.sk_channel to authenticated;

-- 중계 제어(한 줄): 멈춤, 마지막 신호, 자동 왕복 한도
create table if not exists public.sk_relay (
  id smallint primary key default 1 check (id = 1),
  paused boolean not null default false,
  max_hops smallint not null default 6,
  heartbeat timestamptz,
  busy_with bigint,
  updated_at timestamptz not null default now()
);
insert into public.sk_relay (id) values (1) on conflict (id) do nothing;
alter table public.sk_relay enable row level security;
create policy "relay read" on public.sk_relay for select to authenticated using (public.sk_channel_name() is not null);
create policy "relay update" on public.sk_relay for update to authenticated
  using (public.sk_channel_name() is not null) with check (public.sk_channel_name() is not null);
revoke update on public.sk_relay from authenticated;
grant update (paused, heartbeat, busy_with, updated_at) on public.sk_relay to authenticated;
