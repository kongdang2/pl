// node tests/검산.test.cjs — 챗봇 숫자 검산(pc/검산.cjs)
const assert = require('assert'), path = require('path');
const K = require('../pc/검산.cjs');
const D = [path.join(__dirname, '검산')];
let n = 0; const t = (name, f) => { f(); n++; console.log('PASS', name); };
t('숫자 읽기', () => {
  assert.strictEqual(K.num('Δ1,357').v, -1357); assert.strictEqual(K.num('(1,234)').v, -1234);
  assert.strictEqual(K.num('12.5%').dp, 1); assert.strictEqual(K.num('abc'), null);
});
t('반올림 같음', () => {
  assert(K.same(K.num('-13.6'), K.num('-13.57'))); assert(!K.same(K.num('1,350'), K.num('1,357'))); assert(K.same(K.num('1,357'), K.num('Δ1,357')));
});
t('본문 숫자: 날짜·버전·번호 빼고', () => {
  const xs = K.bodyNumbers('2025-12 영업이익은 Δ1,357백만원(#393, v317 r2, 12월, `소통\\a_123.txt`), 매출 412,300. 3개 품목').map((x) => x.raw);
  assert.deepStrictEqual(xs, ['Δ1,357', '412,300']);
});
t('근거 일치', () => {
  const text = '<<<근거\nΔ1,357\t001_확정_전사_①재무손익_2025-12.txt\t영업이익\t전사 백만원\n412,300\t001_x.txt\t매출액\t전사\n근거>>>';
  const r = K.check(D, text, '영업이익 Δ1,357, 매출 412,300');
  assert.strictEqual(r.bad.length, 0); assert.strictEqual(r.unbacked.length, 0); assert.strictEqual(r.checked, 2);
  assert(r.wheres[0].includes('①재무손익'));
});
t('틀린 값·열 다름·근거 없음', () => {
  const text = '<<<근거\n1,350\t001_확정_전사_①재무손익_2025-12.txt\t영업이익\t전사\n2,743\t001_확정_전사_①재무손익_2025-12.txt\t영업이익\t온산\n근거>>>';
  const r = K.check(D, text, '영업이익 1,350, 울산 2,743, 온산 Δ4,100');
  assert.deepStrictEqual(r.bad.map((x) => x.raw), ['1,350', '2,743']);
  assert.deepStrictEqual(r.unbacked, ['1,350', '2,743', 'Δ4,100']);
});
t('계산 줄은 통과, 근거 블록 지우기', () => {
  const r = K.check(D, '<<<근거\n-13.6\t계산\t-1,357/100\n근거>>>', '영업손실 약 13.6억원');
  assert.strictEqual(r.bad.length, 0); assert.strictEqual(r.unbacked.length, 0);
  assert.strictEqual(K.stripBasis('답\n<<<근거\n1\t계산\t1\n근거>>>\n끝'), '답\n끝');
});
t('증감 붙은 칸·같은 이름 열 우선', () => {
  assert.strictEqual(K.cellNum('Δ181 ±0').v, -181);
  const text = '<<<근거\nΔ207\t002_요약.txt\t관리 영업이익\t12월\nΔ640\t002\t관리 영업이익\t12월 누계\n근거>>>';
  const r = K.check(D, text, '12월 Δ207억, 누계 Δ640억');
  assert.strictEqual(r.bad.length, 0, JSON.stringify(r.bad)); assert.strictEqual(r.unbacked.length, 0);
});
console.log(n + ' pass');
