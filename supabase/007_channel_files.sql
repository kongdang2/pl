-- 2026-10-30: 소통 첨부(이미지·파일). 손익 스냅샷 버킷(sonik)은 명단 전원이 읽으므로, 소통 첨부는 따로 비공개 버킷에 둔다.
-- hong(관리자)과 에이전트 계정(sk_channel_name() 가 있는 사람)만 올리고 읽는다. 지우거나 바꾸지 않는다(기록 보존).
insert into storage.buckets (id, name, public, file_size_limit)
values ('sonik-channel', 'sonik-channel', false, 20971520)
on conflict (id) do nothing;

create policy "channel files read" on storage.objects for select to authenticated
  using (bucket_id = 'sonik-channel' and public.sk_channel_name() is not null);
create policy "channel files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'sonik-channel' and public.sk_channel_name() is not null);

-- 글마다 첨부 목록: [{ "path": "<글쓴이>/<시각>_<이름>", "name": "원래 이름", "size": 바이트, "type": "image/png" }]
alter table public.sk_channel add column if not exists files jsonb not null default '[]'::jsonb;
