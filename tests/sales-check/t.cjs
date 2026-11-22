// node tests/sales-check/t.cjs — 판매담당 1차 점검 규칙(pc/판매점검.cjs) 시험. 가짜 판매 요약만 씀
// 첫 저장 = 금액 0·판가 급변만 / 다시 저장 = 바뀐 줄의 빠진 품목·물량·포뮬러(100톤 이상) (hong 11-22 첫 실가동 45건 소음 뒤)
const { check, message } = require('../../pc/판매점검.cjs');
const clone = (x) => JSON.parse(JSON.stringify(x));
const d0 = { v:1, yms:['2026-11','2026-12'], prev:'2026-10', px:{'2026-10':[600,1400],'2026-11':[610,1410],'2026-12':[620,1420]}, sd:[], s:{ onsan:{
  'c:2026-10': [['에틸렌','x',20000,26000],['부타디엔','d',8000,12000],['C9+','d',3000,2400],['C4 LPG','d',15,18]],
  '2026-11': [['에틸렌','x',21000,27300,2,0,2],['부타디엔','d',8200,16400,0,1,1],['MFO','d',100,0,0,1,1],['C9+','d',3000,2400,1,0,1]],
  '2026-12': [['에틸렌','x',21000,27300,1,0,1],['부타디엔','d',8200,16400,0,1,1],['C9+','d',2900,2320,1,0,1]] }, ulsan:{'c:2026-10':[],'2026-11':[],'2026-12':[]} } };
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };
const r0 = check(d0, null), k0 = r0.map((x) => x.kind).sort().join();
ok(k0 === 'noamt,price', '첫 저장 = 금액 0·판가 급변만', r0.map((x) => x.text));
ok(!r0.some((x) => /C4 LPG/.test(x.text)), '15톤 C4 LPG 가 빠져도 첫 저장엔 안 알림');
ok(/첫 점검이라 기준점/.test(message('a', '', r0, true)), '첫 점검 안내 문구');
// 다시 저장: 12월 에틸렌 수량 21,000 → 9,000 + 포뮬러 → 직접, 12월 C9+ 삭제
const d1 = clone(d0); d1.s.onsan['2026-12'] = [['에틸렌','x',9000,11700,0,1,1],['부타디엔','d',8200,16400,0,1,1]];
const r1 = check(d1, d0), m1 = message('시험', '김', r1, false), L = m1.split('\n').filter((l) => l.startsWith('- '));
ok(L.length === 3, '다시 저장 = 바뀐 줄 문제만 3건', L);
ok(L.some((l) => /12월 온산 C9\+ 내수: 판매가 없음/.test(l)), '바뀐 줄의 빠진 품목(100톤 이상)');
ok(L.some((l) => /12월 온산 에틸렌 수출: 수량 21,000 → 9,000/.test(l)), '바뀐 줄의 물량 급변');
ok(L.some((l) => /포뮬러 단가였는데 직접/.test(l)), '포뮬러 → 직접');
ok(!L.some((l) => /MFO|부타디엔/.test(l)), '안 바뀐 줄(11월 MFO 금액 0, 부타디엔 판가)은 다시 알리지 않음');
ok(message('a', '', check(d1, d1), false) === null, '같은 요약 다시 저장 = 알림 없음');
const d2 = clone(d1); d2.sd = ['2026-12']; ok(!check(d2, d0).some((x) => x.ym === '2026-12' && (x.kind === 'missing' || x.kind === 'qty')), 'S/D 달은 빠짐·물량 점검 안 함');
const d3 = clone(d0); d3.s.onsan['2026-12'] = d3.s.onsan['2026-12'].filter((r) => r[0] !== 'C9+'); d3.s.onsan['2026-11'].push(['C4 LPG','d',15,18,0,1,1]);
const d4 = clone(d3); d4.s.onsan['2026-12'].push(['C4 LPG','d',0,0,0,1,1]);
ok(!check(d4, d3).some((x) => /C4 LPG/.test(x.text)), '100톤 미만은 빠져도 안 알림');
console.log('통과 ' + pass + ' / 실패 ' + fail); process.exit(fail ? 1 : 0);
