-- 021 (hong 11/04 결정 「작성자 누구나 덮어쓰기」): 웹 저장본은 작성자(writer·admin) 누구나 덮어써 저장한다.
--  · PC 원본은 그대로 첫 저장 = 새 저장본(덮어쓰기 안 됨)
--  · 마지막으로 저장한 사람을 남긴다(last_saved_by / last_saved_name). 「이전 저장」 백업의 saved_by = 그 판을 저장한 사람
--  · 덮어써서 밀려난 옛 파일(목록·백업 어디에도 안 쓰이는 파일)은 작성자 누구나 지울 수 있다(남이 올린 파일이라도).
--    쓰이는 파일(현재 판·남은 백업 3개)은 지금처럼 본인 업로드분·관리자만 지운다.
alter table public.sk_snapshots add column if not exists last_saved_by text;
alter table public.sk_snapshots add column if not exists last_saved_name text;

create or replace function public.sk_overwrite_snapshot(p_id uuid, p_expected_rev integer, p_path text, p_size bigint, p_engine_ver text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s public.sk_snapshots; me text := lower(coalesce(auth.jwt() ->> 'email','')); my_name text; old_paths text[];
begin
  if coalesce(public.sk_my_role(),'') not in ('admin','writer') then raise exception 'NO_WRITE'; end if;
  select * into s from public.sk_snapshots where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.source <> 'web' then raise exception 'NOT_OWN'; end if;   -- PC 원본만 막는다(웹 저장본은 작성자 누구나)
  if s.rev <> p_expected_rev then raise exception 'CONFLICT:%', s.rev; end if;
  if p_path not like 'snapshots/' || p_id::text || '/%' then raise exception 'BAD_PATH'; end if;
  select coalesce(nullif(m.name,''), m.email) into my_name from public.sk_members m where m.email = me;
  insert into public.sk_snapshot_revs (snapshot_id, rev, storage_path, size_bytes, saved_by, saved_at)
    values (s.id, s.rev, s.storage_path, s.size_bytes, coalesce(s.last_saved_by, s.author_email), s.updated_at);
  update public.sk_snapshots set storage_path = p_path, size_bytes = p_size, rev = s.rev + 1, updated_at = now(),
    engine_ver = coalesce(p_engine_ver, engine_ver), last_saved_by = me, last_saved_name = my_name where id = p_id;
  with gone as (
    delete from public.sk_snapshot_revs where snapshot_id = p_id
      and rev not in (select r.rev from public.sk_snapshot_revs r where r.snapshot_id = p_id order by r.rev desc limit 3)
    returning storage_path)
  select coalesce(array_agg(storage_path), '{}') into old_paths from gone;
  return json_build_object('rev', s.rev + 1, 'prune', old_paths);
end $function$;

-- 쓰이지 않는 웹 저장 파일(snapshots/<id>/…) 정리: 작성자 누구나
create or replace function public.sk_snapshot_file_unused(p_name text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select not exists (select 1 from public.sk_snapshots where storage_path = p_name)
         and not exists (select 1 from public.sk_snapshot_revs where storage_path = p_name) $$;
create policy "sonik writers delete unused web revs" on storage.objects for delete to authenticated
  using (bucket_id = 'sonik' and (storage.foldername(name))[1] = 'snapshots' and array_length(storage.foldername(name), 1) = 2
         and public.sk_my_role() = any (array['admin','writer']) and public.sk_snapshot_file_unused(name));
