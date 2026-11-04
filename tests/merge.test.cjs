// node tests/merge.test.cjs — merge.js 단위 시험(실데이터 없음)
const M = require('../merge.js');
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const J = (v) => JSON.parse(JSON.stringify(v));
const row = (mk, prod, qty, extra) => Object.assign({ _mk: mk, prod, qty }, extra || {});
function base() {
  return { onsan: { sales: { '2026-11': [row('a', 'EO', 10), row('b', 'MEG', 20), row('c', 'DEG', 30)] }, prices: { fx: 1400, naphtha: 600 } }, note: 'x' };
}
// 1. 한쪽만 바꿈
{ const b = base(), m = J(b), t = J(b); m.onsan.prices.fx = 1410; t.onsan.prices.naphtha = 610;
  const r = M.merge(b, m, t); ok(r.conflicts.length === 0, '1 no conflict'); ok(r.result.onsan.prices.fx === 1410 && r.result.onsan.prices.naphtha === 610, '1 both kept'); }
// 2. 같은 칸 다른 값 → 충돌, 기본 내 값, choice 로 상대 값
{ const b = base(), m = J(b), t = J(b); m.onsan.prices.fx = 1410; t.onsan.prices.fx = 1420;
  const r = M.merge(b, m, t); ok(r.conflicts.length === 1, '2 one conflict'); ok(r.result.onsan.prices.fx === 1410, '2 default mine');
  const r2 = M.merge(b, m, t, { [r.conflicts[0].key]: 't' }); ok(r2.result.onsan.prices.fx === 1420 && r2.conflicts.length === 1, '2 choose theirs');
  ok(M.label(r.conflicts[0]) === '온산 · 기준가격 · 환율', '2 label ' + M.label(r.conflicts[0])); }
// 3. 같은 칸 같은 값 → 충돌 없음
{ const b = base(), m = J(b), t = J(b); m.onsan.prices.fx = 1410; t.onsan.prices.fx = 1410;
  const r = M.merge(b, m, t); ok(r.conflicts.length === 0 && r.result.onsan.prices.fx === 1410, '3 same value'); }
// 4. 같은 행 다른 칸 → 자동 합침 + 확인 필요, 엔진 재정렬(순서 다름)도 번호로 찾음
{ const b = base(), m = J(b), t = J(b); m.onsan.sales['2026-11'][1].qty = 21; t.onsan.sales['2026-11'][1].note = 'n';
  t.onsan.sales['2026-11'].reverse();
  const r = M.merge(b, m, t); const rr = r.result.onsan.sales['2026-11'].find((x) => x._mk === 'b');
  ok(r.conflicts.length === 0 && rr.qty === 21 && rr.note === 'n', '4 merged row'); ok(r.warns.length === 1 && r.warns[0].kind === 'row', '4 warn');
  ok(r.result.onsan.sales['2026-11'].length === 3, '4 length'); }
// 5. 상대가 행 삭제, 나는 안 건드림 → 삭제
{ const b = base(), m = J(b), t = J(b); t.onsan.sales['2026-11'].splice(2, 1);
  const r = M.merge(b, m, t); ok(r.conflicts.length === 0 && r.result.onsan.sales['2026-11'].length === 2, '5 deleted'); }
// 6. 상대 삭제 vs 내 수정 → 묻기
{ const b = base(), m = J(b), t = J(b); t.onsan.sales['2026-11'].splice(2, 1); m.onsan.sales['2026-11'][2].qty = 31;
  const r = M.merge(b, m, t); ok(r.conflicts.length === 1 && r.conflicts[0].kind === 'row', '6 row conflict');
  ok(r.result.onsan.sales['2026-11'].length === 3, '6 default keep mine');
  const r2 = M.merge(b, m, t, { [r.conflicts[0].key]: 't' }); ok(r2.result.onsan.sales['2026-11'].length === 2, '6 theirs deletes');
  ok(M.label(r.conflicts[0]).indexOf('DEG') >= 0, '6 label row'); ok(M.show(r.conflicts[0].theirs) === '(없음·삭제)', '6 show'); }
// 7. 내가 삭제 vs 상대 수정 → 묻기, 기본 내 것(삭제)
{ const b = base(), m = J(b), t = J(b); m.onsan.sales['2026-11'].splice(0, 1); t.onsan.sales['2026-11'][0].qty = 11;
  const r = M.merge(b, m, t); ok(r.conflicts.length === 1 && r.result.onsan.sales['2026-11'].length === 2, '7 mine deletes');
  const r2 = M.merge(b, m, t, { [r.conflicts[0].key]: 't' }); ok(r2.result.onsan.sales['2026-11'].some((x) => x._mk === 'a' && x.qty === 11), '7 theirs keeps'); }
// 8. 양쪽이 행 추가 — 서로 다른 행은 둘 다, 같은 내용(엔진 자동 생성 등)은 하나만
{ const b = base(), m = J(b), t = J(b);
  m.onsan.sales['2026-11'].push(row('w1', 'TEG', 1)); t.onsan.sales['2026-11'].push(row('w2', 'TEG', 1));
  const r = M.merge(b, m, t); ok(r.result.onsan.sales['2026-11'].length === 4, '8 dedupe same added');
  const m2 = J(b), t2 = J(b); m2.onsan.sales['2026-11'].push(row('w1', 'TEG', 1)); t2.onsan.sales['2026-11'].push(row('w2', 'PEG', 2));
  const r2 = M.merge(b, m2, t2); ok(r2.result.onsan.sales['2026-11'].length === 5 && r2.warns.some((w) => w.kind === 'added'), '8 both added + warn'); }
// 9. 새 달(배열 자체가 새로 생김) 양쪽 다르게 → 행 배열 합치기
{ const b = base(), m = J(b), t = J(b); m.onsan.sales['2026-12'] = [row('x', 'EO', 1)]; t.onsan.sales['2026-12'] = [row('y', 'MEG', 2)];
  const r = M.merge(b, m, t); ok(r.conflicts.length === 0 && r.result.onsan.sales['2026-12'].length === 2, '9 new month rows'); }
// 10. 번호 없는 배열(원자 값) → 다르면 충돌
{ const b = { a: [1, 2] }, m = { a: [1, 3] }, t = { a: [1, 4] };
  const r = M.merge(b, m, t); ok(r.conflicts.length === 1 && M.eq(r.result.a, [1, 3]), '10 atomic array'); }
// 11. id 행(costData.rows)
{ const b = { rows: [{ id: 1, v: 1 }, { id: 2, v: 2 }] }, m = J(b), t = J(b); m.rows[0].v = 9; t.rows.push({ id: 3, v: 3 });
  const r = M.merge(b, m, t); ok(r.conflicts.length === 0 && r.result.rows.length === 3 && r.result.rows[0].v === 9, '11 id rows'); }
// 12. 키 삭제 vs 그대로 / 키 삭제 vs 수정
{ const b = { a: 1, c: 1 }, m = { c: 1 }, t = { a: 1, c: 2 };
  const r = M.merge(b, m, t); ok(r.conflicts.length === 0 && !('a' in r.result) && r.result.c === 2, '12 key delete');
  const r2 = M.merge({ a: 1 }, {}, { a: 2 }); ok(r2.conflicts.length === 1 && !('a' in r2.result), '12 delete vs edit default mine'); }
// 13. stamp: 결정적 번호는 두 사람이 같음, 이미 단 번호는 그대로
{ const p1 = { onsan: { sales: { '2026-11': [{ prod: 'EO' }, { prod: 'MEG' }] } }, ulsan: { purchase: { '2026-11': [{ item: 'C2' }] } } };
  const p2 = J(p1); ok(M.stamp(p1, true) === 3 && M.stamp(p2, true) === 3, '13 count'); ok(M.eq(p1, p2), '13 det same');
  ok(p1.onsan.sales['2026-11'][1]._mk === 'os2026-11.1' && p1.ulsan.purchase['2026-11'][0]._mk === 'up2026-11.0', '13 ids');
  p1.onsan.sales['2026-11'].push({ prod: 'DEG' }); ok(M.unstamped(p1) === 1, '13 unstamped'); M.stamp(p1, false);
  ok(M.unstamped(p1) === 0 && p1.onsan.sales['2026-11'][2]._mk[0] === 'w' && p1.onsan.sales['2026-11'][0]._mk === 'os2026-11.0', '13 random new'); }
// 14. 바뀐 칸 수
{ const b = base(), m = J(b), t = J(b); m.onsan.prices.fx = 1; m.note = 'y'; t.onsan.sales['2026-11'][0].qty = 0;
  const r = M.merge(b, m, t); ok(r.stats.mine === 2 && r.stats.theirs === 1, '14 stats ' + JSON.stringify(r.stats)); }
// 15. 입력 원본을 건드리지 않음
{ const b = base(), m = J(b), t = J(b); m.onsan.prices.fx = 1; const snap = JSON.stringify([b, m, t]);
  const r = M.merge(b, m, t); r.result.onsan.prices.fx = 99; ok(JSON.stringify([b, m, t]) === snap, '15 pure'); }
// 16. 수정이력처럼 뒤에 덧붙이기만 한 목록 → 둘 다
{ const b = { sysLog: [{ t: 1 }] }, m = { sysLog: [{ t: 1 }, { t: 2 }] }, t = { sysLog: [{ t: 1 }, { t: 3 }, { t: 2 }] };
  const r = M.merge(b, m, t); ok(r.conflicts.length === 0 && r.result.sysLog.length === 3, '16 append union');
  const r2 = M.merge(b, { sysLog: [] }, t); ok(r2.conflicts.length === 1, '16 delete+append = conflict'); }
// 17. 열고 난 뒤 자동 행 번호(접두 'a')는 처음 번호와 겹치지 않음
{ const p = { onsan: { sales: { '2026-11': [{ _mk: 'os2026-11.0' }, { prod: 'X' }] } } }; M.stamp(p, 'a');
  ok(p.onsan.sales['2026-11'][1]._mk === 'os2026-11.a1', '17 prefix'); }
console.log(`merge.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
