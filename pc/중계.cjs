#!/usr/bin/env node
// 챗봇 중계 — 웹 「챗봇」(sk_channel)에서 Codex·Claude 앞 「대기」 글을 찾아 PC의 codex exec / claude -p 로 실행하고 답을 올린다.
// hong 이 무인 자동 방식을 직접 골랐다(2026-10-30, 프로젝트 대화방 결정 카드). 웹 「멈춤」으로 언제든 세운다.
// PC 위치: 손익추정시스템\소통\중계.cjs  (실행: node 소통\중계.cjs  · 한 번만: node 소통\중계.cjs --once)
// 로그인: 사용자 폴더 .sonik-codex.json (채널.cjs 와 같은 Codex 에이전트 계정, sk_agents.can_relay = true)
// 세션 이어 쓰기: 답글 사슬(첫 글 기준)마다 담당별 세션 번호를 소통\중계세션.json 에 두고, 다음 답글은 claude -p --resume / codex exec resume 으로
//           같은 세션에 이어서 실행한다(앞에서 읽은 파일·판단 기억). 이어 쓰기가 실패하거나 너무 길어지면 새 세션 + 글 흐름 전체로 실행한다.
// 웹 제어(sk_relay): ⚙ 모델(claude_model·codex_model·codex_effort, 비우면 중계설정.json·CLI 기본값), ■ 중지(stop_id = 실행 중인 글 번호),
//           ⚡ 빠른 질문(sk_channel.quick): 진행 중인 작업과 따로, 읽기 전용으로 바로 답한다.
// 안전장치: 한 번에 한 글만 · 실행 시간 한도 · hong 없이 이어지는 자동 왕복 한도(sk_relay.max_hops) · 웹 「멈춤」(sk_relay.paused)
//           · 되돌리기 어려운 일(운영본 교체·보관 이동·삭제·외부 전송)은 하지 말고 hong 에게 묻도록 지시 · 모든 실행 출력은 소통\중계로그 에 남김
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), zlib = require('zlib'), crypto = require('crypto');

const URL_ = 'https://znqaxyqayxkgqnqnwyez.supabase.co';
const KEY = 'sb_publishable_2dCd3uLHA80B3hY_DflgKA_xMtj4Itl'; // 공개 키. 접근은 로그인 + RLS
const ROOT = path.resolve(__dirname, '..'); // 손익추정시스템
const LOGIN = process.env.SONIK_CODEX_LOGIN || path.join(os.homedir(), '.sonik-codex.json');
const CONF_PATH = path.join(__dirname, '중계설정.json');
const LOG_DIR = path.join(__dirname, '중계로그');
const SESS_PATH = path.join(__dirname, '중계세션.json');
const ATT_DIR = path.join(__dirname, '첨부');
const DATA_DIR = path.join(__dirname, '자료'); // 챗봇 질문 때 웹에서 열어 둔 추정자료(저장본별로 한 번만 받는다)
const SCR_DIR = path.join(DATA_DIR, '화면'); // 엔진 계산 화면(엔진조회.cjs 결과): 자료·저장본·달·엔진별 폴더
const EQ_TOOL = path.join(__dirname, '엔진조회.cjs');
const KS = require('./검산.cjs'); // 숫자 답 검산
const REQ_DIR = path.join(__dirname, '요청'); // 수정요청 원문(항목·셀·메모·화면 캡처)을 요청 번호별로 풀어 두는 곳
const STAGES = ['접수', '작업중', '작업중', '작업중', '완료']; // 단계 값 0 = 접수, 1~3 = 작업중, 4 = 완료(hong 11/02 단순화). // 웹에서 올린 이미지·파일을 글 번호별로 내려받는 곳
// codex.exe 는 Codex 앱 안(%LOCALAPPDATA%\OpenAI\Codex\bin\<버전>\)에 있고 일반 PATH 에는 없다. 가장 최근 것을 쓴다.
function findCodex() {
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  try {
    const c = fs.readdirSync(base).map((d) => path.join(base, d, 'codex.exe')).filter((f) => fs.existsSync(f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (c.length) return '"' + c[0] + '"';
  } catch (_) { /* 없으면 PATH 의 codex */ }
  return 'codex';
}
const DEF = {
  pollSec: 20,
  timeoutMin: 90,
  resume: true,        // 답글 사슬마다 같은 세션 이어 쓰기
  sessionTurns: 20,    // 한 세션에서 이만큼 답하면 새 세션
  sessionDays: 3,      // 마지막 사용 후 이만큼 지나면 새 세션
  joinMin: 120,
  // 모델 고정(비우면 각 CLI 기본값: claude 는 Claude Code 설정, codex 는 %USERPROFILE%\.codex\config.toml). 예: "claudeModel": "opus", "codexEffort": "high"
  claudeModel: '', codexModel: '', codexEffort: '',        // 답글이 아닌 새 글도 직전 글과 이 시간(분) 안이면 같은 대화(세션)로 이어 간다
  // 프롬프트는 표준입력으로 넘긴다(Windows 인자 길이·따옴표 문제 회피). 중계설정.json 으로 덮어쓸 수 있다.
  codex: { cmd: findCodex(), args: ['exec', '-C', '{ROOT}', '-s', 'workspace-write', '-'] },
  // claude 는 PATH 에 없어도 설치 위치(사용자 폴더 .local\bin)를 먼저 쓴다
  claude: { cmd: fs.existsSync(path.join(os.homedir(), '.local', 'bin', 'claude.exe')) ? '"' + path.join(os.homedir(), '.local', 'bin', 'claude.exe') + '"' : 'claude', args: ['-p', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash Read Edit Write Glob Grep'] },
};
const conf = Object.assign({}, DEF, fs.existsSync(CONF_PATH) ? JSON.parse(fs.readFileSync(CONF_PATH, 'utf8').replace(/^﻿/, '')) : {});

// ── 로그 ─────────────────────────────────────────
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = () => new Date().toLocaleString('sv-SE').replace(' ', 'T');
function log(...a) {
  const line = '[' + stamp() + '] ' + a.join(' ');
  console.log(line);
  fs.appendFileSync(path.join(LOG_DIR, stamp().slice(0, 10) + '.log'), line + '\n');
}

// ── Supabase(REST) ───────────────────────────────
const auth = { tok: null, refresh: null, exp: 0, email: '' };
async function login() {
  let body, grant;
  if (auth.refresh) { grant = 'refresh_token'; body = { refresh_token: auth.refresh }; }
  else {
    const { email, password } = JSON.parse(fs.readFileSync(LOGIN, 'utf8').replace(/^﻿/, ''));
    grant = 'password'; body = { email, password };
  }
  const r = await fetch(URL_ + '/auth/v1/token?grant_type=' + grant, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { if (auth.refresh) { auth.refresh = null; return login(); } throw new Error('로그인 실패: ' + (j.error_description || j.msg || r.status)); }
  Object.assign(auth, { tok: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 120) * 1000, email: String(j.user.email).toLowerCase() });
}
async function api(method, table, q, body) {
  if (!auth.tok || Date.now() > auth.exp) await login();
  const r = await fetch(URL_ + '/rest/v1/' + table + (q || ''), { method, headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  NET.bytes += Buffer.byteLength(t) + 400; NET.n++; // 전송량 세기(hong 11-07): 응답 본문 + 머리글 어림
  if (!r.ok) throw new Error(method + ' ' + table + ' ' + r.status + ': ' + t);
  return t ? JSON.parse(t) : null;
}
// 중계가 몇 초마다 묻는 DB 응답도 Supabase 전송량에 들어간다. 모아서 10분마다 sk_egress 에 한 줄로 적는다(파일은 egress() 가 따로 적음)
const NET = { bytes: 0, n: 0 };
setInterval(() => {
  if (!auth.email || NET.bytes < 1024) return;
  const b = Math.round(NET.bytes), n = NET.n; NET.bytes = 0; NET.n = 0;
  api('POST', 'sk_egress', '', { email: auth.email, bytes: b, what: 'relay api ' + n }).catch(() => { NET.bytes += b; });
}, 600000).unref();
// 무료 한도 현황용: 중계가 받은 파일 크기(내려받기 추정치, migration 014). 실패해도 무시
const egress = (bytes, what) => { if (bytes) api('POST', 'sk_egress', '', { email: auth.email, bytes, what }).catch(() => {}); };
// ── Supabase 실제 사용량(hong 11-07): Usage 화면과 같은 값을 1시간마다 가져와 sk_usage_real 에 적는다 ──
// 개인 토큰(sbp_…)은 이 PC 의 %USERPROFILE%\.sonik-supabase-token 파일에만 둔다(저장소·DB 에 올리지 않음). 파일이 없으면 건너뜀.
// 대시보드가 쓰는 비공개 주소(/platform/…)라 Supabase 가 바꾸면 끊길 수 있다 → 실패하면 error 칸에 적고 웹 카드는 추정치만 보인다.
const ORG = 'wpfrlcrxrglffxvxkmln';
const TOKEN_FILE = path.join(os.homedir(), '.sonik-supabase-token');
async function realUsage() {
  let tok = '';
  try { tok = fs.readFileSync(TOKEN_FILE, 'utf8').replace(/^﻿/, '').trim(); } catch (_) { return; }
  if (!tok) return;
  const get = async (p) => {
    const r = await fetch('https://api.supabase.com' + p, { headers: { Authorization: 'Bearer ' + tok } });
    const t = await r.text();
    if (!r.ok) throw new Error(p + ' ' + r.status + ': ' + t.slice(0, 200));
    return JSON.parse(t);
  };
  const row = { id: 1, fetched_at: new Date().toISOString(), error: '' };
  try {
    const sub = await get('/platform/organizations/' + ORG + '/billing/subscription').catch(() => null);
    const ps = sub && (sub.current_period_start || sub.billing_cycle_anchor), pe = sub && sub.current_period_end;
    const iso = (v) => (v == null ? null : new Date(typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v).toISOString());
    const q = ps && pe ? '?start=' + encodeURIComponent(iso(ps)) + '&end=' + encodeURIComponent(iso(pe)) : '';
    const u = await get('/platform/organizations/' + ORG + '/usage' + q);
    const list = Array.isArray(u) ? u : (u.usages || u.usage || []);
    const pick = (name) => list.find((x) => String(x.metric || x.name || '').toUpperCase() === name);
    const bytes = (x) => { const v = x && +(x.usage ?? x.value ?? x.total); return v == null || isNaN(v) ? null : (!Number.isInteger(v) || v < 1000) ? Math.round(v * 1024 ** 3) : Math.round(v); }; // 소수·작은 수 = GB, 큰 정수 = 바이트
    const eg = pick('EGRESS'), ce = pick('CACHED_EGRESS');
    Object.assign(row, { egress: bytes(eg), cached_egress: bytes(ce), egress_free: bytes(eg && { usage: eg.pricing_free_units ?? eg.available_in_plan }),
      period_start: iso(ps) || (u.usage_billing_period_start ?? null), period_end: iso(pe) || (u.usage_billing_period_end ?? null), raw: u });
    if (row.egress == null) row.error = 'EGRESS 항목을 찾지 못함(응답 모양이 바뀜?)';
  } catch (e) { row.error = String(e.message || e).slice(0, 300); }
  try { await api('POST', 'sk_usage_real', '?on_conflict=id', row); } catch (e) {
    try { await api('PATCH', 'sk_usage_real', '?id=eq.1', row); } catch (e2) { log('실제 사용량 저장 실패', e2.message); }
  }
  if (row.error) log('실제 사용량', row.error); else log('실제 사용량', Math.round(row.egress / 1024 ** 2) + 'MB');
}
// 담당자(작성자·조회자) 대화: owner = 그 사람 이메일. 읽기 전용 질의응답만, 답은 그 사람에게만(hong 11/03)
const isMember = (m) => m && m.sender === '담당' && !!m.owner;
const getMsg = async (id) => (await api('GET', 'sk_channel', '?select=*&id=eq.' + id))[0];
const patchMsg = (id, v) => api('PATCH', 'sk_channel', '?id=eq.' + id, v);
const post = (v) => api('POST', 'sk_channel', '', Object.assign({ author_email: auth.email }, v));
let CTL = {}; // 마지막으로 읽은 중계 제어 줄(모델·중지·멈춤)
const getRelay = async () => { const r = (await api('GET', 'sk_relay', '?select=*&id=eq.1'))[0]; if (r) CTL = r; return r; };
const setRelay = (v) => api('PATCH', 'sk_relay', '?id=eq.1', Object.assign({ updated_at: new Date().toISOString() }, v));

// ── 글 흐름: 답글 사슬을 거슬러 올라간다 ─────────────
async function chain(m, max) {
  const out = [m];
  let cur = m;
  while (cur.reply_to && out.length < max) { cur = await getMsg(cur.reply_to); if (!cur || (cur.owner || null) !== (m.owner || null)) break; out.unshift(cur); }
  return out;
}
// 답글이 아닌 새 글이면, 그 전에 hong 과 이 담당이 나눈 최근 글을 앞 맥락으로 붙인다
async function recent(m, agents, n) {
  if (isMember(m)) return (await api('GET', 'sk_channel', '?select=*&id=lt.' + m.id + '&owner=eq.' + encodeURIComponent(m.owner) + '&order=id.desc&limit=' + n)).reverse();
  const who = '(hong,' + agents.join(',') + ')';
  const q = '?select=*&id=lt.' + m.id + '&sender=in.' + who + '&recipient=in.' + encodeURIComponent('(hong,' + agents.join(',') + ',모두)') + '&order=id.desc&limit=' + n;
  return (await api('GET', 'sk_channel', q)).reverse();
}
// 마지막 hong 글 이후 Codex·Claude 끼리 이어진 글 수
function hopsSinceHong(ch) { let n = 0; for (let i = ch.length - 1; i >= 0 && ch[i].sender !== 'hong' && ch[i].sender !== '담당'; i--) n++; return n; }

// ── 세션 기록: { "Claude:12": { id, turns, lastId, at } } (12 = 답글 사슬의 첫 글) ──
function loadSess() { try { return JSON.parse(fs.readFileSync(SESS_PATH, 'utf8')); } catch (_) { return {}; } }
function saveSess(all) {
  const old = Date.now() - 14 * 864e5;
  for (const k of Object.keys(all)) if (all[k].at && new Date(all[k].at).getTime() < old) delete all[k];
  fs.writeFileSync(SESS_PATH, JSON.stringify(all, null, 1));
}
// 실행 출력에서 세션 번호를 찾는다: claude 는 stream-json 마지막 result 의 session_id, codex 는 --json 의 thread_id(없으면 머리말 "session id: …")
function sessionOf(agent, r) {
  if (agent === 'Claude') return r.json && r.json.session_id || null;
  if (r.thread) return r.thread;
  const x = r.out.match(/session id:\s*([0-9a-f-]{36})/i);
  return x ? x[1] : null;
}

// ── 실시간 진행: CLI 가 줄마다 내보내는 JSON 이벤트를 한 줄 요약으로 바꾼다 ──
// k: read 읽기 · edit 고침 · run 명령 · search 찾기 · text 말 · think 생각 · tool 기타
const cut = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const rel = (f) => { f = String(f || ''); return f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f; };
function eventLines(agent, e) {
  const out = [];
  if (agent === 'Claude' && e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
    for (const c of e.message.content) {
      if (c.type === 'text' && c.text && c.text.trim()) out.push({ k: 'text', s: cut(c.text.replace(/<<<채널[\s\S]*$/, '(답 정리)'), 300) });
      else if (c.type === 'thinking' && c.thinking) out.push({ k: 'think', s: cut(c.thinking, 200) });
      else if (c.type === 'tool_use') {
        const i = c.input || {}, n = c.name || '';
        if (n === 'Read') out.push({ k: 'read', s: rel(i.file_path) });
        else if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) out.push({ k: 'edit', s: (n === 'Write' ? '새로 씀 ' : '') + rel(i.file_path || i.notebook_path) });
        else if (n === 'Bash') out.push({ k: 'run', s: cut(i.description || i.command, 160) });
        else if (n === 'Glob' || n === 'Grep') out.push({ k: 'search', s: cut((i.pattern || '') + (i.path ? '  (' + rel(i.path) + ')' : ''), 160) });
        else out.push({ k: 'tool', s: cut(n + ' ' + JSON.stringify(i), 160) });
      }
    }
  }
  if (agent === 'Codex' && e.item && (e.type === 'item.started' || e.type === 'item.completed')) {
    const it = e.item, t = it.type || it.item_type || '';
    if (/command/.test(t) && e.type === 'item.started') out.push({ k: 'run', s: cut(it.command, 160) });
    else if (/file_change|patch/.test(t) && e.type === 'item.completed') out.push({ k: 'edit', s: cut((it.changes || []).map((x) => rel(x.path) + (x.kind ? ' (' + x.kind + ')' : '')).join(', ') || it.path, 200) });
    else if (/agent_message|assistant/.test(t) && e.type === 'item.completed' && it.text) out.push({ k: 'text', s: cut(it.text.replace(/<<<채널[\s\S]*$/, '(답 정리)'), 300) });
    else if (/reasoning/.test(t) && e.type === 'item.completed' && it.text) out.push({ k: 'think', s: cut(it.text, 200) });
    else if (/search|mcp|tool/.test(t) && e.type === 'item.started') out.push({ k: 'tool', s: cut(it.query || it.tool || it.name || t, 160) });
  }
  return out;
}
// 글의 live 칸에 모아 몇 초마다 올린다(웹이 「작업 중」 말풍선에 보여 준다)
function liveSink(m, agent) {
  const list = Array.isArray(m.live) ? m.live : (m.live = []);
  let timer = null;
  const flush = async () => { timer = null; try { await patchMsg(m.id, { live: list.slice(-150) }); } catch (e) { log('진행 기록 실패 #' + m.id, e.message); } };
  return {
    add(items) { for (const x of items) list.push(Object.assign({ at: new Date().toISOString(), a: agent }, x)); if (items.length && !timer) timer = setTimeout(flush, 2500); },
    async end() { if (timer) { clearTimeout(timer); await flush(); } },
  };
}
// 이벤트 어디에 있든 답 블록(<<<채널 … 채널>>>)이 든 문자열을 찾는다(형식이 바뀌어도 답을 놓치지 않게)
function deepFind(o, re, acc) {
  if (typeof o === 'string') { if (re.test(o)) acc.push(o); } else if (o && typeof o === 'object') for (const v of Object.values(o)) deepFind(v, re, acc);
  return acc;
}

const fmt = (m) => '#' + m.id + ' ' + m.sender + ' → ' + m.recipient + (m.topic ? ' · ' + m.topic : '') + ' · ' + m.status + '\n' + m.body
  + (m._local && m._local.length ? '\n[첨부 ' + m._local.length + '개 — 파일을 직접 열어 본다]\n' + m._local.map((f) => '  ' + f).join('\n') : '');

// 글의 첨부(sk_channel.files, 비공개 버킷 sonik-channel)를 소통\첨부\<글번호>\ 에 내려받고 m._local 에 경로를 둔다
async function fetchFiles(list) {
  for (const m of list) {
    if (m._local || !(m.files || []).length) continue;
    m._local = [];
    const dir = path.join(ATT_DIR, String(m.id));
    fs.mkdirSync(dir, { recursive: true });
    for (const f of m.files) {
      const name = String(f.name || path.basename(f.path)).replace(/[\\/:*?"<>|]/g, '_');
      const to = path.join(dir, name);
      try {
        if (!fs.existsSync(to)) {
          if (!auth.tok || Date.now() > auth.exp) await login();
          const r = await fetch(URL_ + '/storage/v1/object/sonik-channel/' + f.path.split('/').map(encodeURIComponent).join('/'), { headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok } });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const buf = Buffer.from(await r.arrayBuffer());
          fs.writeFileSync(to, buf);
          egress(buf.length, 'relay attach #' + m.id);
        }
        m._local.push(to);
      } catch (e) { log('첨부 받기 실패 #' + m.id, f.name, e.message); m._local.push(to + ' (받기 실패: ' + e.message + ')'); }
    }
  }
}
// 열린 자료 기준 질문(hong 11/03): 웹에서 자료를 열어 둔 채 물으면 글에 ctx(자료 id·저장본·보던 화면의 표)가 붙어 온다.
// 화면 글자는 첨부\<글번호>\화면.txt, 자료 전체(DB 내보내기 JSON)는 자료\<id>_r<저장본>.json 으로 둔다.
// 스냅샷 범위 안 자유 열람·비교(hong 11/03): 자료\목록.json 에 웹 자료 전체 목록을 두고, 질문에 이름이 나온 자료는 받아서
// 열린 자료와의 값 차이를 자료\비교_*.txt 로 미리 뽑아 둔다
const normName = (t) => String(t || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
async function snapFile(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const base = String(s.id).replace(/[^\w-]/g, '_') + '_r';
  const f = path.join(DATA_DIR, base + s.rev + '.json');
  if (fs.existsSync(f)) return f;
  if (!auth.tok || Date.now() > auth.exp) await login();
  const r = await fetch(URL_ + '/storage/v1/object/sonik/' + s.storage_path.split('/').map(encodeURIComponent).join('/'), { headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok } });
  if (!r.ok) throw new Error('자료 받기 HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  egress(buf.length, 'relay ctx ' + s.id);
  fs.writeFileSync(f, buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf);
  // 같은 자료의 옛 저장본은 지운다
  for (const o of fs.readdirSync(DATA_DIR)) if (o.startsWith(base) && o !== path.basename(f)) try { fs.unlinkSync(path.join(DATA_DIR, o)); } catch (_) { /* 무시 */ }
  return f;
}
// 두 자료(JSON)의 값 차이: 경로 \t 앞 \t 뒤. 숫자는 차이(뒤−앞)도 적는다
function diffJson(a, b, pfx, out, lim) {
  if (out.length >= lim) return;
  const isO = (x) => x && typeof x === 'object';
  if (isO(a) && isO(b)) {
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) { diffJson(a[k], b[k], pfx ? pfx + '.' + k : k, out, lim); if (out.length >= lim) return; }
    return;
  }
  if (a === b || (a == null && b == null)) return;
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 1e-9) out.push(pfx + '\t' + a + '\t' + b + '\t' + (+(b - a).toFixed(6))); return; }
  const sh = (x) => x === undefined ? '(없음)' : isO(x) ? '{…' + Object.keys(x).length + '개}' : JSON.stringify(x).slice(0, 120);
  out.push(pfx + '\t' + sh(a) + '\t' + sh(b));
}
function diffFile(fa, sa, fb, sb2) {
  const f = path.join(DATA_DIR, '비교_' + String(sa.id).slice(0, 8) + '_r' + sa.rev + '__' + String(sb2.id).slice(0, 8) + '_r' + sb2.rev + '.txt');
  if (fs.existsSync(f)) return f;
  const out = [];
  diffJson(JSON.parse(fs.readFileSync(fa, 'utf8')), JSON.parse(fs.readFileSync(fb, 'utf8')), '', out, 20000);
  fs.writeFileSync(f, '앞 = 「' + sa.memo + '」 저장본 ' + sa.rev + ' · 뒤 = 「' + sb2.memo + '」 저장본 ' + sb2.rev + '\n'
    + '경로\t앞\t뒤\t차이(뒤−앞, 숫자만)' + (out.length >= 20000 ? '  ※ 차이가 많아 앞 20000줄만' : '') + '\n' + out.join('\n'));
  for (const o of fs.readdirSync(DATA_DIR)) if (o.startsWith('비교_') && path.join(DATA_DIR, o) !== f && (Date.now() - fs.statSync(path.join(DATA_DIR, o)).mtimeMs > 7 * 864e5)) try { fs.unlinkSync(path.join(DATA_DIR, o)); } catch (_) { /* 무시 */ }
  return f;
}
// ── 엔진 계산 화면(챗봇 답변 개선 B, hong 11-04) ──
// 자료를 웹 엔진에 화면 없이 열어 메뉴마다 엔진이 보여 주는 표를 글자로 뽑아 둔다(소통\엔진조회.cjs). 챗봇은 숫자를 여기서 먼저 찾는다.
// 엔진: 웹테스트\손익추정_웹연결_<자료 저장 때 엔진>_날짜.html, 없으면 웹테스트의 가장 새 웹판(자료를 불러오면 데이터는 자료 것으로 바뀐다)
function localEngine(ver) {
  const dir = path.join(ROOT, '웹테스트');
  let fl = [];
  try { fl = fs.readdirSync(dir).filter((f) => /^손익추정_웹연결_v\d+-\d+_\d{8}\.html$/.test(f)); } catch (_) { return null; }
  const exact = ver ? fl.find((f) => f.indexOf('_' + ver + '_') > 0) : null;
  const pick = exact || fl.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)[0];
  return pick ? { file: path.join(dir, pick), ver: (/_(v\d+-\d+)_/.exec(pick) || [])[1], exact: !!exact } : null;
}
const scrJobs = new Map(); // 같은 폴더를 두 갈래(본 작업·빠른 질문)가 동시에 만들지 않게
function screensFor(s, dbFile, ym, engVer) {
  const eng = localEngine(engVer);
  if (!eng) return Promise.resolve({ err: '웹테스트 폴더에 웹 엔진 파일이 없습니다' });
  if (!fs.existsSync(EQ_TOOL)) return Promise.resolve({ err: '소통\\엔진조회.cjs 가 없습니다' });
  ym = /^\d{4}-\d{2}$/.test(ym || '') ? ym : s.base_ym;
  const id8 = String(s.id).slice(0, 8), dir = path.join(SCR_DIR, id8 + '_r' + s.rev + '_' + ym + '_' + eng.ver);
  const done = () => ({ dir, idx: path.join(dir, '목차.txt'), eng, ym, n: (fs.readFileSync(path.join(dir, '목차.txt'), 'utf8').split('\n').length - 3) });
  if (fs.existsSync(path.join(dir, '목차.txt'))) return Promise.resolve(done());
  if (scrJobs.has(dir)) return scrJobs.get(dir);
  const job = new Promise((res) => {
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    const p = cp.spawn(process.execPath, [EQ_TOOL, '--db', dbFile, '--engine', eng.file, '--out', dir, '--ym', ym, '--limit-min', String(conf.screenMin || 6)], { cwd: ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => { try { p.kill(); } catch (_) { /* 무시 */ } }, ((conf.screenMin || 6) + 2) * 60000);
    p.on('error', (e) => { out += e.message; });
    p.on('close', (code) => {
      clearTimeout(kill); scrJobs.delete(dir);
      log('엔진 화면', id8, 'r' + s.rev, ym, eng.ver, 'code', code, Math.round((Date.now() - t0) / 1000) + '초', out.trim().split('\n').pop());
      if (fs.existsSync(path.join(dir, '목차.txt'))) {
        // 같은 자료의 옛 저장본 화면, 7일 지난 화면은 지운다
        for (const o of fs.readdirSync(SCR_DIR)) {
          const f = path.join(SCR_DIR, o);
          if (f === dir) continue;
          const old = (o.startsWith(id8 + '_r') && !o.startsWith(id8 + '_r' + s.rev + '_')) || Date.now() - fs.statSync(f).mtimeMs > 7 * 864e5;
          if (old) try { fs.rmSync(f, { recursive: true, force: true }); } catch (_) { /* 무시 */ }
        }
        res(done());
      } else { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 무시 */ } res({ err: (out.trim().split('\n').pop() || '종료 코드 ' + code).slice(0, 200) }); }
    });
  });
  scrJobs.set(dir, job);
  return job;
}

async function fetchCtx(m, ch, sink) {
  if (m._ctx !== undefined) return;
  m._ctx = null;
  const src = m.ctx ? m : (ch || []).slice().reverse().find((x) => x.ctx && x.sender === m.sender && (x.owner || null) === (m.owner || null));
  const c = src ? src.ctx : null, out = { c, from: src && src.id, more: [] };
  try {
    if (c && c.screen) {
      const dir = path.join(ATT_DIR, String(src.id));
      fs.mkdirSync(dir, { recursive: true });
      out.screen = path.join(dir, '화면.txt');
      fs.writeFileSync(out.screen, '위치: ' + (c.loc || '') + (c.cut ? '\n(표가 많아 앞부분만)' : '') + '\n\n' + c.screen);
    }
    const all = await api('GET', 'sk_snapshots', '?select=id,memo,mode,base_ym,source,author_name,rev,storage_path,updated_at,engine_ver&order=updated_at.desc');
    if (!all.length) throw new Error('중계 계정이 자료 목록을 읽을 수 없습니다(권한)');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    out.list = path.join(DATA_DIR, '목록.json');
    fs.writeFileSync(out.list, JSON.stringify(all.map((x) => ({ 이름: x.memo, 종류: x.mode === 'bizplan' ? '사업계획' : '손익추정', 기준월: x.base_ym, 출처: x.source === 'pc' ? 'PC 원본' : '웹', 작성자: x.author_name, 저장본: x.rev, 마지막저장: x.updated_at, id: x.id })), null, 1));
    out.all = all;
    const open = c && c.snap_id ? all.find((x) => x.id === c.snap_id) : null;
    if (open) { out.open = open; out.db = await snapFile(open); out.rev = open.rev; }
    if (out.db && conf.screens !== false && open.mode !== 'bizplan') {
      if (sink) sink.add([{ k: 'tool', s: '엔진 계산 화면 준비(자료마다 처음 한 번, 1분 안팎)' }]);
      out.scr = await screensFor(open, out.db, c.ym, c.engine_ver);
    }
    // 질문(이 대화의 사람 글)에 이름이 나온 자료: 긴 이름부터 맞추고 맞춘 부분은 지워서 「수급회의」가 「수급회의_1040」 안에서 또 걸리지 않게
    let q = normName((ch || []).filter((x) => x.sender === m.sender).map((x) => x.body).concat([m.body]).join(' '));
    for (const x of all.slice().sort((p, r) => normName(r.memo).length - normName(p.memo).length)) {
      const n = normName(x.memo);
      if (n.length < 2 || !q.includes(n)) continue;
      q = q.split(n).join(' ');
      if (open && x.id === open.id) continue;
      if (out.more.length >= 3) break;
      const e = { s: x };
      try { e.file = await snapFile(x); if (out.db) e.diff = diffFile(out.db, open, e.file, x); } catch (er) { e.err = er.message; }
      // 비교 대상도 엔진 화면을 뽑는다(처음 conf.screenMore 개, 기본 1)
      if (e.file && conf.screens !== false && x.mode !== 'bizplan' && out.more.length < (conf.screenMore == null ? 1 : conf.screenMore)) {
        if (sink) sink.add([{ k: 'tool', s: '비교 자료 「' + x.memo + '」 엔진 계산 화면 준비' }]);
        e.scr = await screensFor(x, e.file, c && c.ym, x.engine_ver);
      }
      out.more.push(e);
    }
  } catch (e) { log('열린 자료 받기 실패 #' + m.id, e.message); out.err = e.message; }
  m._ctx = out;
}
function scrDirs(m) {
  const x = m._ctx; if (!x) return [];
  return [x.scr].concat((x.more || []).map((e) => e.scr)).filter((s) => s && s.dir).map((s) => s.dir);
}
function ctxLines(m) {
  const x = m._ctx;
  if (!x) return [];
  const c = x.c, nm = (s) => '「' + s.memo + '」(' + (s.mode === 'bizplan' ? '사업계획' : '손익추정') + ', 기준월 ' + s.base_ym + ', 저장본 ' + s.rev + ')';
  const L = [''];
  if (c) {
    L.push('[열린 자료 기준] 질문한 사람은 웹에서 「' + (c.snap_memo || '') + '」(' + (c.kind === 'bizplan' ? '사업계획' : '손익추정') + ', 기준월 ' + (c.base_ym || '') + ', 엔진 ' + (c.engine_ver || '') + ')를 열어 둔 채 물었다.',
      '따로 말하지 않으면 이 자료 기준으로 숫자를 찾아 답한다. PC 운영본의 값을 쓰지 않는다. 답 첫 줄에 어느 자료 기준인지 밝힌다.');
    if (x.screen) L.push('- 물을 때 보던 화면(' + (c.loc || '') + ')의 표, 탭 구분 글자: ' + x.screen + '  — 엔진이 계산해 보여 준 값은 여기서 먼저 찾는다.' + (c.dirty ? ' 저장하지 않은 수정이 있으니 화면 값이 저장본보다 우선이다.' : ''));
    if (x.db) L.push('- 열린 자료 전체(DB 내보내기 JSON, 저장본 ' + x.rev + (c.rev && c.rev !== x.rev ? ', 물을 때 연 것은 저장본 ' + c.rev + '이라 그 뒤 저장이 있었다' : '') + '): ' + x.db + '  — 크므로 필요한 키만 찾아 읽는다.');
  }
  const scrs = scrDirs(m);
  if (x.scr && x.scr.dir) {
    L.push('[엔진 계산 화면] 열린 자료를 웹 엔진 ' + x.scr.eng.ver + '에 열어, 메뉴마다 엔진이 계산해 보여 주는 표를 글자로 뽑아 두었다(화면 ' + x.scr.n + '개).',
      '  목차: ' + x.scr.idx + '  (월을 고르는 화면은 ' + x.scr.ym + ' 기준, 확정 구역은 기준월 직전 달, 나머지는 전체 월 표)' + (x.scr.eng.exact ? '' : '  ※ 자료를 저장한 엔진(' + (c && c.engine_ver) + ') 파일이 PC에 없어 ' + x.scr.eng.ver + ' 로 열었다.'));
  } else if (x.scr && x.scr.err) L.push('[엔진 계산 화면] 뽑지 못했다(' + x.scr.err + '). 화면 표와 자료 JSON 으로 답한다.');
  for (const e of x.more) if (e.scr && e.scr.dir) L.push('- 비교 자료 「' + e.s.memo + '」의 엔진 계산 화면 목차: ' + e.scr.idx);
  if (scrs.length) {
    const q = m.quick || isMember(m) || !(x.scr && x.scr.dir);
    L.push('[숫자 답 규칙] 손익·금액·단가·물량 같은 숫자는 아래 순서로 구한다. 직접 만든 공식으로 다시 셈한 값은 틀리기 쉽다(예: 외화단가 = 금액÷수량÷기준환율처럼 엔진 정의가 따로 있다).',
      '  1) 엔진 계산 화면 파일에서 찾는다: 목차로 화면을 고르고 그 파일을 읽거나 grep 한다. 화면 파일 값이 자료 JSON·직접 셈보다 우선이다.',
      q ? '  2) 화면에 없으면 화면에 있는 값들로만 셈하고 「계산」이라고 밝힌다. 그래도 못 구하면 그 값을 볼 메뉴를 안내한다.'
        : '  2) 화면에 없으면 엔진 함수로 구한다: node 소통\\엔진조회.cjs --db "' + x.db + '" --engine "' + x.scr.eng.file + '" --eval "식"  (다른 달 화면: --out 소통\\자료\\화면\\<새 폴더> --ym YYYY-MM [--conf-ym YYYY-MM] [--only 온산]). 그래도 없을 때만 직접 셈하고 「계산」이라고 밝힌다.',
      '  3) 단위·부호는 화면 그대로 쓴다(Δ = 음수, 백만원·억원 구분). 억원으로 바꿔 쓰면 「계산」 줄로 적는다.',
      '  4) 채널 블록(<<<채널) 바로 앞에, 답에 쓴 숫자마다 근거를 아래 형식(탭 구분)으로 적는다. 중계가 화면 파일과 대조해 검산하고, 맞지 않으면 다시 고치게 한다. 이 블록은 채널에 올라가지 않는다.',
      '<<<근거',
      '숫자\t화면 파일 이름(목차의 001_… )\t행 이름\t열 이름',
      '숫자\t계산\t식(식에 쓴 값도 각각 한 줄씩 화면 근거를 적는다)',
      '근거>>>');
  }
  if (x.list) L.push('[웹 자료 범위 안에서 자유 열람·비교] 웹에 저장된 자료 전체 목록: ' + x.list + ' (' + x.all.length + '개). 질문이 다른 자료를 가리키면 이 목록에서 찾는다.');
  for (const e of x.more) {
    if (e.err) { L.push('- 질문에 나온 ' + nm(e.s) + ': 받지 못했다(' + e.err + ').'); continue; }
    L.push('- 질문에 나온 ' + nm(e.s) + ' 전체: ' + e.file + (e.diff ? '\n  열린 자료와의 값 차이(경로·앞·뒤·차이, 앞 = 열린 자료): ' + e.diff + '  — 비교 질문은 여기서 차이 나는 입력값(가격·물량·원가·비용 등)을 먼저 찾아 원인으로 설명한다.' : ''));
  }
  if (x.list && !x.more.length) L.push('- 질문에 다른 자료 이름이 없어 미리 받은 자료는 없다. 다른 자료가 필요하면 목록의 정확한 이름을 넣어 다시 물어 달라고 안내한다.');
  if (x.err) L.push('- 자료를 다 받지 못했다(' + x.err + '). 받은 것으로 답하고, 없으면 그렇다고 말한다.');
  if (!scrs.length) L.push('자료 JSON 에는 주로 입력값이 들어 있다. 손익처럼 계산된 값은 화면 표에서 찾고, 없으면 입력값과 운영본 계산 방식으로 구해 어떻게 구했는지 한 줄로 적는다. 끝내 못 구하면 그 값을 볼 수 있는 메뉴를 안내한다.');
  return L;
}
// 대화가 어느 수정요청에 관한 것인지: 글의 request_id(접수 때 자동으로 올라온 글) 또는 주제 「수정요청 #N」
function reqIdOf(list) {
  for (const x of list.slice().reverse()) {
    if (x.request_id) return x.request_id;
    const t = /수정요청\s*#(\d+)/.exec(x.topic || '');
    if (t) return +t[1];
  }
  return null;
}
// 수정 엔진 요청(hong 11/03): 웹에 올린 빈 엔진(gz)을 받아 풀고 해시를 확인해 소통\요청\<번호>\수정엔진_<바탕>.html 로 둔다
async function engineFile(it, dir) {
  const to = path.join(dir, '수정엔진_' + String(it.base_ver || '바탕모름').replace(/[\\/:*?"<>|]/g, '_') + '.html');
  if (fs.existsSync(to)) return to;
  if (!auth.tok || Date.now() > auth.exp) await login();
  const r = await fetch(URL_ + '/storage/v1/object/sonik-channel/' + it.path.split('/').map(encodeURIComponent).join('/'), { headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const gz = Buffer.from(await r.arrayBuffer());
  egress(gz.length, 'relay engine ' + it.path);
  const buf = gz[0] === 0x1f && gz[1] === 0x8b ? zlib.gunzipSync(gz) : gz;
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (it.sha256 && sha !== it.sha256) throw new Error('해시가 기록과 다름(' + sha.slice(0, 8) + ' ≠ ' + it.sha256.slice(0, 8) + ')');
  fs.writeFileSync(to, buf);
  return to;
}
// 요청 원문을 소통\요청\<번호>\요청.md(+ 캡처 그림)로 풀어 두고 m._req 에 요약을 단다
async function loadRequest(m, list) {
  const id = reqIdOf(list);
  if (!id) return;
  try {
    const [r] = await api('GET', 'sk_requests', '?select=*&id=eq.' + id);
    if (!r) return;
    const dir = path.join(REQ_DIR, String(id));
    fs.mkdirSync(dir, { recursive: true });
    const L = ['# 수정요청 #' + r.id + ' · ' + r.title, '', '- 구분: ' + r.kind + ' · 작성: ' + (r.author_name || r.author_email) + ' · 접수: ' + r.created_at,
      '- 스냅샷 기준월 ' + (r.base_ym || '-') + ' · 엔진 ' + (r.engine_ver || '-') + ' · 지금 단계: ' + STAGES[r.status === '완료' ? 4 : (r.stage || 0)], ''];
    if (r.body) L.push('## 설명', '', r.body, '');
    let eng = null;
    (r.items || []).forEach((it, i) => {
      const loc = it.loc || {};
      L.push('## 항목 ' + (i + 1), '', '- 위치: ' + [loc.zone, loc.site, loc.menu, (loc.subs || []).join(' > '), loc.ym, loc.table].filter(Boolean).join(' · ') + (it.kind === 'area' ? ' (영역 지정)' : ''));
      (it.cells || []).forEach((c) => L.push('- 셀 ' + (c.row || '') + ' / ' + (c.col || '') + ' = ' + (c.value == null ? '' : c.value) + (c.note ? '  → 메모: ' + c.note : '')));
      if (it.note) L.push('- 메모: ' + it.note);
      if (it.texts && it.texts.length) L.push('- 영역 글자: ' + it.texts.slice(0, 80).join(' | '));
      if (it.excerpt && it.excerpt.rows) L.push('', '표 발췌:', '', ...it.excerpt.rows.slice(0, 40).map((row) => '| ' + row.map((v) => String(v == null ? '' : v).replace(/\|/g, '/')).join(' | ') + ' |'));
      if (it.kind === 'engine') { eng = it; L.push('- 수정 엔진 파일: ' + (it.name || '') + ' · 바탕 버전 ' + (it.base_ver || '?') + ' · 올릴 때 웹 엔진 ' + (it.web_ver || '?') + (it.diff ? ' · 웹 엔진 대비 추가 ' + it.diff.add + '줄 / 삭제 ' + it.diff.del + '줄' : ' · 바탕이 웹 엔진과 달라 줄 비교 없음') + (it.old_base ? ' (예전 버전 바탕)' : '')); }
      const im = /^data:image\/(png|jpeg);base64,(.+)$/.exec(it.image || '');
      if (im) { const f = path.join(dir, '항목' + (i + 1) + '.' + (im[1] === 'jpeg' ? 'jpg' : 'png')); fs.writeFileSync(f, Buffer.from(im[2], 'base64')); L.push('', '화면 캡처: ' + f); }
      L.push('');
    });
    let engFile = null, mergeFile = null;
    if (eng) {
      try {
        engFile = await engineFile(eng, dir);
        // 관리자가 승인(접수)한 뒤에만 PC 합류대기\ 에 내려놓는다
        if (!['승인대기', '반려', '취소'].includes(r.status)) {
          const md = path.join(ROOT, '합류대기');
          fs.mkdirSync(md, { recursive: true });
          mergeFile = path.join(md, 'R' + id + '_' + String(eng.base_ver || '바탕모름').replace(/[\\/:*?"<>|]/g, '_') + '.html');
          if (!fs.existsSync(mergeFile)) fs.copyFileSync(engFile, mergeFile);
        }
        L.push('', '## 수정 엔진', '', '- 받은 파일: ' + engFile, '- 합류대기: ' + (mergeFile || '아직 승인 전이라 내려놓지 않음'));
      } catch (e) { L.push('', '## 수정 엔진', '', '- 받지 못함: ' + e.message); log('수정 엔진 받기 실패 #' + id, e.message); }
    }
    const file = path.join(dir, '요청.md');
    fs.writeFileSync(file, L.join('\n'));
    m._req = { id, title: r.title, stage: r.stage, status: r.status, file, eng: eng && engFile ? { base: eng.base_ver, file: engFile, merge: mergeFile, diff: eng.diff } : null };
  } catch (e) { log('요청 읽기 실패 #' + id, e.message); }
}
// 답의 「진행:」 줄을 요청의 단계·설명(progress)에 적는다. 진행 줄이 없어도 답의 첫 줄을 설명으로 남긴다(목록에 늘 최신 상황이 보이게)
// 단계: 작업중 → 1, 완료 → 4. 옛 말(검토·수정·검증·보류)은 작업중, 반영은 완료로 읽는다
async function applyProgress(m, agent, pg, body) {
  if (!m._req) return;
  try {
    const [r] = await api('GET', 'sk_requests', '?select=stage,status,progress&id=eq.' + m._req.id);
    const cur = r.status === '완료' ? 4 : (r.stage || 0);
    const done = pg && /^(완료|반영)$/.test(pg.step);
    const stage = done ? 4 : Math.max(1, cur);
    const text = (pg && pg.text) || String(body || '').split(/\r?\n/).find((l) => l.trim()) || '답변을 올렸습니다';
    const progress = (r.progress || []).concat([{ at: new Date().toISOString(), stage, text: '[' + agent + '] ' + text.trim().slice(0, 300) }]);
    await api('PATCH', 'sk_requests', '?id=eq.' + m._req.id, { stage, status: stage === 4 ? '완료' : '진행', progress, updated_at: new Date().toISOString() });
    m._req.stage = stage; m._req.status = stage === 4 ? '완료' : '진행';
    log('요청 #' + m._req.id, STAGES[stage], text.slice(0, 80));
  } catch (e) { log('요청 진행 기록 실패 #' + m._req.id, e.message); }
}
// 실시간 표시: 실행을 시작하면 그 요청에 「● 담당 작업 중」을 켜고(접수 상태면 작업중으로), 끝나면 끈다
async function reqWorking(m, agent) {
  if (!m._req) return;
  try {
    const patch = { working: agent || null, updated_at: new Date().toISOString() };
    if (agent && !(m._req.stage >= 1) && m._req.status !== '완료') {
      const [r] = await api('GET', 'sk_requests', '?select=progress&id=eq.' + m._req.id);
      Object.assign(patch, { stage: 1, status: '진행', progress: ((r && r.progress) || []).concat([{ at: new Date().toISOString(), stage: 1, text: '[' + agent + '] 요청을 읽고 작업을 시작했습니다' }]) });
      m._req.stage = 1; m._req.status = '진행';
    }
    await api('PATCH', 'sk_requests', '?id=eq.' + m._req.id, patch);
  } catch (e) { log('요청 작업 표시 실패 #' + m._req.id, e.message); }
}
const isImg = (p) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);

// 챗봇 안내서·기억(hong 2026-11-04): 손익추정시스템\챗봇\안내.md(질문별 볼 곳·용어) + 기억.md(확정 결정·자주 묻는 답)를 질문마다 맨 앞에 붙인다.
// 실행할 때마다 새로 읽으므로 파일만 고치면 바로 반영된다. 너무 크면 앞부분만 싣고 파일 경로를 알려 준다.
const GUIDE_DIR = path.join(ROOT, '챗봇');
function guideLines(canWrite) {
  const L = [];
  for (const [f, lim] of [['안내.md', 12000], ['기억.md', 12000]]) {
    let t = '';
    try { t = fs.readFileSync(path.join(GUIDE_DIR, f), 'utf8').replace(/^\uFEFF/, ''); } catch (_) { continue; }
    if (t.length > lim) t = t.slice(0, lim) + '\n…(뒷부분 생략 — 전체는 챗봇\\' + f + ' 를 직접 읽는다)';
    L.push('[챗봇\\' + f + ']', t.trim(), '');
  }
  if (!L.length) return [];
  L.push(canWrite
    ? '위 안내서로 볼 곳을 먼저 정하고 답한다. hong 이 이번 대화에서 새로 결정·확정한 것이나 두 번 이상 나온 질문의 답은 챗봇\\기억.md 의 알맞은 절 끝에 그 파일 머리의 형식대로 한 줄 덧붙인다(담당자에게도 보이는 파일이라 시스템·업무 규칙만).'
    : '위 안내서로 볼 곳을 먼저 정하고 답한다. 이 실행에서는 안내서·기억 파일을 고치지 않는다.', '');
  return L;
}

// 담당자 질의응답 프롬프트: 읽기 전용, hong 의 다른 대화·진행 작업은 알려 주지 않는다
function memberPrompt(agent, m, ch, group) {
  return [
    ...guideLines(false),
    '[담당자 질의응답 · 읽기 전용] 질문한 사람은 hong 이 아닌 팀 담당자(' + m.owner + ')다. 이 실행은 읽기 전용이다.',
    '파일을 고치거나 만들거나 지우지 않는다. 명령을 실행하지 않는다. 버전을 만들거나 Codex·hong 에게 작업을 넘기지 않는다.',
    '손익추정 시스템의 사용법·메뉴·계산 방식·자료의 뜻을 작업 폴더(' + ROOT + ')의 문서(AGENTS.md, 코드지도, _brain 등)와 운영본을 읽고 쉽게 설명한다.',
    '시스템을 고쳐 달라는 요청(계산 오류·표시·기능 추가)이면 고치지 말고, 답 본문 끝(채널 블록 안)에 아래 수정요청 초안 블록을 하나 넣는다. 웹이 이 초안을 카드로 보여 주고, 담당자가 확인·고쳐서 「올리기」를 눌러야 접수된다(관리자 승인 뒤 처리). 단순 질문·사용법 설명에는 넣지 않는다.',
    '<<<요청초안',
    '제목: (40자 이내, 무엇을 어떻게)',
    '구분: 계산 | 표시·서식 | 기능 추가 | 기타 중 하나',
    '내용: (지금 어떤지 → 어떻게 되어야 하는지. 메뉴·표·행·달과 숫자를 구체적으로, 여러 줄 가능)',
    '요청초안>>>',
    '본문에는 「아래 초안을 확인하고 올리기를 누르면 접수됩니다. 셀·화면을 붙이려면 자료를 열고 ✏️ 수정요청을 쓰세요」라고 한 줄 안내한다.',
    'hong 의 다른 대화, 진행 중인 작업, 중계 기록, 비밀번호·계정 정보는 알려 주지 않는다.',
    '소통\\중계로그, 중계세션.json, 소통\\첨부, 소통\\산출물\\보낸파일 의 다른 사람 폴더는 열지 않는다(남의 대화다).',
    '질문에 캡처 그림이 붙어 있으면 그림을 먼저 보고, 그림 속 화면·숫자를 기준으로 답한다.',
    ...FILE_HINT,
    '',
    ...ctxLines(m),
    '',
    '대화(마지막 글이 질문):',
    '',
    ch.map(fmt).join('\n\n'),
    '',
    group ? '이 질문은 Claude·Codex 모두에게 왔다. Claude 가 먼저, Codex 가 이어서 답한다. 같은 말은 되풀이하지 않는다.' : '',
    '마지막에 답을 정확히 아래 형식으로 출력한다(이 블록만 채널에 올라간다):',
    '<<<채널',
    '받는이: 담당',
    '상태: 안내',
    '주제: ' + (m.topic || '짧은 제목'),
    '(본문: 첫 줄에 결론 한 문장 → 빈 줄 → 「- 」 목록으로 핵심만. 15줄 이내. 수정요청 초안 블록은 줄 수에 넣지 않는다)',
    '채널>>>',
  ].join('\n');
}
function prompt(agent, m, ch, group) {
  if (isMember(m)) return memberPrompt(agent, m, ch, group);
  const other = agent === 'Codex' ? 'Claude' : 'Codex';
  const role = agent === 'Codex'
    ? '너는 Codex(검증 담당)다. AGENTS.md 와 ../협업규칙.md §5 를 따른다.'
    : '너는 Claude(빌드 담당)다. AGENTS.md 와 ../협업규칙.md §4 를 따른다.';
  return [
    ...guideLines(!m.quick),
    role,
    '작업 폴더: ' + ROOT + ' . 시작 전에 AGENTS.md 를 읽는다.',
    '아래는 웹 「챗봇」 채널의 글 흐름이다(마지막 글이 너에게 온 요청).',
    '',
    ch.map(fmt).join('\n\n'),
    '',
    group ? '이 대화는 hong·Claude·Codex 셋이 함께 하는 대화(받는이 모두)다. Claude 가 먼저 답하고 Codex 가 Claude 의 답까지 보고 이어서 답한다. 상대 답에 덧붙이거나 다른 의견을 내되 같은 말은 되풀이하지 않는다.' : '',
    '할 일: ' + (group ? 'hong 의 글(#' + m.id + ')' : '마지막 글(#' + m.id + ')') + '의 요청을 처리한다. 긴 결과는 지금처럼 검증자료\\vNNN\\ 등 파일에 쓰고 채널에는 요약과 경로만 남긴다.',
    '되돌리기 어려운 일(운영본 교체·보관 이동·파일 삭제·외부 전송)은 하지 말고 받는이를 hong 으로 해서 확인을 요청한다.',
    ...reqLines(m),
    ...ctxLines(m),
    ...FILE_HINT,
    '다른 담당에게 넘길 일이 있으면 받는이를 ' + other + ' 로, hong 이 결정할 일이면 hong 으로 한다.',
    '',
    '마지막에 채널에 올릴 답을 정확히 아래 형식으로 출력한다(이 블록만 채널에 올라간다):',
    '<<<채널',
    group ? (agent === 'Codex' ? '받는이: 모두   (Claude 가 고치거나 처리해야 할 일이 남으면 받는이: Claude)' : '받는이: 모두') : '받는이: hong 또는 ' + other,
    group ? (agent === 'Codex' ? '상태: 안내   (받는이를 Claude 로 넘길 때만 대기)' : '상태: 안내') : '상태: 대기 또는 안내   (받는이가 답하거나 처리해야 하면 대기, 알리기만 하면 안내)',
    '주제: ' + (m.topic || '짧은 제목'),
    '(본문: 첫 줄에 결론 한 문장 → 빈 줄 → 「- 」 목록으로 핵심만. 항목 이름은 **굵게**, 파일·경로는 `백틱`. hong 이 결정할 일은 맨 끝에 번호 목록. 15줄 이내)',
    '채널>>>',
  ].join('\n');
}

// 수정요청에 관한 대화면: 요청 원문 위치, 진행 단계를 적는 「진행:」 줄 안내
function reqLines(m) {
  const q = m._req;
  if (!q) return [];
  return ['',
    '이 대화는 웹 수정요청 #' + q.id + ' 에 관한 것이다(제목: ' + q.title + ' · 지금 단계: ' + STAGES[q.status === '완료' ? 4 : (q.stage || 0)] + ').',
    '요청 원문(항목 위치·고른 셀과 값·메모·화면 캡처 그림): ' + q.file + '  — 먼저 읽는다. 그림 파일은 같은 폴더에 있다.',
    '엔진 수정은 AGENTS.md 의 버전 흐름(다음 운영본 번호, 검증자료, 자동검증, Codex 교차검증 통과)을 따르고, 「반영」은 통과 뒤에만 쓴다.',
    ...(q.eng ? ['[수정 엔진 요청] 담당자가 고친 엔진 통파일을 올렸다: ' + q.eng.file + ' (바탕 버전 ' + (q.eng.base || '?') + (q.eng.diff ? ', 웹 엔진 대비 +' + q.eng.diff.add + '/-' + q.eng.diff.del + '줄' : '') + ').',
      q.eng.merge ? '승인돼 PC 합류대기에도 두었다: ' + q.eng.merge + '. 병합은 3방향으로 한다: 바탕 = 같은 번호의 운영본(루트·보관\\버전) 또는 웹테스트의 같은 웹 엔진, 바뀐 쪽 = 올린 파일, 받는 쪽 = 지금 운영본. 바탕→올린 파일의 차이만 떼어 지금 운영본에 얹어 다음 운영본 번호로 만든다. 데이터 블록은 옮기지 않는다. 충돌·바탕을 못 찾음·로직이 겹침은 hong 에게 묻는다.' : '아직 관리자 승인 전이므로 병합하지 말고 바뀐 내용을 읽어 요약·검토만 한다.'] : []),
    '답 블록 안에 진행 줄을 하나 넣으면 웹 요청 목록의 설명이 그 문장으로 바뀐다(hong 이 읽는 쉬운 한 문장). 단계는 접수 › 작업중 › 완료 셋뿐이다:',
    '진행: 작업중 - 설명   (요청이 끝까지 처리됐을 때만 「진행: 완료 - 설명」. 엔진 수정은 Codex 교차검증 통과·웹 반영 뒤에만 완료)'];
}

// 이어 쓰는 세션에는 그 세션이 아직 못 본 글만 넘긴다
function followUp(agent, m, fresh, group) {
  const other = agent === 'Codex' ? 'Claude' : 'Codex';
  return [
    '웹 「챗봇」 채널에 이 대화의 새 글이 올라왔다(마지막 글이 너에게 온 요청).',
    '',
    fresh.map(fmt).join('\n\n'),
    '',
    group ? '이 글은 셋이 함께 하는 대화(받는이 모두)다. Claude 가 먼저, Codex 가 이어서 답한다. 같은 말은 되풀이하지 않는다.' : '',
    '할 일: ' + (group ? 'hong 의 글(#' + m.id + ')' : '마지막 글(#' + m.id + ')') + '의 요청을 처리한다. 앞에서와 같은 규칙(AGENTS.md, 되돌리기 어려운 일은 hong 확인)을 따른다.',
    ...reqLines(m),
    ...ctxLines(m),
    '마지막에 채널에 올릴 답을 앞에서와 같은 형식으로 출력한다:',
    '<<<채널',
    group ? (agent === 'Codex' ? '받는이: 모두   (Claude 가 고치거나 처리해야 할 일이 남으면 받는이: Claude)' : '받는이: 모두') : '받는이: hong 또는 ' + other,
    group ? (agent === 'Codex' ? '상태: 안내   (받는이를 Claude 로 넘길 때만 대기)' : '상태: 안내') : '상태: 대기 또는 안내',
    '주제: ' + (m.topic || '짧은 제목'),
    '(본문: 첫 줄에 결론 한 문장 → 빈 줄 → 「- 」 목록으로 핵심만. 항목 이름은 **굵게**, 파일·경로는 `백틱`. hong 이 결정할 일은 맨 끝에 번호 목록. 15줄 이내)',
    '채널>>>',
  ].join('\n');
}

function parseReply(out, agent) {
  // 파일 답(hong 11/03): <<<파일 이름.csv … 파일>>> 블록은 채널 블록 안팎 어디에 있어도 파일로 떼어 낸다
  const fileBlocks = [...String(out).matchAll(/<<<(?:파일[ \t]+)?([^\r\n<>]+?\.[A-Za-z0-9]{2,5})[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*파일>>>/g)].map((x) => ({ name: x[1].trim(), text: x[2] }));
  out = String(out).replace(/<<<(?:파일[ \t]+)?[^\r\n<>]+?\.[A-Za-z0-9]{2,5}[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*파일>>>/g, '');
  // 만들어 둔 파일(엑셀 등) 첨부(hong 11/03): <<<첨부 경로>>> 한 줄. 중계가 PC 파일을 그대로 올린다
  for (const x of String(out).matchAll(/<<<첨부[ \t]+([^\r\n>]+?)[ \t]*>>>/g)) fileBlocks.push({ name: x[1].trim().split(/[\\/]/).filter(Boolean).pop(), local: x[1].trim() });
  out = String(out).replace(/<<<첨부[ \t]+[^\r\n>]+?[ \t]*>>>/g, '');
  const all = [...String(out).matchAll(/<<<채널\s*\r?\n([\s\S]*?)\r?\n\s*채널>>>/g)];
  if (!all.length) return null;
  const blk = all[all.length - 1][1];
  const get = (k) => { const x = blk.match(new RegExp('^\\s*' + k + '\\s*:\\s*(.+)$', 'm')); return x ? x[1].trim() : ''; };
  let to = get('받는이'); if (!['hong', 'Codex', 'Claude'].includes(to) || to === agent) to = 'hong';
  let st = get('상태').split(/\s/)[0]; if (!['대기', '안내'].includes(st)) st = '대기';
  const body = blk.split(/\r?\n/).filter((l) => !/^\s*(받는이|상태|주제|진행)\s*:/.test(l)).join('\n').trim();
  const pg = get('진행').match(/^(작업중|완료|검토|수정|검증|반영|보류)\s*[-–—:·]?\s*(.*)$/);
  return { fileBlocks, to, st, topic: get('주제'), body, progress: pg ? { step: pg[1], text: pg[2].trim() || body.split('\n')[0] } : null };
}

// 답에 붙은 파일 블록을 sonik-channel 에 올리고 글의 files 로 돌려준다. 담당자 답은 담당/<그 사람 이메일>/ 아래(그 사람만 읽음)
const OUT_EXT = { csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/markdown', json: 'application/json' };
const BIN_EXT = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', xls: 'application/vnd.ms-excel', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', zip: 'application/zip' };
const OUT_DIR = path.join(__dirname, '산출물');
// 첨부 경로: 손익추정시스템 폴더 안만. 담당자 질문의 답은 소통\산출물 안 파일만
function localOut(p, m) {
  const f = path.resolve(path.isAbsolute(p) ? p : path.join(ROOT, p));
  const lim = isMember(m) ? OUT_DIR : ROOT;
  if (f !== lim && !f.startsWith(lim + path.sep)) throw new Error((isMember(m) ? '소통\\산출물' : '손익추정시스템') + ' 폴더 밖 파일');
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('파일 없음');
  return f;
}
async function uploadOut(blocks, m, agent) {
  const files = [];
  for (const b of (blocks || []).slice(0, 5)) {
    try {
      let name = b.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
      let ext = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
      let buf, type;
      if (b.local) {
        const f = localOut(b.local, m);
        type = BIN_EXT[ext] || OUT_EXT[ext];
        if (!type) throw new Error('올릴 수 없는 형식 .' + ext);
        buf = fs.readFileSync(f);
        if (buf.length > 10 * 1048576) throw new Error('10MB 초과');
      } else {
        if (!OUT_EXT[ext]) { ext = 'txt'; name += '.txt'; }
        type = OUT_EXT[ext];
        buf = Buffer.from((ext === 'csv' || ext === 'tsv' ? '\ufeff' : '') + b.text, 'utf8'); // 엑셀이 한글을 읽도록 BOM
        if (buf.length > 2 * 1048576) throw new Error('2MB 초과');
      }
      // 보낸 파일은 PC 에도 남긴다(다시 보내 달라면 대화 기록의 경로를 <<<첨부>>> 로 바로 붙이게)
      const keep = path.join(OUT_DIR, '보낸파일', isMember(m) ? String(m.owner).toLowerCase().replace(/[^a-z0-9._-]/g, '_') : agent, new Date().toISOString().slice(0, 10) + '_' + name);
      if (!b.local) { fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.writeFileSync(keep, buf); b.keep = keep; }
      const key = (isMember(m) ? 'member/' + String(m.owner).toLowerCase().replace(/[^a-z0-9._-]/g, '_') : agent) + '/' + new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      if (!auth.tok || Date.now() > auth.exp) await login();
      const r = await fetch(URL_ + '/storage/v1/object/sonik-channel/' + key.split('/').map(encodeURIComponent).join('/'), { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok, 'Content-Type': type + (b.local ? '' : '; charset=utf-8') }, body: buf });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      files.push({ path: key, name, size: buf.length, type });
    } catch (e) { log('답 파일 올리기 실패 #' + m.id, b.name, e.message); files.failed = (files.failed || []).concat(b.keep ? b.name + '(PC: ' + path.relative(ROOT, b.keep) + ')' : b.name); }
  }
  return files;
}
const FILE_HINT = ['질문한 사람이 표·목록을 파일로 받기 원하면(또는 숫자가 많아 표가 길면) 채널 블록과 따로 아래 형식으로 파일을 붙인다. 글자 표는 파일을 따로 만들 필요 없이 블록으로 쓰면 중계가 파일로 올린다. 한 답에 5개, 파일마다 2MB 까지. 웹 소통 채널에 붙이는 것은 외부 전송이 아니다(질문한 사람만 받는다).',
  '<<<파일 이름.csv', '(CSV 본문: 첫 줄 머리글, 쉼표 구분, 쉼표가 든 값은 큰따옴표. .tsv·.txt·.md·.json 도 된다)', '파일>>>',
  '이미 만든 파일(엑셀·PPT·PDF·그림 등)은 내용을 옮겨 적지 말고 한 줄로 붙인다(중계가 그 파일을 그대로 올린다. 손익추정시스템 폴더 안, 10MB 까지. 새로 만드는 파일은 소통\\산출물\\ 아래에 둔다):',
  '<<<첨부 소통\\산출물\\파일이름.xlsx>>>',
  '앞에서 보낸 파일을 다시 달라고 하면 대화 기록에 적힌 그 파일 경로(첨부 줄·「PC:」 경로)를 <<<첨부 경로>>> 로 바로 붙인다. 중계로그·세션 기록을 뒤지거나 다시 만들지 않는다.',
  '네가 직접 웹에 올리려 하지 않는다(채널 도구·Edge·브라우저 제어 금지, 제어 권한을 달라고도 하지 않는다). 파일 전달은 위 첨부 줄이면 된다.',
  '웹 추정자료에 엑셀을 넣어 달라는 요청은 직접 하지 못한다: 필요한 파일을 첨부하고, 웹에서 그 자료를 열어 어느 메뉴의 어떤 업로드 버튼에 넣으면 되는지 순서를 안내한다.',
  '파일을 붙이면 채널 본문에는 요약과 「첨부 파일 이름」만 적는다.'];
// resumeId 가 있으면 그 세션에 이어서 실행한다
// opt: { quick: 읽기 전용, stopId: 이 글 번호로 중지 요청이 오면 끊는다 }
function run(agent, input, resumeId, images, opt) {
  opt = opt || {};
  const c = conf[agent.toLowerCase()];
  // Windows 는 shell 로 실행하므로 공백 든 인자는 따옴표로 감싼다
  const q = (x) => (process.platform === 'win32' && /\s/.test(x) && !/^".*"$/.test(x) ? '"' + x + '"' : x);
  let a = c.args.map((x) => x.replace('{ROOT}', ROOT));
  // 빠른 질문은 읽기 전용: claude 는 읽기 도구만 + 기본 권한(수정·명령은 거절됨), codex 는 read-only 샌드박스
  if (opt.quick) a = agent === 'Claude'
    ? a.map((x, i) => (a[i - 1] === '--allowedTools' ? 'Read Glob Grep' : a[i - 1] === '--permission-mode' ? 'default' : x))
    : a.map((x) => (x === 'workspace-write' ? 'read-only' : x));
  // 숫자 질문(엔진 화면이 붙은 질문)은 Codex 추론을 높인다(챗봇 답변 개선 C). 웹 ⚙ 에서 정한 값이 있으면 그것이 우선
  const cm = CTL.claude_model || conf.claudeModel, xm = CTL.codex_model || conf.codexModel, xe = CTL.codex_effort || (opt.numeric ? (conf.numericEffort || 'high') : conf.codexEffort);
  if (agent === 'Claude' && cm) a = a.concat(['--model', cm]);
  if (agent === 'Codex') {
    // 옵션은 exec 바로 뒤에 넣는다(resume 앞)
    const extra = [].concat(xm ? ['-m', xm] : [], xe ? ['-c', 'model_reasoning_effort=' + xe] : []);
    if (extra.length) a = a.slice(0, 1).concat(extra, a.slice(1));
  }
  if (agent === 'Claude') {
    a = a.concat(['--output-format', 'stream-json', '--verbose']); // 줄마다 진행 이벤트, 마지막 줄이 result
    if (resumeId) a = a.concat(['--resume', resumeId]);
  }
  if (agent === 'Codex' && conf.codexJson !== false) a = a.slice(0, 1).concat(['--json'], a.slice(1)); // 줄마다 진행 이벤트
  if (agent === 'Codex' && !resumeId && images && images.length) {
    // codex exec -i 그림 … -   (새 세션에서만 이미지로 붙인다. 이어 쓰기에서는 경로만 알려 준다)
    const tail = a[a.length - 1] === '-' ? a.pop() : null;
    images.forEach((f) => a.push('-i', f));
    if (tail) a.push(tail);
  } else if (agent === 'Codex' && resumeId) {
    // codex exec [옵션] resume <세션> -   (마지막 '-' = 표준입력 프롬프트)
    a = a[a.length - 1] === '-' ? a.slice(0, -1).concat(['resume', resumeId, '-']) : a.concat(['resume', resumeId]);
  }
  const args = a.map(q);
  return new Promise((res) => {
    const bufs = [], obufs = [];
    let note = '', done = false;
    // Windows 명령창 오류는 CP949 로 나온다: UTF-8 로 깨지면 EUC-KR 로 다시 읽는다
    const dec = (bs) => { const b = Buffer.concat(bs); let t = b.toString('utf8'); if (t.includes('\uFFFD')) { try { t = new TextDecoder('euc-kr').decode(b); } catch (_) { /* ICU 없음 */ } } return t; };
    const text = () => dec(bufs) + note;
    const p = cp.spawn(c.cmd, args, { cwd: ROOT, shell: process.platform === 'win32', windowsHide: true });
    // Windows 는 shell(cmd) 아래에 실제 프로그램이 돌므로 프로세스 나무째 끊는다
    const kill = () => { if (process.platform === 'win32') cp.spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill('SIGTERM'); };
    let stopped = false;
    const timer = setTimeout(() => { if (!done) { note += '\n[중계] 시간 초과로 중단'; kill(); } }, conf.timeoutMin * 60000);
    // 웹 ■ 중지: 5초마다 중지 요청을 본다
    const watch = opt.stopId ? setInterval(async () => {
      try { const r = await getRelay(); if (!done && r && +r.stop_id === +opt.stopId) { stopped = true; note += '\n[중계] hong 요청으로 중지'; clearInterval(watch); kill(); } } catch (_) { /* 다음에 다시 */ }
    }, 5000) : null;
    // 표준출력을 줄 단위로 읽어 JSON 이벤트면 진행 요약(opt.onEvent)으로 넘긴다
    const events = [];
    let part = Buffer.alloc(0);
    const eat = (chunk, last) => {
      part = Buffer.concat([part, chunk]);
      let i;
      while ((i = part.indexOf(10)) >= 0 || (last && part.length)) {
        const line = (i >= 0 ? part.slice(0, i) : part).toString('utf8').trim();
        part = i >= 0 ? part.slice(i + 1) : Buffer.alloc(0);
        if (line[0] !== '{') continue;
        let e; try { e = JSON.parse(line); } catch (_) { continue; }
        events.push(e);
        if (opt.onEvent) { try { opt.onEvent(eventLines(agent, e)); } catch (_) { /* 요약 실패는 무시 */ } }
      }
    };
    p.stdout.on('data', (d) => { bufs.push(d); obufs.push(d); eat(d, false); });
    p.stderr.on('data', (d) => { bufs.push(d); });
    p.on('error', (e) => { note += '\n[중계] 실행 실패: ' + e.message; });
    p.on('close', (code) => {
      done = true; clearTimeout(timer); if (watch) clearInterval(watch);
      eat(Buffer.alloc(0), true);
      // claude: 마지막 result 이벤트의 result 가 답, session_id 가 세션 번호
      // codex: agent_message 들의 글이 답, thread.started 의 thread_id 가 세션 번호
      const json = agent === 'Claude' ? events.filter((e) => e.type === 'result').pop() || null : null;
      const thread = (events.find((e) => e.thread_id || e.session_id) || {});
      const msgs = events.filter((e) => e.type === 'item.completed' && e.item && /agent_message|assistant/.test(e.item.type || '') && e.item.text).map((e) => e.item.text);
      const out = text();
      let reply = json && typeof json.result === 'string' ? json.result : msgs.length ? msgs.join('\n') : '';
      if (!/<<<채널/.test(reply)) reply = deepFind(events, /<<<채널/, []).pop() || reply || out;
      res({ code, out, json, stopped, reply, thread: agent === 'Codex' ? thread.thread_id || thread.session_id || null : null });
    });
    p.stdin.on('error', (e) => { note += '\n[중계] 입력 전달 실패: ' + e.message; }); // 프로그램이 입력을 읽기 전에 끝나도 중계는 계속
    p.stdin.end(input, 'utf8'); // 프롬프트(표준입력)
  });
}

function keepLog(m, tag, out) { fs.writeFileSync(path.join(LOG_DIR, stamp().replace(/[-:T]/g, '') + '_' + m.id + '_' + tag + '.txt'), out); }

// 웹 엔진 자동 갱신: 운영본이 바뀌어 Codex 「통과」가 나오면 웹테스트\웹엔진갱신.cjs 가 웹판을 만들고 검증해 웹에 올린다.
// 중계는 10분마다 그 프로그램을 따로 띄운다(본 작업과는 따로, 자기끼리는 한 번에 하나). 「웹 엔진 갱신 다시 해줘」는 --force 로 바로 띄운다.
const ENGINE_JOB = path.join(ROOT, '웹테스트', '웹엔진갱신.cjs');
let engineRun = null;
function engineCheck(force) {
  if (engineRun || !fs.existsSync(ENGINE_JOB)) return false;
  const p = cp.spawn(process.execPath, [ENGINE_JOB].concat(force ? ['--force'] : []), { cwd: ROOT, windowsHide: true });
  let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('error', (e) => { engineRun = null; log('웹 엔진 갱신 실행 실패', e.message); });
  p.on('close', (code) => {
    engineRun = null;
    const last = out.trim().split('\n').pop() || '';
    if (force || code || !/할 일 없음|대기|건너뜀/.test(last)) log('웹 엔진 갱신 끝', 'code', code, last);
  });
  engineRun = p;
  return true;
}
async function engineLoop(once) {
  for (;;) {
    try { const ctl = await getRelay(); if (ctl && !ctl.paused) engineCheck(false); } catch (e) { log('웹 엔진 확인 오류', e.message); }
    if (once) break;
    await new Promise((r) => setTimeout(r, (conf.engineCheckMin || 10) * 60000));
  }
}
const ENGINE_RETRY = /웹\s*엔진\s*(자동\s*)?갱신[^\n]{0,10}다시/;

async function handle(m, ctl) {
  // 담당자 질문은 Claude 만 답한다(hong 11/06: Codex 는 hong 의 개발 교차검증 전용). 예전 화면에서 Codex·모두로 보낸 글도 Claude 로
  if (isMember(m) && m.recipient !== 'Claude') { log('담당자 글 #' + m.id + ' 받는이 ' + m.recipient + ' → Claude'); m.recipient = 'Claude'; }
  const quick = !!m.quick;
  if (m.sender === 'hong' && m.recipient !== 'Codex' && ENGINE_RETRY.test(m.body || '')) {
    const ok = engineCheck(true);
    await post({ sender: 'Claude', recipient: 'hong', topic: m.topic || '웹 엔진 자동 갱신', status: '안내', reply_to: m.id,
      body: ok ? '[중계] 웹 엔진 갱신을 다시 시작했습니다. 끝나면 결과를 이 채널에 올립니다(웹 자동검증까지 보통 10~20분).'
        : (fs.existsSync(ENGINE_JOB) ? '[중계] 웹 엔진 갱신이 이미 진행 중입니다. 끝나면 결과를 올립니다.' : '[중계] `웹테스트\\웹엔진갱신.cjs` 가 없어 시작하지 못했습니다.') });
    await patchMsg(m.id, { status: '답변', run_state: '완료', run_note: '웹 엔진 갱신 ' + (ok ? '시작' : '못 함') });
    log('웹 엔진 갱신 다시 요청 #' + m.id, ok ? '시작' : '못 함');
    return;
  }
  const ch = await chain(m, conf.contextMax || 30);
  const hops = hopsSinceHong(ch);
  if (hops >= ctl.max_hops) {
    const who = m.recipient === '모두' ? 'Claude' : m.recipient;
    await patchMsg(m.id, { run_state: '건너뜀', run_note: 'hong 없이 자동 왕복 ' + hops + '회' });
    await post({ sender: who, recipient: 'hong', topic: m.topic, status: '대기', reply_to: m.id,
      body: '[중계] hong 없이 Codex·Claude 가 ' + hops + '번 주고받아 자동 실행을 멈췄습니다. #' + m.id + ' 를 보고 이어갈지 정해 주세요(이 글에 답하면 다시 시작합니다).' });
    log('건너뜀 #' + m.id, '왕복', hops);
    return;
  }
  if (!quick) await setRelay({ busy_with: m.id, stop_id: null });
  await loadRequest(m, ch);
  if (m.recipient !== '모두') {
    const ctx = ch.length > 1 ? ch : (await recent(m, [m.recipient], conf.recentMax || 10)).concat([m]);
    await reqWorking(m, m.recipient);
    const r = await runAgent(m.recipient, m, ch, ctx, false, quick ? null : await rootOf(m, ch, ctx));
    await reqWorking(m, null);
    if (r.stopped) await stoppedMsg(m, m.recipient);
    else if (!r.rep) await failed(m, m.recipient, r);
    else {
      await applyProgress(m, m.recipient, r.rep.progress, r.rep.body);
      const mem = isMember(m);
      const files = await uploadOut(r.rep.fileBlocks, m, m.recipient);
      if (files.failed) r.rep.body += '\n\n(중계: 파일 ' + files.failed.join(', ') + ' 을 올리지 못했습니다. 다시 요청해 주세요.)';
      else if (!files.length && /첨부\s*파일|첨부했습니다|파일로 첨부/.test(r.rep.body)) r.rep.body += '\n\n(중계: 답에 파일 블록이 없어 첨부가 만들어지지 않았습니다. 「파일 다시 보내줘」라고 해 주세요.)';
      await post({ sender: m.recipient, recipient: mem ? '담당' : r.rep.to, topic: r.rep.topic || m.topic, status: mem ? '안내' : r.rep.st, reply_to: m.id, body: r.rep.body, files, request_id: m._req ? m._req.id : null, owner: mem ? m.owner : null });
      await patchMsg(m.id, { status: '답변', run_state: '완료', run_note: '' });
      log('완료 #' + m.id, '→', r.rep.to, r.rep.st);
    }
  } else {
    // 「모두」: Claude 가 먼저 답하고, Codex 는 그 답까지 보고 이어서 답한다(둘 다 받는이 모두 · 안내)
    let ctx = ch.length > 1 ? ch : (await recent(m, ['Claude', 'Codex'], conf.recentMax || 10)).concat([m]);
    let cur = ch, last = m, ok = 0;
    const root = quick ? null : await rootOf(m, ch, ctx);
    let stop = false;
    for (const agent of ['Claude', 'Codex']) {
      await reqWorking(m, agent);
      const r = await runAgent(agent, m, cur, ctx, true, root);
      await reqWorking(m, null);
      if (r.stopped) { stop = true; await stoppedMsg(m, agent); break; }
      if (!r.rep) { await failed(m, agent, r, last.id); continue; }
      await applyProgress(m, agent, r.rep.progress, r.rep.body);
      // Codex 가 Claude 에게 고칠 일을 남기면(받는이 Claude · 대기) 그 글만 Claude 에게 대기로 넘긴다 → 다음 차례에 Claude 가 이어 처리(왕복 한도 적용)
      const mem = isMember(m);
      const hand = !mem && agent === 'Codex' && r.rep.to === 'Claude' && r.rep.st === '대기';
      const files = await uploadOut(r.rep.fileBlocks, m, agent);
      if (files.failed) r.rep.body += '\n\n(중계: 파일 ' + files.failed.join(', ') + ' 을 올리지 못했습니다. 다시 요청해 주세요.)';
      else if (!files.length && /첨부\s*파일|첨부했습니다|파일로 첨부/.test(r.rep.body)) r.rep.body += '\n\n(중계: 답에 파일 블록이 없어 첨부가 만들어지지 않았습니다. 「파일 다시 보내줘」라고 해 주세요.)';
      const [row] = await post({ sender: agent, recipient: mem ? '담당' : hand ? 'Claude' : '모두', topic: r.rep.topic || m.topic, status: hand ? '대기' : '안내', reply_to: last.id, body: r.rep.body, files, request_id: m._req ? m._req.id : null, owner: mem ? m.owner : null });
      cur = cur.concat([row]); ctx = ctx.concat([row]); last = row; ok++;
      log('완료 #' + m.id, agent, hand ? '→ Claude(대기)' : '→ 모두');
    }
    if (!stop) await patchMsg(m.id, { status: ok ? '답변' : '대기', run_state: ok === 2 ? '완료' : '실패', run_note: ok === 2 ? '' : '일부 실패' });
  }
  if (!quick) await setRelay({ busy_with: null, stop_id: null });
}

// ■ 중지: 실행을 끊었다고 알리고 원글은 「중지」로 닫는다(새 지시는 새 글로)
async function stoppedMsg(m, agent) {
  await patchMsg(m.id, { status: '답변', run_state: '실패', run_note: '중지(hong 요청)' });
  await post({ sender: agent, recipient: 'hong', topic: m.topic, status: '안내', reply_to: m.id,
    body: '[중계] hong 요청으로 #' + m.id + ' 작업을 중지했습니다. 중간에 바뀐 파일이 있을 수 있으니 새 지시와 함께 확인을 요청해 주세요.' });
  log('중지 #' + m.id, agent);
}

async function failed(m, agent, r, replyTo) {
  const tail = r.out.trim().split(/\r?\n/).slice(-12).join('\n');
  if (isMember(m)) { // 담당자에게는 실행 기록을 보이지 않는다
    await post({ sender: agent, recipient: '담당', owner: m.owner, topic: m.topic, status: '안내', reply_to: replyTo || m.id,
      body: '[중계] ' + agent + ' 가 답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요.' });
  } else await post({ sender: agent, recipient: 'hong', topic: m.topic, status: '대기', reply_to: replyTo || m.id,
    body: '[중계] ' + agent + ' 실행이 답 형식 없이 끝났습니다(종료 코드 ' + r.code + '). 마지막 출력:\n' + tail + '\n전체 기록: 소통\\중계로그' });
  if (m.recipient !== '모두') await patchMsg(m.id, { status: '답변', run_state: '실패', run_note: '종료 코드 ' + r.code });
  log('실패 #' + m.id, agent, 'code', r.code);
}

// 한 담당을 실행한다. 같은 답글 사슬에서 쓰던 세션이 있으면 못 본 글만 넘겨 이어 쓰고, 안 되면 새 세션 + 글 흐름 전체
// 이 글이 속한 대화의 첫 글 번호(세션 열쇠). 답글이면 사슬의 첫 글, 답글이 아니어도 직전 글과 joinMin 분 안이면 그 대화를 잇는다.
// 이어 붙인 관계는 중계세션.json 의 roots 에 남긴다(나중 답글도 같은 세션으로 가도록)
async function rootOf(m, ch, ctx) {
  const all = loadSess(), roots = all.roots || (all.roots = {});
  let root = m.id;
  if (ch.length > 1) root = roots[ch[0].id] || ch[0].id;
  else {
    const prev = ctx.length > 1 ? ctx[ctx.length - 2] : null;
    if (prev && new Date(m.at) - new Date(prev.at) < conf.joinMin * 60000) {
      const pc = await chain(prev, conf.contextMax || 30);
      root = roots[pc[0].id] || pc[0].id;
    }
  }
  roots[m.id] = root;
  saveSess(all);
  return root;
}

// ⚡ 빠른 질문 머리말: 읽기 전용, 지금 진행 중인 작업과 오늘 중계 기록 끝부분을 알려 준다(「지금 뭐 해?」에 답할 수 있게)
async function quickHead(m) {
  if (isMember(m)) return '';
  let busy = '';
  try { if (CTL.busy_with) { const b = await getMsg(CTL.busy_with); if (b) busy = '#' + b.id + ' ' + b.sender + ' → ' + b.recipient + ' (' + (b.run_note || '') + ' 실행 중): ' + b.body.slice(0, 300); } } catch (_) { /* 없음 */ }
  let tail = '';
  try { tail = fs.readFileSync(path.join(LOG_DIR, stamp().slice(0, 10) + '.log'), 'utf8').trim().split(/\r?\n/).slice(-12).join('\n'); } catch (_) { /* 없음 */ }
  return ['[빠른 질문] 이 실행은 진행 중인 다른 작업과 따로 도는 읽기 전용 실행이다. 파일을 고치거나 명령을 실행하지 말고, 필요한 파일만 읽어 짧게 답한다.',
    '지금 진행 중인 작업: ' + (busy || '없음'), '오늘 중계 기록 끝부분:', tail || '(없음)', '', ''].join('\n');
}

// ── 숫자 답 검산(챗봇 답변 개선 C, hong 11-04) ──
// 답의 <<<근거 블록을 엔진 계산 화면과 대조한다. 틀린 근거·근거 없는 숫자가 있으면 같은 세션에 한 번 고치게 하고,
// 그래도 남으면 답 끝에 「확인 못 한 숫자」를 적는다. 맞으면 답 끝에 근거 화면을 짧게 붙인다.
function checkText(r) { return String(r.reply || ''); } // 최종 답 글(실행 출력 전체는 JSON 으로 이스케이프돼 있어 쓰지 않는다)
function verdict(dirs, r, rep) { return KS.check(dirs, checkText(r), rep.body); }
function problems(v) {
  return v.bad.map((b) => b.raw + ' — ' + b.why).concat(v.unbacked.filter((u) => !v.bad.some((b) => b.raw === u)).map((u) => u + ' — 근거 줄 없음'));
}
async function numCheck(agent, m, r, rep, sid, opt, sink) {
  const dirs = scrDirs(m);
  rep.body = KS.stripBasis(rep.body);
  let v = verdict(dirs, r, rep), probs = problems(v), tries = 0;
  log('검산 #' + m.id, agent, '근거', v.basis.length, '맞음', v.checked, '문제', probs.length);
  while (probs.length && tries < (conf.checkRetry == null ? 1 : conf.checkRetry)) {
    tries++;
    sink.add([{ k: 'tool', s: '검산: 엔진 화면과 다른 숫자 ' + probs.length + '개 → 다시 확인' }]);
    const fix = ['[중계 검산] 방금 답의 숫자를 엔진 계산 화면과 대조했더니 아래가 맞지 않거나 근거가 없다:',
      ...probs.slice(0, 20).map((x) => '- ' + x),
      '',
      '화면 파일(' + dirs.join(' , ') + ')에서 다시 찾아 고친다. 행·열을 잘못 본 것이면 맞는 칸의 값으로, 직접 셈한 값이면 화면 값으로 바꾸거나 「계산」 근거를 적는다. 끝내 못 찾으면 본문에 「확인 못 함」이라고 쓴다.',
      '고친 답 전체를 앞과 같은 형식으로 다시 출력한다: <<<근거 … 근거>>> 다음에 <<<채널 … 채널>>>.'].join('\n');
    const r2 = await run(agent, sid ? fix : (prompt(agent, m, [m], false) + '\n\n' + fix + '\n\n[앞 답]\n' + rep.body), sid, null, opt);
    keepLog(m, agent + '_검산' + tries, r2.out);
    if (r2.stopped) break;
    const rep2 = parseReply(r2.reply, agent);
    if (!rep2) break;
    rep2.body = KS.stripBasis(rep2.body);
    const v2 = verdict(dirs, r2, rep2), p2 = problems(v2);
    log('검산 다시 #' + m.id, agent, '근거', v2.basis.length, '맞음', v2.checked, '문제', p2.length);
    sid = sessionOf(agent, r2) || sid;
    if (p2.length <= probs.length) { rep = Object.assign(rep2, { fileBlocks: rep2.fileBlocks.length ? rep2.fileBlocks : rep.fileBlocks }); v = v2; probs = p2; }
  }
  if (probs.length) rep.body += '\n\n> ⚠ 검산: 엔진 화면에서 확인하지 못한 숫자 — ' + probs.slice(0, 8).map((x) => x.split(' — ')[0]).join(', ') + (probs.length > 8 ? ' 외 ' + (probs.length - 8) + '개' : '') + '. 이 숫자는 그대로 쓰기 전에 화면에서 확인해 주세요.';
  else if (v.checked) rep.body += '\n\n> 🔎 검산: 숫자 ' + v.checked + '개가 엔진 화면과 맞습니다' + (v.wheres.length ? ' (' + v.wheres.slice(0, 3).join(' · ') + (v.wheres.length > 3 ? ' 외' : '') + ')' : '') + '.';
  return { rep, sid };
}

async function runAgent(agent, m, ch, ctx, group, root) {
  await patchMsg(m.id, { run_state: '실행중', run_note: agent });
  const sink = liveSink(m, agent);
  const quick = !!m.quick, opt = { quick, stopId: quick ? null : m.id, onEvent: (xs) => sink.add(xs) };
  const all = loadSess(), key = agent + ':' + root;
  let s = conf.resume && !quick ? all[key] : null; // 빠른 질문은 세션을 잇지도 남기지도 않는다
  if (s && (s.turns >= conf.sessionTurns || Date.now() - new Date(s.at).getTime() > conf.sessionDays * 864e5)) { log('새 세션(길이·기간 한도)', key); s = null; }
  // 세션이 아직 못 본 글: 이 사슬 + 앞 맥락(직전 대화) 중 마지막으로 본 글 뒤의 것
  const seenIds = new Set();
  const fresh = s ? ctx.concat(ch).filter((x) => x.id > s.lastId && !seenIds.has(x.id) && seenIds.add(x.id)).sort((a, b) => a.id - b.id) : null;
  await fetchFiles(ctx.concat(fresh || []));
  await fetchCtx(m, ch, sink);
  opt.numeric = scrDirs(m).length > 0;
  const imgs = (m._local || []).filter((f) => isImg(f) && fs.existsSync(f));
  let r, rep, resumed = false;
  if (s && fresh.length) {
    log('실행 #' + m.id, agent, '세션 이어 쓰기', s.id, '새 글', fresh.length);
    r = await run(agent, followUp(agent, m, fresh, group), s.id, null, opt);
    if (r.stopped) { await sink.end(); keepLog(m, agent + '_중지', r.out); return r; }
    rep = parseReply(r.reply, agent);
    resumed = !!rep;
    if (!rep) { log('이어 쓰기 실패 #' + m.id, 'code', r.code, '→ 새 세션으로 다시'); keepLog(m, agent + '_이어쓰기실패', r.out); }
  }
  if (!resumed) {
    log('실행 #' + m.id, agent, '새 세션');
    r = await run(agent, (quick ? await quickHead(m) : '') + prompt(agent, m, ctx, group), null, imgs, opt);
    if (r.stopped) { await sink.end(); keepLog(m, agent + '_중지', r.out); return r; }
    rep = parseReply(r.reply, agent);
  }
  keepLog(m, agent, r.out);
  let sid = sessionOf(agent, r) || (resumed ? s.id : null);
  if (rep && opt.numeric) {
    const v = await numCheck(agent, m, r, rep, sid, opt, sink);
    rep = v.rep; if (v.sid) sid = v.sid;
  }
  await sink.end();
  if (rep && sid && conf.resume && !quick) {
    all[key] = { id: sid, turns: (resumed ? s.turns : 0) + 1, lastId: Math.max(...ctx.concat(ch).map((x) => x.id)), at: new Date().toISOString() };
    saveSess(all);
  }
  return Object.assign(r, { rep });
}

// 두 갈래를 따로 처리한다: quick=false 는 본 작업(한 번에 하나), quick=true 는 ⚡ 빠른 질문(본 작업과 따로)
async function tick(quick) {
  const ctl = await getRelay();
  if (!ctl || ctl.paused) return;
  const q = '?select=*&status=eq.' + encodeURIComponent('대기') + '&run_state=is.null&quick=is.' + quick + '&recipient=in.(Codex,Claude,' + encodeURIComponent('모두') + ')&order=at.asc&limit=1';
  const [m] = await api('GET', 'sk_channel', q);
  if (m) await handle(m, ctl);
}
// 새 대기 글이 올라오면 Realtime 이 바로 깨운다(wake). 주기 확인(pollSec·8초)은 연결이 끊겼을 때를 위한 예비
const wakers = new Set();
function wake() { for (const w of [...wakers]) w(); }
async function loop(quick, sec, once) {
  for (;;) {
    try { await tick(quick); } catch (e) { log('오류', quick ? '(빠른 질문)' : '', e.message); }
    if (once) break;
    await new Promise((r) => { let w; const t = setTimeout(() => { wakers.delete(w); r(); }, sec * 1000); w = () => { clearTimeout(t); wakers.delete(w); r(); }; wakers.add(w); });
  }
}

// ── Realtime(웹소켓): sk_channel 에 대기 글이 생기면 즉시 tick. migration 012. Node 22 이상(전역 WebSocket)에서만, 아니면 주기 확인만 ──
function realtime() {
  if (typeof WebSocket === 'undefined') { log('Realtime 없음(Node', process.version, ') → 주기 확인만'); return; }
  let ws, hb, ref = 0, tokSent = null, backoff = 5;
  const send = (topic, event, payload) => { try { ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) })); } catch (_) {} };
  const TOPIC = 'realtime:sk_channel_relay';
  const open = async () => {
    try { if (!auth.tok || Date.now() > auth.exp) await login(); } catch (e) { log('Realtime 로그인 오류', e.message); }
    ws = new WebSocket(URL_.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + KEY + '&vsn=1.0.0');
    ws.onopen = () => {
      tokSent = auth.tok;
      send(TOPIC, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'sk_channel' }], private: false }, access_token: auth.tok });
      hb = setInterval(async () => {
        send('phoenix', 'heartbeat', {});
        // 토큰이 갱신되면 Realtime 에도 알려 준다(만료되면 알림이 끊긴다)
        try { if (Date.now() > auth.exp) await login(); } catch (_) {}
        if (auth.tok !== tokSent) { tokSent = auth.tok; send(TOPIC, 'access_token', { access_token: auth.tok }); }
      }, 25000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.event === 'phx_reply' && m.topic === TOPIC && m.payload) {
        if (m.payload.status === 'ok') { if (backoff !== 5) log('Realtime 다시 연결됨'); else log('Realtime 연결됨(새 글 즉시 처리)'); backoff = 5; }
        else log('Realtime 가입 실패', JSON.stringify(m.payload.response || {}).slice(0, 200));
      }
      if (m.event === 'postgres_changes') {
        const r = (m.payload && m.payload.data && m.payload.data.record) || {};
        if (r.status === '대기' && !r.run_state && ['Codex', 'Claude', '모두'].includes(r.recipient)) wake();
      }
    };
    ws.onclose = () => { clearInterval(hb); setTimeout(open, backoff * 1000); backoff = Math.min(backoff * 2, 300); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  };
  open();
}

(async () => {
  await login();
  log('중계 시작', auth.email, '폴더', ROOT);
  log('codex =', conf.codex.cmd, '· claude =', conf.claude.cmd);
  // 지난번 실행 중에 꺼진 글은 실패로 표시(다시 돌리려면 웹에서 새 글로 요청)
  for (const m of await api('GET', 'sk_channel', '?select=id&run_state=eq.' + encodeURIComponent('실행중'))) {
    await patchMsg(m.id, { run_state: '실패', run_note: '중계가 실행 중에 꺼짐' });
  }
  try { await api('PATCH', 'sk_requests', '?working=not.is.null', { working: null }); } catch (_) { /* 옛 DB(작업 중 칸 없음)면 무시 */ }
  await setRelay({ busy_with: null, stop_id: null });
  const once = process.argv.includes('--once');
  // 신호는 따로 30초마다(긴 작업 중에도 웹에 「작동 중」으로 보이게)
  const beat = () => setRelay({ heartbeat: new Date().toISOString() }).catch((e) => log('신호 오류', e.message));
  await beat();
  if (!once) setInterval(beat, 30000);
  realUsage().catch(() => {}); if (!once) setInterval(() => realUsage().catch(() => {}), 3600000);
  if (!once) realtime();
  await Promise.all([loop(false, conf.pollSec, once), loop(true, 8, once), engineLoop(once)]);
})().catch((e) => { log('중단', e.message); process.exit(1); });
