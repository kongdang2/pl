// 손익추정 웹 — 같은 추정자료를 여러 창·여러 사람이 고쳤을 때 저장 단계에서 합치기(hong 11/04)
// 3방향 비교: 기준본(내가 연 판) · 내 판(지금 화면) · 상대 판(그사이 저장된 최신본). 엔진 계산은 건드리지 않는다.
// 규칙: 한쪽만 바꾼 칸 = 그 값, 둘 다 같은 값 = 그 값, 둘 다 다른 값 = 묻기(기본 내 값).
//       판매·구매 행은 숨은 번호(_mk)로 같은 행을 찾는다(엔진이 품목순으로 다시 정렬하므로 순서로는 못 찾음).
//       같은 행의 다른 칸을 둘 다 고침 = 자동 합침 + 「확인 필요」. 행 삭제 vs 수정 = 묻기.
(function (root) {
  'use strict';
  const MK = '_mk';
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

  function eq(a, b) {
    if (a === b) return true;
    if (a === undefined || b === undefined || a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'number') return Number.isNaN(a) && Number.isNaN(b);
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!has(b, k) || !eq(a[k], b[k])) return false;
    return true;
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const keyOf = (r) => (isObj(r) ? (r[MK] != null ? 'm:' + r[MK] : (r.id != null ? 'i:' + r.id : null)) : null);
  // 행 배열 = 객체만 있고, 셋 중 어느 쪽이든 번호(_mk/id) 달린 행이 있는 배열
  function isRowArr(...arrs) {
    let any = false;
    for (const a of arrs) {
      if (a === undefined) continue;
      if (!Array.isArray(a) || !a.every(isObj)) return false;
      if (a.some((r) => keyOf(r) != null)) any = true;
    }
    return any;
  }
  const noMk = (r) => { const o = Object.assign({}, r); delete o[MK]; return o; };

  // ctx: {choice: Map(path → 'm'|'t'), conflicts: [], warns: []}
  function m3(b, m, t, path, ctx) {
    if (eq(m, t)) return clone(m);
    if (eq(b, m)) return clone(t);
    if (eq(b, t)) return clone(m);
    if (isObj(m) && isObj(t) && (b === undefined || isObj(b))) {
      const bb = b || {}, out = {};
      const keys = new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(bb)]);
      for (const k of keys) {
        const v = m3(bb[k], m[k], t[k], path.concat(k), ctx);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (isRowArr(b, m, t) && Array.isArray(m) && Array.isArray(t) && (b === undefined || Array.isArray(b))) return rows3(b || [], m, t, path, ctx);
    const u = appendUnion(b, m, t);
    if (u) return u;
    return pick(b, m, t, path, ctx, 'cell');
  }
  // 번호 없는 목록(수정이력 등)을 양쪽이 뒤에 덧붙이기만 했으면 둘 다 붙인다(기준본 + 내 것 + 상대 것, 같은 항목은 하나)
  function appendUnion(b, m, t) {
    if (!Array.isArray(b) || !Array.isArray(m) || !Array.isArray(t)) return null;
    if (m.length < b.length || t.length < b.length) return null;
    for (let i = 0; i < b.length; i++) if (!eq(b[i], m[i]) || !eq(b[i], t[i])) return null;
    const out = clone(m);
    for (const x of t.slice(b.length)) if (!out.slice(b.length).some((y) => eq(x, y))) out.push(clone(x));
    return out;
  }
  function pick(b, m, t, path, ctx, kind, extra) {
    const p = path.join('\u0001');
    const c = Object.assign({ path: path.slice(), key: p, kind, base: clone(b), mine: clone(m), theirs: clone(t) }, extra || {});
    ctx.conflicts.push(c);
    return clone(ctx.choice.get(p) === 't' ? t : m);
  }
  function rows3(b, m, t, path, ctx) {
    const map = (a) => { const r = new Map(); a.forEach((x) => { const k = keyOf(x); if (k != null && !r.has(k)) r.set(k, x); }); return r; };
    const B = map(b), M = map(m), T = map(t);
    const out = [];
    const tAdded = t.filter((x) => { const k = keyOf(x); return k == null || !B.has(k); });
    const mAdded = new Set(m.filter((x) => { const k = keyOf(x); return k == null || !B.has(k); }));
    for (const x of m) {
      const k = keyOf(x);
      if (mAdded.has(x)) { out.push(clone(x)); continue; }
      const bx = B.get(k), tx = T.get(k);
      if (tx === undefined) { // 상대가 지움
        if (eq(bx, x)) continue; // 나는 안 건드림 → 지움
        const v = pick(bx, x, undefined, path.concat('#' + k), ctx, 'row', { row: x });
        if (v !== undefined) out.push(v);
        continue;
      }
      const mc = !eq(bx, x), tc = !eq(bx, tx);
      const before = ctx.conflicts.length;
      const v = m3(bx, x, tx, path.concat('#' + k), ctx);
      if (mc && tc && !eq(x, tx) && ctx.conflicts.length === before) ctx.warns.push({ path: path.concat('#' + k), row: v, kind: 'row' });
      out.push(v);
    }
    for (const [k, bx] of B) { // 내가 지운 행
      if (M.has(k)) continue;
      const tx = T.get(k);
      if (tx === undefined || eq(bx, tx)) continue; // 둘 다 지움 / 상대 안 건드림 → 지움
      const v = pick(bx, undefined, tx, path.concat('#' + k), ctx, 'row', { row: tx });
      if (v !== undefined) out.push(v);
    }
    // 상대가 더한 행(같은 내용을 나도 더했으면 하나만)
    const mine = [...mAdded].map(noMk);
    let both = false;
    for (const x of tAdded) {
      const i = mine.findIndex((y) => eq(y, noMk(x)));
      if (i >= 0) { mine.splice(i, 1); continue; }
      out.push(clone(x)); both = both || mAdded.size > 0;
    }
    if (both) ctx.warns.push({ path: path.slice(), kind: 'added' });
    return out;
  }

  // 합치기. choice: {key: 'm'|'t'} (첫 판은 비워 두고 conflicts 를 받아 사용자에게 묻는다)
  function merge(base, mine, theirs, choice) {
    const ctx = { choice: new Map(Object.entries(choice || {})), conflicts: [], warns: [] };
    const result = m3(base, mine, theirs, [], ctx);
    let mineN = 0, theirsN = 0;
    countChanges(base, mine, (n) => { mineN = n; }); countChanges(base, theirs, (n) => { theirsN = n; });
    return { result, conflicts: ctx.conflicts, warns: ctx.warns, stats: { mine: mineN, theirs: theirsN } };
  }
  // 바뀐 칸 수(안내용)
  function countChanges(a, b, done) {
    let n = 0;
    (function walk(x, y) {
      if (eq(x, y)) return;
      if (isObj(x) && isObj(y)) { new Set([...Object.keys(x), ...Object.keys(y)]).forEach((k) => walk(x[k], y[k])); return; }
      if (Array.isArray(x) && Array.isArray(y) && isRowArr(x, y)) {
        const X = new Map(x.map((r) => [keyOf(r), r])), Y = new Map(y.map((r) => [keyOf(r), r]));
        new Set([...X.keys(), ...Y.keys()]).forEach((k) => walk(X.get(k), Y.get(k)));
        return;
      }
      n++;
    })(a, b);
    done(n);
  }

  // 판매·구매 행에 숨은 번호 달기. det=true 면 「사이트|종류|월|순번」(같은 판을 연 사람끼리 같은 번호), 아니면 새 번호.
  // det 가 문자열이면 순번 앞에 붙인다(열고 난 뒤 엔진이 저절로 만든 행: 'a' → os2026-11.a3, 연 사람끼리 같고 처음 번호와 겹치지 않음)
  const ROW_PATHS = [['onsan', 'sales'], ['onsan', 'purchase'], ['ulsan', 'sales'], ['ulsan', 'purchase']];
  function stamp(payload, det) {
    let n = 0;
    if (!isObj(payload)) return 0;
    for (const [site, kind] of ROW_PATHS) {
      const o = payload[site] && payload[site][kind];
      if (!isObj(o)) continue;
      for (const ym of Object.keys(o)) {
        if (!Array.isArray(o[ym])) continue;
        o[ym].forEach((r, i) => {
          if (!isObj(r) || r[MK] != null) return;
          r[MK] = det ? site[0] + kind[0] + ym + '.' + (typeof det === 'string' ? det : '') + i : 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          n++;
        });
      }
    }
    return n;
  }
  function unstamped(payload) {
    let n = 0;
    for (const [site, kind] of ROW_PATHS) {
      const o = payload && payload[site] && payload[site][kind];
      if (!isObj(o)) continue;
      for (const ym of Object.keys(o)) (Array.isArray(o[ym]) ? o[ym] : []).forEach((r) => { if (isObj(r) && r[MK] == null) n++; });
    }
    return n;
  }

  // 사람이 읽는 위치 이름
  const SITE = { onsan: '온산', ulsan: '울산', head: '전사' };
  const PART = { payload: '', confirmed: '확정 실적', plan: '사업계획 DB', sales: '판매', purchase: '구매', prices: '기준가격', costData: '비용', rows: '', months: '' };
  const FIELD = { qty: '수량', usdDirect: '외화단가', krwDirect: '원화단가', amt: '금액', note: '비고', prod: '품목', customer: '거래처', salesType: '내수/수출', purType: '구분', fx: '환율', unitUsd: '외화단가', unitKrw: '원화단가' };
  function rowName(r) {
    if (!isObj(r)) return '행';
    const a = [r.prod || r.account || r.item, r.salesType || r.purType || r.dept, r.customer].filter(Boolean);
    return a.length ? a.join(' ') : '행';
  }
  function label(c) {
    const out = [];
    for (const s of c.path) {
      if (s[0] === '#') { out.push(rowName(c.row || c.mine || c.theirs)); continue; }
      if (SITE[s]) { out.push(SITE[s]); continue; }
      if (s in PART) { if (PART[s]) out.push(PART[s]); continue; }
      out.push(FIELD[s] || s);
    }
    return out.join(' · ') || '(전체)';
  }
  function show(v) {
    if (v === undefined) return '(없음·삭제)';
    if (v === null) return '(빈칸)';
    if (typeof v === 'number') return v.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
    if (typeof v === 'object') return Array.isArray(v) ? '(목록 ' + v.length + '개)' : '(' + rowName(v) + ')';
    const s = String(v); return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }

  const api = { merge, stamp, unstamped, eq, label, show, rowName, MK };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SonikMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
