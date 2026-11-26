// node tests/confirmed-check.test.cjs — 확정 자료 비교(confirmed-check.js) 단위 시험. 실데이터 없음
const CC = require('../confirmed-check.js');
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };
const base = () => ({ onsan: { confirmedPrice: { '2026-10': { mopj: 800 } } },
  ulsan: { confirmedSales: { '2026-01': { HDPE: { dom: { qty: 13374.825, amt: 18990.06, unitKrw: 1419836, unitUsd: 976.08 } } }, '2026-10': { HDPE: { dom: { qty: 9463.525, amt: 13100.5 } } } } }, head: {} });
// 같음·빈 값·계산 오차
ok(CC.check(base(), base()) === null, '같으면 null');
let m = base(); m.ulsan.confirmedSales['2026-12'] = { HDPE: { dom: { qty: 0, amt: 0, unitKrw: 0 }, exp: {} } }; m.head.confirmedCost = {}; m.ulsan.confirmedPurchase = { '2026-01': { 프로필렌: { imp: { qty: null, note: '' } } } };
ok(CC.check(base(), m) === null, '빈 자리(0·null·\'\'·빈 묶음)가 생긴 것은 변경 아님', CC.check(base(), m));
m = base(); m.ulsan.confirmedSales['2026-01'].HDPE.dom.amt *= (1 + 1e-13);
ok(CC.check(base(), m) === null, '계산 오차는 변경 아님');
ok(CC.check(null, null) === null && CC.check(undefined, {}) === null, '둘 다 없음');
// 사고 모양
m = base(); Object.assign(m.ulsan.confirmedSales['2026-01'].HDPE.dom, { qty: 0, unitKrw: 0, unitUsd: 0 }); m.ulsan.confirmedSales['2026-10'].HDPE.dom.qty = 9463.52513374;
let r = CC.check(base(), m);
ok(r && r.total === 4 && r.rows.length === 2 && !r.added.length && !r.removed.length, '1월 수량 0 + 10월 이어 붙음 = 4칸·2곳', r);
ok(CC.label(r.rows[0].path) === '울산 · 확정 판매 · 2026-01 · HDPE · 내수', '위치 이름', CC.label(r.rows[0].path));
ok(CC.fieldsText(r.rows[0].fields, 'before') === '수량 13,374.825 · 원화단가 1,419,836 · 외화단가 976.08' && CC.fieldsText(r.rows[0].fields, 'after') === '수량 0 · 원화단가 0 · 외화단가 0', '이전·지금 글', [CC.fieldsText(r.rows[0].fields, 'before'), CC.fieldsText(r.rows[0].fields, 'after')]);
ok(CC.fieldsText(r.rows[1].fields, 'after') === '수량 9,463.52513374', '10월 지금 값(소수 자리 그대로)', CC.fieldsText(r.rows[1].fields, 'after'));
ok(/^확정 4칸 · 바뀜 2곳 \(울산 · 확정 판매 · 2026-01 · HDPE · 내수 외\)$/.test(r.note), '기록용 요약', r.note);
// 새 달 / 없어진 달 / 있던 달에 새 품목
m = base(); m.ulsan.confirmedSales['2026-11'] = { HDPE: { dom: { qty: 9000, amt: 12000 } }, PP: { exp: { qty: 500 } } }; m.onsan.confirmedPrice['2026-11'] = { mopj: 790 };
r = CC.check(base(), m);
ok(r && r.added.length === 1 && r.added[0].ym === '2026-11' && r.added[0].n === 4 && r.added[0].where.join('|') === '온산 확정 가격|울산 확정 판매' && !r.rows.length, '새 달은 달마다 한 묶음', r);
m = base(); delete m.ulsan.confirmedSales['2026-10'];
r = CC.check(base(), m);
ok(r && r.removed.length === 1 && r.removed[0].n === 2 && CC.label(r.removed[0].path) === '울산 · 확정 판매 · 2026-10' && !r.rows.length, '통째로 없어진 달', r);
m = base(); m.ulsan.confirmedSales['2026-10'].PP = { dom: { qty: 100 } };
r = CC.check(base(), m);
ok(r && r.rows.length === 1 && CC.label(r.rows[0].path) === '울산 · 확정 판매 · 2026-10 · PP · 내수' && CC.fieldsText(r.rows[0].fields, 'before') === '수량 (없음)', '있던 달에 새 품목 = 바뀐 곳', r);
// 값 ↔ 묶음, 글자 값, 이름 없는 종류
m = base(); m.onsan.confirmedPrice['2026-10'].mopj = { a: 1 }; m.onsan.confirmedFoo = { '2026-10': { x: 'abc' } }; const b2 = base(); b2.onsan.confirmedFoo = { '2026-10': { x: 'abd' } };
r = CC.check(b2, m);
ok(r && r.rows.length === 2 && r.rows.some((x) => CC.label(x.path) === '온산 · 확정 Foo · 2026-10' && CC.fieldsText(x.fields, 'after') === 'x abc'), '모양이 바뀐 칸·글자 값·모르는 종류 이름', r);
console.log('confirmed-check.test: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
