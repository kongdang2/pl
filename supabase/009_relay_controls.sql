-- 2026-10-30 (hong): 소통창에서 모델 고르기, 작업 중지, 작업 중 빠른 질문.
-- 모델: 비우면 PC 의 각 CLI 기본값(중계설정.json 이 있으면 그 값). 중계는 작업을 시작할 때마다 읽는다.
alter table public.sk_relay add column if not exists claude_model text not null default '';
alter table public.sk_relay add column if not exists codex_model text not null default '';
alter table public.sk_relay add column if not exists codex_effort text not null default '';
-- 중지 요청: 실행 중인 글 번호를 적으면 중계가 그 실행을 끊는다
alter table public.sk_relay add column if not exists stop_id bigint;
grant update (claude_model, codex_model, codex_effort, stop_id) on public.sk_relay to authenticated;
-- 빠른 질문: 진행 중인 작업과 따로, 파일을 고치지 않는 읽기 전용 실행으로 바로 답한다
alter table public.sk_channel add column if not exists quick boolean not null default false;
