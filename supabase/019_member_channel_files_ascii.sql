-- 019 (11/03): 저장소 키에 한글을 쓸 수 없어 018 의 「담당/」 폴더는 쓰지 못했다(InvalidKey).
-- 담당자 파일은 member/<이메일에서 영문·숫자·._- 밖을 _ 로 바꾼 것>/ 아래에 둔다. 018 정책은 남아 있지만 쓰이지 않는다.
create policy "member channel files add2" on storage.objects for insert to authenticated
  with check (bucket_id = 'sonik-channel' and (storage.foldername(name))[1] = 'member'
    and (storage.foldername(name))[2] = regexp_replace(public.sk_member_email(), '[^a-z0-9._-]', '_', 'g'));
create policy "member channel files read2" on storage.objects for select to authenticated
  using (bucket_id = 'sonik-channel' and (storage.foldername(name))[1] = 'member'
    and (storage.foldername(name))[2] = regexp_replace(public.sk_member_email(), '[^a-z0-9._-]', '_', 'g'));
