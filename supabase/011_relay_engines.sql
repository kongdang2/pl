-- 2026-10-30: 웹 엔진 자동 갱신(웹테스트\웹엔진갱신.cjs, 중계가 10분마다 부름). 중계 계정이 웹 시험판(vNNN-n) 빈 엔진을 올리고 현재 엔진으로 바꿀 수 있다.
-- 범위를 좁힌다: 엔진 표(sk_engines)는 웹 시험판 번호(vNNN-n)만, 저장소는 sonik 버킷의 engines/ 아래에 새 파일 추가만(지우기·덮어쓰기 없음).
create policy "relay reads engines" on public.sk_engines for select to authenticated using (public.sk_channel_is_relay());
create policy "relay adds web engines" on public.sk_engines for insert to authenticated
  with check (public.sk_channel_is_relay() and ver ~ '^v[0-9]+-[0-9]+$' and uploaded_by = lower(auth.jwt() ->> 'email'));
create policy "relay switches web engines" on public.sk_engines for update to authenticated
  using (public.sk_channel_is_relay() and ver ~ '^v[0-9]+-[0-9]+$')
  with check (public.sk_channel_is_relay() and ver ~ '^v[0-9]+-[0-9]+$');
create policy "relay uploads engine files" on storage.objects for insert to authenticated
  with check (bucket_id = 'sonik' and name like 'engines/%' and public.sk_channel_is_relay());
