-- 소통 글(sk_channel)이 올라오는 즉시 PC 중계·웹 화면이 알 수 있게 Realtime 에 싣는다(hong 10/30 「확인주기 개선」).
-- 받는 쪽은 RLS 그대로(관리자·sk_agents 만 sk_channel 을 읽을 수 있으므로 그들에게만 알림이 간다). 20초·10초 주기 확인은 예비로 남긴다.
alter publication supabase_realtime add table public.sk_channel;
