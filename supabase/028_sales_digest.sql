-- 028 (11-22, hong 「질문은 총괄, 업무는 담당별로 … 판매담당부터 시험」): 저장 직후 사이트가 계산한 판매 요약(수 KB)을 따로 둔다.
-- sk_snapshots 에 열로 두면 목록(select *)마다 함께 내려가 전송량이 늘어서 표를 나눴다. PC 판매담당(중계 계정)이 이것만 읽어 1차 점검한다.
create table if not exists public.sk_digest (
  snapshot_id uuid not null references public.sk_snapshots(id) on delete cascade,
  kind text not null check (kind in ('sales')),
  digest jsonb not null,
  at timestamptz not null default now(),
  primary key (snapshot_id, kind)
);
alter table public.sk_digest enable row level security;
create policy "admin reads digest" on public.sk_digest for select to authenticated using (public.sk_my_role() = 'admin');
create policy "relay reads digest" on public.sk_digest for select to authenticated using (public.sk_channel_is_relay());
create or replace function public.sk_set_digest(p_id uuid, p_kind text, p_digest jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.sk_my_role(), '') not in ('admin', 'writer') then raise exception 'NO_WRITE'; end if;
  if p_kind not in ('sales') then raise exception 'BAD_KIND'; end if;
  if jsonb_typeof(p_digest) <> 'object' or length(p_digest::text) > 200000 then raise exception 'BAD_DIGEST'; end if;
  if not exists (select 1 from public.sk_snapshots where id = p_id) then raise exception 'NOT_FOUND'; end if;
  insert into public.sk_digest (snapshot_id, kind, digest, at) values (p_id, p_kind, p_digest, now())
  on conflict (snapshot_id, kind) do update set digest = excluded.digest, at = excluded.at;
end $$;
revoke all on function public.sk_set_digest(uuid, text, jsonb) from public, anon;
grant execute on function public.sk_set_digest(uuid, text, jsonb) to authenticated;
