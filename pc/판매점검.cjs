// 판매점검 — 판매담당 1차 점검 (hong 2026-11-22 「질문은 총괄, 업무는 담당별로 … 판매담당부터 시험」)
// 웹이 저장 직후 적어 두는 판매 요약(sk_digest, kind='sales', 수 KB)만 읽어, 담당 카드(챗봇\지식\담당_판매.md §4)의 점검 목록으로 본다.
// 문제가 있을 때만 사무실 판매담당 대화(주제 「사무실 · 판매담당」)로 hong 에게 한 번 알린다. 자료 파일은 내려받지 않고, 숫자·자료는 바꾸지 않는다.
// PC 위치: 손익추정시스템\소통\판매점검.cjs  (중계.cjs 가 require 해서 start() 를 부른다. 상태 = 소통\판매점검상태.json)
// 설정(중계설정.json): salesCheck:false 끄기 · salesCheckPollMin 5 · salesPricePct 15 · salesQtyPct 40
'use strict';
const fs = require('fs'), path = require('path');

const SITE = { onsan: '온산', ulsan: '울산' };
const SIDE = { d: '내수', x: '수출' };
const mon = (ym) => String(ym).slice(2, 4) + '.' + (+String(ym).slice(5, 7)) + '월';
const pct = (v) => (v > 0 ? '+' : v < 0 ? 'Δ' : '') + Math.abs(Math.round(v * 100)) + '%';
const num = (v) => Math.round(+v || 0).toLocaleString('ko-KR');
const unit = (a, q) => (q > 0 ? (a * 1000) / q : null); // 백만원·톤 → 천원/톤
const addYm = (ym, k) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + String(m + 1).padStart(2, '0'); };

// 요약의 한 달 → { 'prod|side': {q, a, fm, dr} }
function monthMap(rows, confirmed) {
  const o = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(r)) continue;
    o[r[0] + '|' + r[1]] = confirmed ? { q: +r[2] || 0, a: +r[3] || 0, fm: 0, dr: 0, c: 1 } : { q: +r[2] || 0, a: +r[3] || 0, fm: +r[4] || 0, dr: +r[5] || 0 };
  }
  return o;
}

// 점검. d = 새 요약, dp = 같은 자료의 직전 요약(없으면 null). 반환 [{site, ym, key, kind, text, changed}]
function check(d, dp, opt) {
  opt = opt || {};
  const PP = (opt.pricePct == null ? 15 : +opt.pricePct) / 100, QP = (opt.qtyPct == null ? 40 : +opt.qtyPct) / 100;
  const out = [];
  if (!d || !d.s || !Array.isArray(d.yms)) return out;
  const sd = new Set(d.sd || []);
  for (const site of Object.keys(d.s)) {
    const S = d.s[site] || {}, SP = (dp && dp.s && dp.s[site]) || {};
    for (const ym of d.yms) {
      const cur = monthMap(S[ym]);
      const pym = addYm(ym, -1);
      const base = ym === d.yms[0] ? monthMap(S['c:' + pym], true) : monthMap(S[pym]);
      const old = dp ? monthMap(SP[ym]) : null;
      const napNow = d.px && d.px[ym] ? +d.px[ym][0] : 0, napB = d.px && d.px[pym] ? +d.px[pym][0] : 0;
      const napD = napNow > 0 && napB > 0 ? napNow / napB - 1 : null;
      const keys = new Set(Object.keys(cur).concat(Object.keys(base)));
      for (const key of keys) {
        const [prod, side] = key.split('|'), c = cur[key], b = base[key];
        const name = SITE[site] + ' ' + prod + ' ' + (SIDE[side] || side);
        const o = old ? old[key] : undefined;
        const changed = !dp || !o !== !c || (o && c && (o.q !== c.q || o.a !== c.a || o.fm !== c.fm || o.dr !== c.dr));
        const push = (kind, text) => out.push({ site, ym, key, kind, text: mon(ym) + ' ' + name + ': ' + text, changed });
        const bq = b ? b.q : 0, cq = c ? c.q : 0;
        // 1 빠진 품목 (S/D 달 제외)
        if (bq >= 1 && cq <= 0 && !sd.has(ym)) push('missing', '판매가 없음 (' + (b.c ? '직전 확정월' : mon(pym)) + ' ' + num(bq) + '톤)');
        if (!c) continue;
        // 5 수량 있는데 금액 0
        if (cq > 0 && Math.abs(c.a) < 0.05) push('noamt', '수량 ' + num(cq) + '톤인데 금액 0');
        // 2 판가 급변
        const uc = unit(c.a, cq), ub = b ? unit(b.a, bq) : null;
        if (uc != null && ub != null && ub > 0) {
          const dlt = uc / ub - 1;
          if (Math.abs(dlt) > PP) push('price', '원화 단가 ' + num(ub) + ' → ' + num(uc) + '천원/톤 (' + pct(dlt) + (napD != null ? ', 같은 달 납사 ' + pct(napD) : '') + ')');
        }
        // 3 물량 급변 (S/D 달 제외)
        if (bq > 0 && cq > 0 && !sd.has(ym) && Math.abs(cq / bq - 1) > QP) push('qty', '수량 ' + num(bq) + ' → ' + num(cq) + '톤 (' + pct(cq / bq - 1) + ')');
        // 4 포뮬러 행이 직접 단가로 바뀜 (같은 자료 직전 저장과 비교)
        if (o && o.fm > 0 && c.fm === 0 && c.dr > 0) push('formula', '포뮬러 단가였는데 직접 단가로 바뀜');
      }
    }
  }
  return out;
}

// 알림 본문. 같은 자료를 다시 저장했으면 이번 저장에서 바뀐 줄의 문제만 알린다
function message(memo, by, issues, first) {
  const list = first ? issues : issues.filter((x) => x.changed);
  if (!list.length) return null;
  const order = { missing: 0, noamt: 1, price: 2, formula: 3, qty: 4 };
  list.sort((p, q) => order[p.kind] - order[q.kind] || (p.ym < q.ym ? -1 : p.ym > q.ym ? 1 : 0));
  const head = '「' + memo + '」 판매 자료에서 확인할 곳 ' + list.length + '건을 찾았습니다' + (by ? ' (' + by + ' 저장)' : '') + '.';
  const lines = list.slice(0, 12).map((x) => '- ' + x.text);
  if (list.length > 12) lines.push('- 외 ' + (list.length - 12) + '건');
  return head + '\n\n' + lines.join('\n') + '\n\n판매담당 자동 1차 점검입니다(담당 카드 §4 기준). 자료는 바꾸지 않았습니다. 궁금한 줄은 이 대화에서 판매담당에게 물어보세요.';
}

function start(env) {
  const { api, post, log, conf, dir } = env;
  if (conf.salesCheck === false) { log('판매점검 꺼짐(중계설정 salesCheck:false)'); return; }
  const FILE = path.join(dir, '판매점검상태.json');
  const pollMs = Math.max(1, +conf.salesCheckPollMin || 5) * 60000;
  let st = { last: '', prev: {} };
  try { st = Object.assign(st, JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''))); } catch (_) { /* 처음 */ }
  const save = () => {
    const ids = Object.keys(st.prev); // 자료 40개까지만 기억
    if (ids.length > 40) ids.sort((a, b) => String(st.prev[a].at).localeCompare(String(st.prev[b].at))).slice(0, ids.length - 40).forEach((k) => delete st.prev[k]);
    try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch (e) { log('판매점검 상태 저장 오류', e.message); }
  };
  let busy = false, off = false;
  async function step() {
    if (busy || off) return; busy = true;
    try {
      if (!st.last) { st.last = new Date().toISOString(); save(); log('판매점검 시작'); return; } // 처음: 지금부터 오는 저장만 본다
      const news = await api('GET', 'sk_digest', '?select=snapshot_id,at&kind=eq.sales&at=gt.' + encodeURIComponent(st.last) + '&order=at.asc&limit=20');
      for (const n of news) {
        st.last = n.at;
        const [row] = await api('GET', 'sk_digest', '?select=digest&kind=eq.sales&snapshot_id=eq.' + n.snapshot_id);
        const [snap] = await api('GET', 'sk_snapshots', '?select=memo,last_saved_name&id=eq.' + n.snapshot_id);
        if (!row || !snap) continue;
        const d = row.digest, p = st.prev[n.snapshot_id];
        const body = message(snap.memo, snap.last_saved_name || '', check(d, p ? p.d : null, { pricePct: conf.salesPricePct, qtyPct: conf.salesQtyPct }), !p);
        if (body) { await post({ sender: 'Claude', recipient: 'hong', topic: '사무실 · 판매담당', status: '안내', body }); log('판매점검 알림', snap.memo); }
        st.prev[n.snapshot_id] = { at: n.at, d };
      }
      save();
    } catch (e) {
      if (/sk_digest|42P01|does not exist|404/.test(e.message)) { off = true; log('판매점검: sk_digest 표가 없어 쉼(028 적용 전)'); } else log('판매점검 오류', e.message);
    } finally { busy = false; }
  }
  step();
  setInterval(step, pollMs);
}

module.exports = { start, check, message };
