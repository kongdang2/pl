-- 수정요청 진행 단계(0 접수 · 1 검토 · 2 수정 · 3 검증 · 4 반영)와 Claude 답변 기록.
-- 상태는 사람이 고르지 않고 Claude가 처리하면서 갱신한다(서비스 권한 SQL).
alter table public.sk_requests add column if not exists stage smallint not null default 0 check (stage between 0 and 4);
alter table public.sk_requests add column if not exists progress jsonb not null default '[]'::jsonb; -- [{at, stage, text}]
