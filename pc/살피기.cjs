// 살피기 — 저장 후 변동 점검 (hong 2026-11-22 「챗봇 전문 에이전트화」 자율 2단계: 알림만, 숫자·자료는 바꾸지 않는다)
// 웹에 자료가 저장되면 목록 「개요」(sk_snapshots.summary: 재무·관리·월별 추이·납사·상업수율)를 직전에 본 값과 비교해,
// 크게 바뀌었을 때만 소통에 hong 앞 「안내」 글을 한 줄 올린다. 자료 파일은 내려받지 않는다(전송량: 5분마다 수백 바이트).
// PC 위치: 손익추정시스템\소통\살피기.cjs  (중계.cjs 가 require 해서 start() 를 부른다. 상태 = 소통\살피기상태.json)
// 설정(중계설정.json): watch:false 끄기 · watchPollMin 5 · watchQuietMin 10(이 시간 동안 추가 저장이 없을 때 한 번만 알림) · watchMinEok 10(연간·누계 변동 기준, 억) · watchMonthEok 10(월 변동 기준, 억)
'use strict';
const fs = require('fs'), path = require('path');

const n1 = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
// 억원 표시: 음수는 Δ, 소수 1자리
const eok = (v) => (v == null ? '—' : (v < 0 ? 'Δ' : '') + Math.abs(v).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const sgn = (d) => (d > 0 ? '+' : d < 0 ? 'Δ' : '') + Math.abs(d).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mon = (ym) => String(ym).slice(2, 4) + '.' + (+String(ym).slice(5, 7)) + '월';

// 개요에서 비교할 값만 꺼낸다. 사업계획: fin·mg(연간)·sp(월별)·nap0/nap1·cy·fx. 손익추정: cum(누계)·m(추정월)·sp
function pick(s) {
  if (!s || typeof s !== 'object') return null;
  const est = s.kind === 'est' || (!!s.cum && s.fin === undefined);
  const tot = est ? (s.cum || {}) : s;
  const months = {};
  for (const r of Array.isArray(s.sp) ? s.sp : []) if (Array.isArray(r) && r[0]) months[r[0]] = { fin: n1(r[1]), mg: n1(r[2]) };
  for (const r of Array.isArray(s.m) ? s.m : []) if (r && r.ym) months[r.ym] = { fin: n1(r.fin), mg: n1(r.mg), nap: n1(r.nap) };
  return { est, fin: n1(tot.fin), mg: n1(tot.mg), label: est ? '누계' : '연간', months, nap0: n1(s.nap0), nap1: n1(s.nap1), cy: n1(s.cy), fx: n1(s.fx), ver: s.ver || '', at: s.at || '' };
}

// 직전 개요(prev)와 새 개요(cur)를 비교한다. { notable, lines[] } — notable 이 false 면 알리지 않는다
function diffSummary(prevS, curS, opt) {
  opt = opt || {};
  const minT = opt.minEok == null ? 10 : opt.minEok, minM = opt.monthEok == null ? 10 : opt.monthEok;
  const a = pick(prevS), b = pick(curS);
  if (!a || !b) return { notable: false, lines: [] };
  const lines = [];
  let notable = false;
  const tot = [];
  for (const [k, name] of [['fin', '재무'], ['mg', '관리']]) {
    if (a[k] == null || b[k] == null) continue;
    const d = Math.round((b[k] - a[k]) * 10) / 10;
    if (Math.abs(d) >= minT) notable = true;
    if (d !== 0) tot.push(name + ' ' + eok(a[k]) + ' → ' + eok(b[k]) + ' (' + sgn(d) + ')');
  }
  if (tot.length) lines.push('- **' + b.label + ' 영업이익(억)**: ' + tot.join(', '));
  // 월별: 재무·관리 중 변동이 큰 달 위에서 4개
  const mv = [];
  for (const ym of Object.keys(b.months)) {
    const x = a.months[ym], y = b.months[ym];
    if (!x) continue;
    const df = x.fin != null && y.fin != null ? Math.round((y.fin - x.fin) * 10) / 10 : 0;
    const dm = x.mg != null && y.mg != null ? Math.round((y.mg - x.mg) * 10) / 10 : 0;
    if (Math.abs(df) >= minM || Math.abs(dm) >= minM) mv.push({ ym, df, dm, w: Math.max(Math.abs(df), Math.abs(dm)) });
  }
  if (mv.length) {
    notable = true;
    mv.sort((p, q) => q.w - p.w);
    lines.push('- **크게 바뀐 달**: ' + mv.slice(0, 4).map((r) => mon(r.ym) + ' 재무 ' + sgn(r.df) + '·관리 ' + sgn(r.dm)).join(', ') + (mv.length > 4 ? ' 외 ' + (mv.length - 4) + '개 달' : ''));
  }
  // 전제: 납사·상업수율·환율
  const pre = [];
  if (!b.est && (a.nap0 !== b.nap0 || a.nap1 !== b.nap1) && b.nap0 != null) pre.push('납사 ' + a.nap0 + '~' + a.nap1 + ' → ' + b.nap0 + '~' + b.nap1 + '$');
  if (b.est) for (const ym of Object.keys(b.months)) { const x = a.months[ym], y = b.months[ym]; if (x && x.nap != null && y.nap != null && x.nap !== y.nap) pre.push(mon(ym) + ' 납사 ' + x.nap + ' → ' + y.nap + '$'); }
  if (a.cy != null && b.cy != null && Math.abs(b.cy - a.cy) >= 0.05) { pre.push('상업수율 ' + a.cy + ' → ' + b.cy + '%'); if (Math.abs(b.cy - a.cy) >= 0.3) notable = true; }
  if (a.fx != null && b.fx != null && a.fx !== b.fx) { pre.push('환율 ' + a.fx + ' → ' + b.fx); notable = true; }
  if (pre.length) lines.push('- **바뀐 전제**: ' + pre.join(', '));
  if (a.ver && b.ver && a.ver !== b.ver) lines.push('- 엔진이 ' + a.ver + ' → ' + b.ver + ' 로 바뀐 뒤 저장이라, 일부는 엔진 차이일 수 있습니다.');
  // 눈에 띄는 값(새 개요 자체)
  const odd = [];
  if (b.cy != null && (b.cy < 70 || b.cy > 85)) odd.push('상업수율 ' + b.cy + '% (보통 70~85%)');
  for (const ym of Object.keys(b.months)) { const y = b.months[ym]; if (y.fin === 0 && y.mg === 0) odd.push(mon(ym) + ' 재무·관리 모두 0'); }
  if (odd.length) { notable = true; lines.push('- **확인할 값**: ' + odd.slice(0, 4).join(', ')); }
  return { notable, lines };
}

function start(env) {
  const { api, post, log, conf, dir } = env;
  if (conf.watch === false) { log('살피기 꺼짐(중계설정 watch:false)'); return; }
  const FILE = path.join(dir, '살피기상태.json');
  const pollMs = Math.max(1, +conf.watchPollMin || 5) * 60000, quietMs = Math.max(0, conf.watchQuietMin == null ? 10 : +conf.watchQuietMin) * 60000;
  let st = { last: '', snaps: {}, pending: {} };
  try { st = Object.assign(st, JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''))); } catch (_) { /* 처음 */ }
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch (e) { log('살피기 상태 저장 오류', e.message); } };
  let busy = false;
  async function step() {
    if (busy) return; busy = true;
    try {
      if (!st.last) { // 처음: 지금 목록의 개요를 기준으로 삼는다(알림 없음)
        const all = await api('GET', 'sk_snapshots', '?select=id,memo,rev,updated_at,summary&order=updated_at.desc&limit=80');
        for (const r of all) st.snaps[r.id] = { rev: r.rev, memo: r.memo, summary: r.summary || null };
        st.last = all.length ? all[0].updated_at : new Date().toISOString();
        save(); log('살피기 시작: 기준 자료', all.length, '개'); return;
      }
      const news = await api('GET', 'sk_snapshots', '?select=id,memo,mode,rev,updated_at,last_saved_name&updated_at=gt.' + encodeURIComponent(st.last) + '&order=updated_at.asc&limit=50');
      for (const r of news) {
        const p = st.pending[r.id] || { first: r.updated_at, n: 0 };
        st.pending[r.id] = { first: p.first, t: r.updated_at, n: p.n + 1, by: r.last_saved_name || '', memo: r.memo, mode: r.mode, rev: r.rev };
        st.last = r.updated_at;
      }
      const now = Date.now();
      for (const id of Object.keys(st.pending)) {
        const p = st.pending[id], age = now - Date.parse(p.t);
        if (age < quietMs) continue; // 이어서 저장 중일 수 있다: 조용해질 때까지 기다린다
        const [row] = await api('GET', 'sk_snapshots', '?select=id,memo,rev,updated_at,last_saved_name,summary&id=eq.' + id);
        if (!row) { delete st.pending[id]; delete st.snaps[id]; continue; } // 지워진 자료
        if (Date.parse(row.updated_at) > Date.parse(p.t)) { p.t = row.updated_at; p.rev = row.rev; continue; } // 그사이 또 저장
        const s = row.summary, fresh = s && s.at && Date.parse(s.at) >= Date.parse(row.updated_at) - 5000;
        if (!fresh && age < quietMs + 20 * 60000) continue; // 개요가 아직 안 적혔다: 조금 더 기다린다
        const prev = st.snaps[id];
        if (fresh && prev && prev.summary) {
          const d = diffSummary(prev.summary, s, { minEok: conf.watchMinEok, monthEok: conf.watchMonthEok });
          if (d.notable) {
            const head = '「' + row.memo + '」 저장본이 직전에 본 값과 크게 달라졌습니다(' + (p.by || '?') + ' 저장' + (p.n > 1 ? ' ' + p.n + '번' : '') + ', 저장본 ' + (prev.rev || '?') + ' → ' + row.rev + ').';
            await post({ sender: 'Claude', recipient: 'hong', topic: '저장 점검', status: '안내', body: head + '\n\n' + d.lines.join('\n') + '\n\n자동 점검 알림입니다. 숫자는 목록 「개요」 기준이고, 자료는 바꾸지 않았습니다.' });
            log('살피기 알림', row.memo, 'rev', row.rev);
          }
        } else if (!fresh) log('살피기: 개요 미기록', row.memo, 'rev', row.rev);
        if (fresh) st.snaps[id] = { rev: row.rev, memo: row.memo, summary: s }; // 개요가 없으면 기준을 그대로 둔다
        delete st.pending[id];
      }
      save();
    } catch (e) { log('살피기 오류', e.message); } finally { busy = false; }
  }
  step();
  setInterval(step, pollMs);
}

module.exports = { start, diffSummary, pick };
