-- 2026-10-29 적용(프로젝트 sonik). Supabase 마이그레이션 sonik_init + sonik_revoke_anon_role_fn 과 같은 내용.
create table public.sk_members (
  email text primary key check (email = lower(email)),
  name text not null default '',
  role text not null check (role in ('admin','writer','viewer')),
  areas text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table public.sk_engines (
  ver text primary key, storage_path text not null, size_bytes bigint, sha256 text,
  is_current boolean not null default false, note text not null default '',
  uploaded_by text not null, uploaded_at timestamptz not null default now()
);
create unique index sk_engines_one_current on public.sk_engines (is_current) where is_current;
create table public.sk_snapshots (
  id uuid primary key default gen_random_uuid(),
  base_ym text not null, engine_ver text, mode text not null default 'sonik', scope text not null default 'all',
  source text not null check (source in ('pc','web')), parent_id uuid references public.sk_snapshots(id),
  memo text not null default '', author_email text not null, author_name text not null default '',
  storage_path text not null unique, size_bytes bigint, created_at timestamptz not null default now()
);
create index sk_snapshots_ym on public.sk_snapshots (base_ym, created_at desc);
create table public.sk_log (
  id bigint generated always as identity primary key, email text not null, action text not null,
  snapshot_id uuid, detail text not null default '', at timestamptz not null default now()
);

create or replace function public.sk_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.sk_members where email = lower(coalesce(auth.jwt() ->> 'email',''))
$$;
revoke all on function public.sk_my_role() from public;
revoke execute on function public.sk_my_role() from anon;
grant execute on function public.sk_my_role() to authenticated;

alter table public.sk_members enable row level security;
alter table public.sk_engines enable row level security;
alter table public.sk_snapshots enable row level security;
alter table public.sk_log enable row level security;

create policy "members read self, admin reads all" on public.sk_members for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.sk_my_role() = 'admin');
create policy "admin manages members" on public.sk_members for all to authenticated
  using (public.sk_my_role() = 'admin') with check (public.sk_my_role() = 'admin');
create policy "members read engines" on public.sk_engines for select to authenticated using (public.sk_my_role() is not null);
create policy "admin manages engines" on public.sk_engines for all to authenticated
  using (public.sk_my_role() = 'admin') with check (public.sk_my_role() = 'admin');
create policy "members read snapshots" on public.sk_snapshots for select to authenticated using (public.sk_my_role() is not null);
create policy "writers add own snapshots" on public.sk_snapshots for insert to authenticated
  with check (public.sk_my_role() in ('admin','writer') and author_email = lower(auth.jwt() ->> 'email'));
create policy "admin edits snapshots" on public.sk_snapshots for update to authenticated
  using (public.sk_my_role() = 'admin') with check (public.sk_my_role() = 'admin');
create policy "admin deletes snapshots" on public.sk_snapshots for delete to authenticated using (public.sk_my_role() = 'admin');
create policy "members write own log" on public.sk_log for insert to authenticated
  with check (public.sk_my_role() is not null and email = lower(auth.jwt() ->> 'email'));
create policy "admin reads log" on public.sk_log for select to authenticated using (public.sk_my_role() = 'admin');

insert into storage.buckets (id, name, public, file_size_limit) values ('sonik', 'sonik', false, 52428800);
create policy "sonik members read" on storage.objects for select to authenticated
  using (bucket_id = 'sonik' and public.sk_my_role() is not null);
create policy "sonik writers add snapshots" on storage.objects for insert to authenticated
  with check (bucket_id = 'sonik' and (storage.foldername(name))[1] = 'snapshots' and public.sk_my_role() in ('admin','writer'));
create policy "sonik admin adds engines" on storage.objects for insert to authenticated
  with check (bucket_id = 'sonik' and (storage.foldername(name))[1] = 'engines' and public.sk_my_role() = 'admin');
create policy "sonik admin updates" on storage.objects for update to authenticated using (bucket_id = 'sonik' and public.sk_my_role() = 'admin');
create policy "sonik admin deletes" on storage.objects for delete to authenticated using (bucket_id = 'sonik' and public.sk_my_role() = 'admin');

-- 관리자(hong)는 대시보드에서 별도 등록: insert into public.sk_members (email, name, role) values ('<관리자 이메일>', 'hong', 'admin');
