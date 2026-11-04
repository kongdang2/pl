-- 챗봇 답의 수정요청 초안에서 올린 요청(hong 11-04): 어느 답에서 올렸는지 남겨, 같은 초안을 두 번 올리지 않게 카드에 「올렸습니다 #N」을 보인다
alter table public.sk_requests add column if not exists chat_id bigint references public.sk_channel(id) on delete set null;
create index if not exists sk_requests_chat_id_idx on public.sk_requests(chat_id) where chat_id is not null;
comment on column public.sk_requests.chat_id is '챗봇 답(요청 초안)에서 올린 수정요청이면 그 답 글 id (hong 11-04)';
