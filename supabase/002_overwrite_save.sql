-- 2026-10-29: 웹 저장 = 열어 둔 내 웹 스냅샷에 덮어쓰기(직전 3개 숨은 백업), 「새 버전으로 저장」은 새 스냅샷
alter table public.sk_snapshots
  add column if not exists rev integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();
update public.sk_snapshots set updated_at = created_at where rev = 1;
create index if not exists sk_snapshots_updated on public.sk_snapshots (updated_at desc);

create table if not exists public.sk_snapshot_revs (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null references public.sk_snapshots(id) on delete cascade,
  rev integer not null, storage_path text not null unique, size_bytes bigint,
  saved_by text not null, saved_at timestamptz not null,
  unique (snapshot_id, rev)
);
alter table public.sk_snapshot_revs enable row level security;
create policy "members read revs" on public.sk_snapshot_revs for select to authenticated using (public.sk_my_role() is not null);
create policy "admin deletes revs" on public.sk_snapshot_revs for delete to authenticated using (public.sk_my_role() = 'admin');

-- 덮어쓰기: 작성자 본인 + 웹 저장본 + rev 일치일 때만. 새 파일은 미리 snapshots/<id>/ 아래에 올려 둔다.
-- 반환: 지워도 되는 옛 백업 파일 경로(최근 3개 밖)
create or replace function public.sk_overwrite_snapshot(p_id uuid, p_expected_rev integer, p_path text, p_size bigint, p_engine_ver text)
returns json language plpgsql security definer set search_path = public as $$
declare s public.sk_snapshots; me text := lower(coalesce(auth.jwt() ->> 'email','')); old_paths text[];
begin
  if coalesce(public.sk_my_role(),'') not in ('admin','writer') then raise exception 'NO_WRITE'; end if;
  select * into s from public.sk_snapshots where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.source <> 'web' or s.author_email <> me then raise exception 'NOT_OWN'; end if;
  if s.rev <> p_expected_rev then raise exception 'CONFLICT:%', s.rev; end if;
  if p_path not like 'snapshots/' || p_id::text || '/%' then raise exception 'BAD_PATH'; end if;
  insert into public.sk_snapshot_revs (snapshot_id, rev, storage_path, size_bytes, saved_by, saved_at)
    values (s.id, s.rev, s.storage_path, s.size_bytes, s.author_email, s.updated_at);
  update public.sk_snapshots set storage_path = p_path, size_bytes = p_size, rev = s.rev + 1, updated_at = now(),
    engine_ver = coalesce(p_engine_ver, engine_ver) where id = p_id;
  with gone as (
    delete from public.sk_snapshot_revs where snapshot_id = p_id
      and rev not in (select r.rev from public.sk_snapshot_revs r where r.snapshot_id = p_id order by r.rev desc limit 3)
    returning storage_path)
  select coalesce(array_agg(storage_path), '{}') into old_paths from gone;
  return json_build_object('rev', s.rev + 1, 'prune', old_paths);
end $$;
revoke all on function public.sk_overwrite_snapshot(uuid, integer, text, bigint, text) from public, anon;
grant execute on function public.sk_overwrite_snapshot(uuid, integer, text, bigint, text) to authenticated;

-- 작성자는 자기 웹 저장 파일(snapshots/<id>/…)만 지울 수 있다(옛 백업 정리용). PC 원본(snapshots/<id>.json.gz)은 관리자만.
create policy "sonik writers delete own web revs" on storage.objects for delete to authenticated
  using (bucket_id = 'sonik' and (storage.foldername(name))[1] = 'snapshots' and array_length(storage.foldername(name), 1) = 2
         and owner_id = auth.uid()::text and public.sk_my_role() in ('admin','writer'));

-- 첫 엔진은 이전 화면 코드가 「v307-1」을 「v307」로 읽어 기록됨 → 표시만 바로잡기(파일은 같음)
update public.sk_engines set ver = 'v307-1' where ver = 'v307' and note like 'sonik_empty_engine%';
