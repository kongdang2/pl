-- 018 (11/03, hong): 담당자도 챗봇에 캡처·파일을 올리고, 챗봇이 만든 파일(CSV 등)을 받는다.
-- 담당자 파일은 sonik-channel/담당/<내 이메일>/ 아래에만 올리고 읽는다(남의 것은 못 봄). 중계는 기존 정책으로 모두 읽고 쓴다.
create policy "member channel files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'sonik-channel' and (storage.foldername(name))[1] = '담당'
    and (storage.foldername(name))[2] = public.sk_member_email());
create policy "member channel files read" on storage.objects for select to authenticated
  using (bucket_id = 'sonik-channel' and (storage.foldername(name))[1] = '담당'
    and (storage.foldername(name))[2] = public.sk_member_email());
