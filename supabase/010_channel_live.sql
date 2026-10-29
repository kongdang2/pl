-- 2026-10-30 (hong): 채팅창에서 Claude·Codex 가 작업하는 과정을 앱처럼 실시간으로 본다.
-- 중계가 실행 중인 글의 live 에 진행 이벤트를 몇 초마다 덧붙인다: [{ "at": 시각, "a": "Claude", "k": "read|edit|run|search|text|think|tool", "s": "한 줄 요약" }]
alter table public.sk_channel add column if not exists live jsonb not null default '[]'::jsonb;
grant update (live) on public.sk_channel to authenticated;
