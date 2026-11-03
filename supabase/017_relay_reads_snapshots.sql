-- 017 (11/03): 열린 자료 기준 챗봇 답(016)을 위해 PC 중계 계정(챗봇 Codex·Claude)이 추정자료를 읽게 한다. 읽기만.
-- sk_channel_name() 은 관리자(hong)와 중계 계정에만 이름을 준다(담당자는 null).
create policy "relay reads snapshots" on public.sk_snapshots for select to authenticated
  using (public.sk_channel_name() in ('Codex', 'Claude'));
create policy "relay reads sonik files" on storage.objects for select to authenticated
  using (bucket_id = 'sonik' and (storage.foldername(name))[1] = 'snapshots' and public.sk_channel_name() in ('Codex', 'Claude'));
