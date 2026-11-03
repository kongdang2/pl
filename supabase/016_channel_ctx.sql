-- 016 (11/03, hong): 챗봇 질문에 「지금 열어 둔 자료·화면」을 붙인다.
-- ctx = { snap_id, snap_memo, kind, base_ym, rev, engine_ver, loc, ym, screen, cut } — 사이트가 질문을 보낼 때만 채운다.
-- 중계는 screen 을 첨부\<글번호>\화면.txt 로 쓰고, 필요하면 그 추정자료(snap_id·rev)를 받아 자료\ 에 둔다.
alter table public.sk_channel add column if not exists ctx jsonb;
