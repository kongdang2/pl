-- 저장소 정리(hong 11-05 「반자동: 후보 확인 후 삭제」): 관리자가 저장소 한도 카드의 「🧹 정리」에서
-- 30일 지난 챗봇 첨부를 지울 수 있게 한다. sonik-channel 버킷에는 지금까지 지우기 정책이 없었다.
-- (sonik 버킷 엔진·추정자료는 001 「sonik admin deletes」로 이미 지울 수 있음)
create policy "channel files admin deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'sonik-channel' and public.sk_my_role() = 'admin');
