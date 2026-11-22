// 아침 브리핑 (hong 2026-11-22 「챗봇 전문 에이전트화」 자율 2단계: 알림만)
// 하루 한 번, 지난 브리핑 뒤에 생긴 일을 모아 소통에 hong 앞 「안내」 글 하나로 올린다:
//   ① 저장된 자료와 손익 변화(목록 개요 기준) ② 열려 있는 수정요청 ③ hong 답을 기다리는 소통 글·실패한 실행 ④ 운영본 ⑤ hong 이 정할 것(챗봇\지식\hong전용\대기목록.md)
// 새 소식이 하나도 없으면 올리지 않는다(briefAlways:true 면 항상). 자료 파일은 내려받지 않는다.
// PC 위치: 손익추정시스템\소통\브리핑.cjs (중계.cjs 가 start() 를 부른다. 상태 = 소통\브리핑상태.json)
// 설정(중계설정.json): brief:false 끄기 · briefAt "08:10"(PC 시각, 이 시각 뒤 그날 처음 중계가 켜져 있을 때 한 번) · briefAlways false
'use strict';
const fs = require('fs'), path = require('path');
const { pick } = require('./살피기.cjs');

const eok = (v) => (v == null ? '—' : (v < 0 ? 'Δ' : '') + Math.abs(v).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const sgn = (d) => (d > 0 ? '+' : d < 0 ? 'Δ' : '') + Math.abs(d).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const day = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

// 운영본: 폴더 루트의 손익추정_…_vNNN_날짜.html 중 가장 큰 번호
function opVersion(root) {
  let best = null;
  try { for (const f of fs.readdirSync(root)) { const m = /^손익추정_.*_v(\d{3,})_(\d{8})\.html$/.test(f) && f.match(/_v(\d{3,})_(\d{8})\.html$/); if (m && (!best || +m[1] > best.v)) best = { v: +m[1], d: m[2] }; } } catch (_) { /* 없음 */ }
  return best;
}
// 대기목록 카드: 「## 제목」 아래 「- 」 줄 수와 앞의 몇 개
function waitList(root) {
  const out = [];
  let t = '';
  try { t = fs.readFileSync(path.join(root, '챗봇', '지식', 'hong전용', '대기목록.md'), 'utf8'); } catch (_) { return out; }
  let cur = null;
  for (const ln of t.split(/\r?\n/)) {
    const h = ln.match(/^##\s+(.+)/);
    if (h) { cur = { title: h[1].trim(), items: [] }; out.push(cur); continue; }
    const b = ln.match(/^-\s+(.+)/);
    if (b && cur) cur.items.push(b[1].trim());
  }
  return out.filter((s) => s.items.length);
}

// 글 본문을 만든다. d = { snaps[], prev{}, reqs[], waits[], fails, op, wl[], since } → { body, news }
function compose(d) {
  const L = [];
  let news = 0;
  // ① 저장된 자료
  if (d.snaps.length) {
    news += d.snaps.length;
    L.push('**저장된 자료 ' + d.snaps.length + '개**');
    for (const r of d.snaps.slice(0, 8)) {
      const b = pick(r.summary), a = pick((d.prev[r.id] || {}).summary);
      let s = '- 「' + r.memo + '」 (' + (r.last_saved_name || '?') + ', 저장본 ' + r.rev + ')';
      if (b && b.fin != null) {
        s += ': ' + b.label + ' 재무 ' + eok(b.fin) + ' / 관리 ' + eok(b.mg);
        if (a && a.fin != null && (a.fin !== b.fin || a.mg !== b.mg)) s += ', 지난 브리핑 대비 재무 ' + sgn(Math.round((b.fin - a.fin) * 10) / 10) + ', 관리 ' + sgn(Math.round(((b.mg || 0) - (a.mg || 0)) * 10) / 10);
        else if (!a) s += ', 새 자료';
      } else s += ': 개요 없음(열어서 다시 저장하면 채워집니다)';
      L.push(s);
    }
    if (d.snaps.length > 8) L.push('- 외 ' + (d.snaps.length - 8) + '개');
    L.push('');
  }
  // ② 수정요청
  if (d.reqs.length) {
    news += d.reqs.length;
    L.push('**열려 있는 수정요청 ' + d.reqs.length + '건**');
    for (const r of d.reqs.slice(0, 6)) L.push('- #' + r.id + ' ' + cut(r.title, 40) + ' (' + r.status + (r.author_name ? ', ' + r.author_name : '') + ')');
    if (d.reqs.length > 6) L.push('- 외 ' + (d.reqs.length - 6) + '건');
    L.push('');
  }
  // ③ 소통
  if (d.waits.length || d.fails) {
    news += d.waits.length + d.fails;
    L.push('**소통**');
    if (d.waits.length) L.push('- hong 답을 기다리는 글 ' + d.waits.length + '개: ' + d.waits.slice(0, 5).map((m) => '#' + m.id + ' ' + cut(m.topic || m.body, 24) + '(' + m.sender + ')').join(', '));
    if (d.fails) L.push('- 지난 브리핑 뒤 실패한 실행 ' + d.fails + '건(소통에서 다시 요청해야 합니다)');
    L.push('');
  }
  // ④·⑤ 늘 붙는 참고(새 소식 수에는 넣지 않는다)
  const tail = [];
  if (d.op) tail.push('- 운영본 v' + d.op.v + ' (' + d.op.d.slice(4, 6) + '-' + d.op.d.slice(6, 8) + ')');
  for (const s of d.wl) tail.push('- ' + s.title + ' ' + s.items.length + '건' + (/(결정|판단)/.test(s.title) ? ': ' + s.items.slice(0, 2).map((x) => cut(x, 34)).join(' / ') + (s.items.length > 2 ? ' 등' : '') : ''));
  if (tail.length) { L.push('**참고**'); L.push(...tail); L.push(''); }
  const head = news ? '아침 브리핑입니다. ' + d.since + ' 이후 새 소식을 모았습니다.' : '아침 브리핑입니다. ' + d.since + ' 이후 새로 저장된 자료·요청·대기 글이 없습니다.';
  return { news, body: head + '\n\n' + L.join('\n').trim() + '\n\n자동으로 모은 글입니다. 손익 숫자는 목록 「개요」 기준(억원)입니다.' };
}

function start(env) {
  const { api, post, log, conf, dir, root } = env;
  if (conf.brief === false) { log('브리핑 꺼짐(중계설정 brief:false)'); return; }
  const FILE = path.join(dir, '브리핑상태.json');
  const at = /^(\d{1,2}):(\d{2})$/.exec(conf.briefAt || '08:10') || [0, 8, 10];
  let st = { day: '', last: '', snaps: {} };
  try { st = Object.assign(st, JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''))); } catch (_) { /* 처음 */ }
  let busy = false;
  async function step(force) {
    const now = new Date();
    if (busy || (!force && (st.day === day(now) || now.getHours() * 60 + now.getMinutes() < +at[1] * 60 + +at[2]))) return;
    busy = true;
    try {
      const since = st.last || new Date(now.getTime() - 86400000).toISOString();
      const enc = encodeURIComponent(since);
      const snaps = await api('GET', 'sk_snapshots', '?select=id,memo,mode,rev,updated_at,last_saved_name,summary&updated_at=gt.' + enc + '&order=updated_at.desc&limit=30');
      const reqs = await api('GET', 'sk_requests', '?select=id,title,status,author_name,updated_at&status=not.in.(' + ['완료', '취소', '반려'].map(encodeURIComponent).join(',') + ')&order=id.asc&limit=30');
      const waits = await api('GET', 'sk_channel', '?select=id,sender,topic,body,at&recipient=eq.hong&status=eq.' + encodeURIComponent('대기') + '&order=id.desc&limit=20');
      const fails = await api('GET', 'sk_channel', '?select=id&run_state=eq.' + encodeURIComponent('실패') + '&updated_at=gt.' + enc + '&limit=50');
      const d0 = new Date(since);
      const d = { snaps, prev: st.snaps, reqs, waits: waits.map((m) => ({ id: m.id, sender: m.sender, topic: m.topic, body: cut(m.body, 40) })), fails: fails.length, op: opVersion(root), wl: waitList(root),
        since: (d0.getMonth() + 1) + '월 ' + d0.getDate() + '일 ' + String(d0.getHours()).padStart(2, '0') + ':' + String(d0.getMinutes()).padStart(2, '0') };
      const r = compose(d);
      if (r.news || conf.briefAlways) { await post({ sender: 'Claude', recipient: 'hong', topic: '아침 브리핑', status: '안내', body: r.body }); log('브리핑 올림: 새 소식', r.news); }
      else log('브리핑: 새 소식 없음 → 올리지 않음');
      for (const s of snaps) if (s.summary) st.snaps[s.id] = { summary: s.summary };
      st.day = day(now); st.last = now.toISOString();
      fs.writeFileSync(FILE, JSON.stringify(st));
    } catch (e) { log('브리핑 오류', e.message); } finally { busy = false; }
  }
  step(); setInterval(step, 300000);
  return { step };
}

module.exports = { start, compose, opVersion, waitList };
