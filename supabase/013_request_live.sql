-- 수정요청 진행을 실시간으로(hong 11/02): 단계 단순화(접수 › 작업중 › 완료) + 지금 누가 작업 중인지 + Realtime.
-- 단계 값은 그대로 쓴다: 0 = 접수, 1~3 = 작업중, 4 = 완료(옛 기록과 맞춤). 「보류」는 쓰지 않는다(작업중으로 본다).
alter table public.sk_requests add column if not exists working text;   -- 지금 작업 중인 담당(Claude/Codex), 끝나면 null
grant update (working) on public.sk_requests to authenticated;
alter publication supabase_realtime add table public.sk_requests;
update public.sk_requests set status = '진행' where status = '보류';
