// Supabase Usage 값을 가져올 PC 전용 브라우저에 로그인(처음 한 번, 또는 카드에 「다시 로그인 필요」가 뜰 때)
// 실행: 소통\사용량로그인.cmd  → Chrome 창이 뜨면 Supabase 에 로그인 → Usage 화면 값을 확인하면 창이 저절로 닫힌다.
// 중계가 켜져 있어도 된다(중계는 1시간마다 잠깐만 이 프로필을 쓴다. 겹치면 그 회차만 건너뜀).
'use strict';
const { fetchUsage, PROFILE } = require('./사용량브라우저.cjs');
(async () => {
  console.log('Supabase 로그인 창을 엽니다. 로그인하면 Usage 화면 값을 확인하고 창이 저절로 닫힙니다(최대 10분).');
  console.log('로그인 정보 저장 위치: ' + PROFILE);
  try {
    const { usage } = await fetchUsage({ headless: false, waitLoginMin: 10 });
    const list = Array.isArray(usage) ? usage : (usage.usages || usage.usage || []);
    const eg = list.find((x) => String(x.metric || x.name || '').toUpperCase() === 'EGRESS');
    console.log('확인됨. Egress 값: ' + (eg ? JSON.stringify(eg.usage ?? eg.value ?? eg) : '(항목 이름 다름 — 중계가 원문을 DB 에 남깁니다)'));
    console.log('이제 중계가 1시간마다 이 값을 가져옵니다. 바로 반영하려면 중계를 다시 켜 주세요.');
  } catch (e) {
    console.log('확인 실패: ' + (e.message === 'USAGE_NOT_SEEN' ? '로그인이 끝나지 않았거나 Usage 화면이 열리지 않았습니다. 다시 실행해 주세요.' : e.message));
    process.exitCode = 1;
  }
})();
