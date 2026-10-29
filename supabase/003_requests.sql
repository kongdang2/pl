-- 2026-10-29: 수정요청(웹 「수정요청 모드」). 명단 인원은 누구나 접수·열람, 상태는 관리자만 바꾼다.
-- items: [{loc:{zone,site,menu,subs,ym,table}, cells:[{r,c,row,col,value,note}], excerpt:{rows:[[...]], sel:[[r,c]...]}, image:'data:image/png;base64,…', note}]
create table if not exists public.sk_requests (
  id bigint generated always as identity primary key,
  title text not null default '',
  kind text not null default '기타' check (kind in ('계산','표시·서식','기능 추가','기타')),
  body text not null default '',
  items jsonb not null default '[]'::jsonb,
  snapshot_id uuid references public.sk_snapshots(id) on delete set null,
  base_ym text, engine_ver text,
  status text not null default '접수' check (status in ('접수','진행','완료','보류')),
  status_note text not null default '',
  author_email text not null, author_name text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists sk_requests_created on public.sk_requests (created_at desc);
alter table public.sk_requests enable row level security;
create policy "members read requests" on public.sk_requests for select to authenticated using (public.sk_my_role() is not null);
create policy "members add own requests" on public.sk_requests for insert to authenticated
  with check (public.sk_my_role() is not null and author_email = lower(auth.jwt() ->> 'email') and status = '접수');
create policy "admin edits requests" on public.sk_requests for update to authenticated
  using (public.sk_my_role() = 'admin') with check (public.sk_my_role() = 'admin');
create policy "admin deletes requests" on public.sk_requests for delete to authenticated using (public.sk_my_role() = 'admin');
