// node tests/sales-check/t.cjs — 판매담당 1차 점검 규칙(pc/판매점검.cjs) 시험. 가짜 판매 요약만 씀
const { check, message } = require('../../pc/판매점검.cjs');
const d = { v:1, yms:['2026-11','2026-12'], prev:'2026-10', px:{'2026-10':[600,1400],'2026-11':[610,1410],'2026-12':[620,1420]}, sd:[], s:{ onsan:{
  'c:2026-10': [['에틸렌','x',20000,26000],['부타디엔','d',8000,12000],['C9+','d',3000,2400]],
  '2026-11': [['에틸렌','x',21000,27300,2,0,2],['부타디엔','d',8200,16400,0,1,1],['MFO','d',100,0,0,1,1]],
  '2026-12': [['에틸렌','x',9000,11700,0,1,1],['부타디엔','d',8200,16400,0,1,1],['C9+','d',2000,1600,1,0,1]] }, ulsan:{'c:2026-10':[],'2026-11':[],'2026-12':[]} } };
let r = check(d, null); console.log(r.map(x=>x.kind+' '+x.text).join('\n'));
const dp = JSON.parse(JSON.stringify(d)); dp.s.onsan['2026-12'][0]=['에틸렌','x',9000,11700,1,0,1];
const r2 = check(d, dp); console.log('---\n'+message('시험 자료','김',r2,false));
const ok = (c,m)=>{ if(!c){console.log('FAIL',m); process.exitCode=1;} else console.log('PASS',m); };
ok(r.some(x=>x.kind==='missing'&&/26.11월 온산 C9\+/.test(x.text)), '빠진 품목(직전 확정월 대비)');
ok(r.some(x=>x.kind==='price'&&/부타디엔/.test(x.text)), '판가 급변 +33%');
ok(r.some(x=>x.kind==='noamt'&&/MFO/.test(x.text)), '수량 있는데 금액 0');
ok(r.some(x=>x.kind==='qty'&&/26.12월 온산 에틸렌/.test(x.text)), '물량 급변');
ok(!r.some(x=>x.kind==='formula'), '직전 요약 없으면 포뮬러 비교 안 함');
ok(r2.some(x=>x.kind==='formula'&&x.changed), '포뮬러→직접 바뀜');
ok(message('a','',r2,false).split('\n').filter(l=>l.startsWith('- ')).length===2, '다시 저장 땐 바뀐 줄 문제만 (에틸렌 12월 포뮬러·물량 2건)');
const d3 = JSON.parse(JSON.stringify(d)); d3.sd=['2026-12']; ok(!check(d3,null).some(x=>x.ym==='2026-12'&&(x.kind==='missing'||x.kind==='qty')), 'S/D 달은 빠짐·물량 점검 안 함');
ok(message('a','',check(d,d),false)===null, '같은 요약 다시 저장 = 알림 없음');
