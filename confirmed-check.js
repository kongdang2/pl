// 손익추정 웹 — 확정 자료가 바뀌었는지 저장 전에 확인(hong 11-27 「확정이 바뀌는 경우 저장 전에 확인 요청을 띄우도록 하자」)
// 확정 자료(엔진 CONFIRMED_DB = 저장본의 confirmed)는 한 번 넣으면 잘 바꾸지 않는다. 그래서 연 뒤(또는 마지막 저장 뒤) 확정 자료가
// 달라졌으면 저장 직전에 바뀐 칸을 보여 주고 묻는다. 여기서는 비교와 요약만 한다(창 띄우기·저장은 app.js). 엔진 계산은 건드리지 않는다.
//  구조: confirmed[사이트][자료 종류][연-월]…  예) ulsan / confirmedSales / 2026-01 / HDPE / dom / qty
//  빈 값(없음·null·''·0·빈 묶음)끼리는 같은 것으로 본다(엔진이 화면을 그리며 빈 자리를 만드는 것은 변경이 아님).
(function (root) {
  'use strict';
  const isObj = (v) => v !== null && typeof v === 'object';
  function blank(v) {
    if (v === undefined || v === null || v === '' || v === 0) return true;
    if (!isObj(v)) return false;
    for (const k of Object.keys(v)) if (!blank(v[k])) return false;
    return true;
  }
  function same(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); // 계산 오차는 변경이 아님
    return false;
  }
  function leaves(v) { // 빈 값이 아닌 끝 칸 수
    if (blank(v)) return 0;
    if (!isObj(v)) return 1;
    let n = 0; for (const k of Object.keys(v)) n += leaves(v[k]);
    return n;
  }
  function walk(a, b, path, out) {
    if (blank(a) && blank(b)) return;
    const oa = isObj(a), ob = isObj(b);
    if ((oa || blank(a)) && (ob || blank(b))) {
      const keys = new Set([...(oa ? Object.keys(a) : []), ...(ob ? Object.keys(b) : [])]);
      for (const k of keys) walk(oa ? a[k] : undefined, ob ? b[k] : undefined, path.concat(k), out);
      return;
    }
    if (!oa && !ob && same(a, b)) return;
    out.push({ path, before: a, after: b }); // 값 ↔ 값, 또는 값 ↔ 묶음(모양이 바뀜)
  }
  // 바뀐 끝 칸 목록 [{path:[…], before, after}]
  function diff(base, mine) { const out = []; walk(base, mine, [], out); return out; }

  const YM = /^(19|20)\d{2}-\d{2}$/;
  const SITE = { onsan: '온산', ulsan: '울산', head: '전사' };
  const STORE = {
    confirmedSales: '확정 판매', confirmedPurchase: '확정 구매', confirmedPrice: '확정 가격', confirmedFlow: '확정 제품수불', confirmedMatflow: '확정 원료수불',
    confirmedProdFlow: '확정 생산입출고', confirmedMfg: '확정 제조원가', confirmedAlloc: '확정 원가배부', confirmedAllocRealProd: '확정 원가배부(실생산)',
    confirmedEogUtil: '확정 EOG 유틸리티', confirmedNapPdf: '확정 납사 구매(PDF)', confirmedUlsanProd: '확정 생산', confirmedUlsanMfg: '확정 제조원가',
    confirmedUlsanMat: '확정 원료수불', confirmedUlsanProdFlow: '확정 제품수불', confirmedUlsanMatItem: '확정 원료 항목', confirmedFinPnl: '확정 재무손익',
    confirmedCost: '확정 판관비', confirmedMgmt: '확정 관리손익 설정', confirmedInventoryValuation: '확정 재고평가', confirmedInventoryValuationBySegment: '확정 재고평가(부문)',
  };
  const FIELD = { qty: '수량', amt: '금액', unitKrw: '원화단가', unitUsd: '외화단가', dom: '내수', exp: '수출', imp: '수입', price: '단가', custs: '거래처', fx: '환율', end: '기말', endAmt: '기말금액', begin: '기초', beginAmt: '기초금액' };
  const storeName = (k) => STORE[k] || String(k).replace(/^confirmed/, '확정 ');
  const seg = (s, i) => (i === 0 && SITE[s]) || (i === 1 && storeName(s)) || FIELD[s] || String(s);
  function label(path) { return path.map(seg).join(' · ') || '(전체)'; }
  function show(v) {
    if (v === undefined) return '(없음)';
    if (v === null || v === '') return '(빈칸)';
    if (typeof v === 'number') return v.toLocaleString('ko-KR', { maximumFractionDigits: 8 });
    if (typeof v === 'object') return '(묶음 ' + leaves(v) + '칸)';
    const s = String(v); return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }
  const at = (o, p) => { let c = o; for (const k of p) { if (!isObj(c)) return undefined; c = c[k]; } return c; };

  // 사람이 볼 요약. 바뀐 게 없으면 null.
  //  rows    = 기존 값이 바뀐 곳(같은 묶음의 칸끼리 한 줄: 수량·단가·금액 …)  [{path, fields:[{name, before, after}]}]
  //  removed = 통째로 없어진 달                                                [{path:[사이트,종류,연-월], n}]
  //  added   = 새로 들어온 달(월 마감 업로드 등)                               [{ym, n, where:['온산 확정 판매', …]}]
  function check(base, mine) {
    const ch = diff(base, mine);
    if (!ch.length) return null;
    const rows = new Map(), removed = new Map(), added = new Map();
    for (const c of ch) {
      const p = c.path, hasYm = p.length >= 3 && YM.test(p[2]);
      if (hasYm) {
        const mp = p.slice(0, 3), key = mp.join('\u0001');
        if (blank(at(base, mp))) { // 그 달 자료가 전에는 없었다 = 새로 들어온 달
          const a = added.get(p[2]) || { ym: p[2], n: 0, where: [] }, w = seg(p[0], 0) + ' ' + seg(p[1], 1);
          a.n++; if (a.where.indexOf(w) < 0) a.where.push(w); added.set(p[2], a); continue;
        }
        if (blank(at(mine, mp))) { const r = removed.get(key) || { path: mp, n: 0 }; r.n++; removed.set(key, r); continue; }
      }
      const cell = p.length > 1 ? p.slice(0, -1) : p, key = cell.join('\u0001');
      const r = rows.get(key) || { path: cell, fields: [] };
      r.fields.push({ name: p.length > 1 ? seg(p[p.length - 1], p.length - 1) : '', before: c.before, after: c.after });
      rows.set(key, r);
    }
    const out = { total: ch.length, rows: [...rows.values()], removed: [...removed.values()], added: [...added.values()].sort((x, y) => (x.ym < y.ym ? -1 : 1)) };
    const first = out.rows[0] ? label(out.rows[0].path) : out.removed[0] ? label(out.removed[0].path) + ' 없어짐' : out.added[0] ? out.added[0].ym + ' 새로 들어옴' : '';
    const places = out.rows.length + out.removed.length + out.added.length;
    out.note = '확정 ' + out.total + '칸' + (out.rows.length ? ' · 바뀜 ' + out.rows.length + '곳' : '') + (out.removed.length ? ' · 없어진 달 ' + out.removed.length : '') + (out.added.length ? ' · 새 달 ' + out.added.length : '')
      + (first ? ' (' + first + (places > 1 ? ' 외' : '') + ')' : '');
    return out;
  }
  const fieldsText = (fs, which) => fs.map((f) => (f.name ? f.name + ' ' : '') + show(f[which])).join(' · ');

  const api = { diff, check, label, show, blank, fieldsText };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SonikConfCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
