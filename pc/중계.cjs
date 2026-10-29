#!/usr/bin/env node
// 소통 중계 — 웹 「소통」(sk_channel)에서 Codex·Claude 앞 「대기」 글을 찾아 PC의 codex exec / claude -p 로 실행하고 답을 올린다.
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
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const URL_ = 'https://znqaxyqayxkgqnqnwyez.supabase.co';
const KEY = 'sb_publishable_2dCd3uLHA80B3hY_DflgKA_xMtj4Itl'; // 공개 키. 접근은 로그인 + RLS
const ROOT = path.resolve(__dirname, '..'); // 손익추정시스템
const LOGIN = process.env.SONIK_CODEX_LOGIN || path.join(os.homedir(), '.sonik-codex.json');
const CONF_PATH = path.join(__dirname, '중계설정.json');
const LOG_DIR = path.join(__dirname, '중계로그');
const SESS_PATH = path.join(__dirname, '중계세션.json');
const ATT_DIR = path.join(__dirname, '첨부');
const REQ_DIR = path.join(__dirname, '요청'); // 수정요청 원문(항목·셀·메모·화면 캡처)을 요청 번호별로 풀어 두는 곳
const STAGES = ['접수', '검토', '수정', '검증', '반영']; // 웹에서 올린 이미지·파일을 글 번호별로 내려받는 곳
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
  if (!r.ok) throw new Error(method + ' ' + table + ' ' + r.status + ': ' + t);
  return t ? JSON.parse(t) : null;
}
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
  while (cur.reply_to && out.length < max) { cur = await getMsg(cur.reply_to); if (!cur) break; out.unshift(cur); }
  return out;
}
// 답글이 아닌 새 글이면, 그 전에 hong 과 이 담당이 나눈 최근 글을 앞 맥락으로 붙인다
async function recent(m, agents, n) {
  const who = '(hong,' + agents.join(',') + ')';
  const q = '?select=*&id=lt.' + m.id + '&sender=in.' + who + '&recipient=in.' + encodeURIComponent('(hong,' + agents.join(',') + ',모두)') + '&order=id.desc&limit=' + n;
  return (await api('GET', 'sk_channel', q)).reverse();
}
// 마지막 hong 글 이후 Codex·Claude 끼리 이어진 글 수
function hopsSinceHong(ch) { let n = 0; for (let i = ch.length - 1; i >= 0 && ch[i].sender !== 'hong'; i--) n++; return n; }

// ── 세션 기록: { "Claude:12": { id, turns, lastId, at } } (12 = 답글 사슬의 첫 글) ──
function loadSess() { try { return JSON.parse(fs.readFileSync(SESS_PATH, 'utf8')); } catch (_) { return {}; } }
function saveSess(all) {
  const old = Date.now() - 14 * 864e5;
  for (const k of Object.keys(all)) if (all[k].at && new Date(all[k].at).getTime() < old) delete all[k];
  fs.writeFileSync(SESS_PATH, JSON.stringify(all, null, 1));
}
// 실행 출력에서 세션 번호를 찾는다: claude 는 --output-format json 의 session_id, codex 는 머리말의 "session id: …"
function sessionOf(agent, r) {
  if (agent === 'Claude') return r.json && r.json.session_id || null;
  const x = r.out.match(/session id:\s*([0-9a-f-]{36})/i);
  return x ? x[1] : null;
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
          fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
        }
        m._local.push(to);
      } catch (e) { log('첨부 받기 실패 #' + m.id, f.name, e.message); m._local.push(to + ' (받기 실패: ' + e.message + ')'); }
    }
  }
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
      '- 스냅샷 기준월 ' + (r.base_ym || '-') + ' · 엔진 ' + (r.engine_ver || '-') + ' · 지금 단계: ' + (r.status === '보류' ? '보류' : STAGES[r.stage || 0]), ''];
    if (r.body) L.push('## 설명', '', r.body, '');
    (r.items || []).forEach((it, i) => {
      const loc = it.loc || {};
      L.push('## 항목 ' + (i + 1), '', '- 위치: ' + [loc.zone, loc.site, loc.menu, (loc.subs || []).join(' > '), loc.ym, loc.table].filter(Boolean).join(' · ') + (it.kind === 'area' ? ' (영역 지정)' : ''));
      (it.cells || []).forEach((c) => L.push('- 셀 ' + (c.row || '') + ' / ' + (c.col || '') + ' = ' + (c.value == null ? '' : c.value) + (c.note ? '  → 메모: ' + c.note : '')));
      if (it.note) L.push('- 메모: ' + it.note);
      if (it.texts && it.texts.length) L.push('- 영역 글자: ' + it.texts.slice(0, 80).join(' | '));
      if (it.excerpt && it.excerpt.rows) L.push('', '표 발췌:', '', ...it.excerpt.rows.slice(0, 40).map((row) => '| ' + row.map((v) => String(v == null ? '' : v).replace(/\|/g, '/')).join(' | ') + ' |'));
      const im = /^data:image\/(png|jpeg);base64,(.+)$/.exec(it.image || '');
      if (im) { const f = path.join(dir, '항목' + (i + 1) + '.' + (im[1] === 'jpeg' ? 'jpg' : 'png')); fs.writeFileSync(f, Buffer.from(im[2], 'base64')); L.push('', '화면 캡처: ' + f); }
      L.push('');
    });
    const file = path.join(dir, '요청.md');
    fs.writeFileSync(file, L.join('\n'));
    m._req = { id, title: r.title, stage: r.stage, status: r.status, file };
  } catch (e) { log('요청 읽기 실패 #' + id, e.message); }
}
// 답의 「진행:」 줄을 요청의 단계·설명(progress)에 적는다
async function applyProgress(m, agent, pg) {
  if (!m._req || !pg) return;
  try {
    const [r] = await api('GET', 'sk_requests', '?select=stage,status,progress&id=eq.' + m._req.id);
    const stage = pg.step === '보류' ? (r.stage || 0) : STAGES.indexOf(pg.step);
    const status = pg.step === '보류' ? '보류' : stage === 4 ? '완료' : '진행';
    const progress = (r.progress || []).concat([{ at: new Date().toISOString(), stage, text: '[' + agent + '] ' + pg.text }]);
    await api('PATCH', 'sk_requests', '?id=eq.' + m._req.id, { stage, status, progress, updated_at: new Date().toISOString() });
    m._req.stage = stage; m._req.status = status;
    log('요청 #' + m._req.id, pg.step, pg.text);
  } catch (e) { log('요청 진행 기록 실패 #' + m._req.id, e.message); }
}
const isImg = (p) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);

function prompt(agent, m, ch, group) {
  const other = agent === 'Codex' ? 'Claude' : 'Codex';
  const role = agent === 'Codex'
    ? '너는 Codex(검증 담당)다. AGENTS.md 와 ../협업규칙.md §5 를 따른다.'
    : '너는 Claude(빌드 담당)다. AGENTS.md 와 ../협업규칙.md §4 를 따른다.';
  return [
    role,
    '작업 폴더: ' + ROOT + ' . 시작 전에 AGENTS.md 를 읽는다.',
    '아래는 웹 「소통」 채널의 글 흐름이다(마지막 글이 너에게 온 요청).',
    '',
    ch.map(fmt).join('\n\n'),
    '',
    group ? '이 대화는 hong·Claude·Codex 셋이 함께 하는 대화(받는이 모두)다. Claude 가 먼저 답하고 Codex 가 Claude 의 답까지 보고 이어서 답한다. 상대 답에 덧붙이거나 다른 의견을 내되 같은 말은 되풀이하지 않는다.' : '',
    '할 일: ' + (group ? 'hong 의 글(#' + m.id + ')' : '마지막 글(#' + m.id + ')') + '의 요청을 처리한다. 긴 결과는 지금처럼 검증자료\\vNNN\\ 등 파일에 쓰고 채널에는 요약과 경로만 남긴다.',
    '되돌리기 어려운 일(운영본 교체·보관 이동·파일 삭제·외부 전송)은 하지 말고 받는이를 hong 으로 해서 확인을 요청한다.',
    ...reqLines(m),
    '다른 담당에게 넘길 일이 있으면 받는이를 ' + other + ' 로, hong 이 결정할 일이면 hong 으로 한다.',
    '',
    '마지막에 채널에 올릴 답을 정확히 아래 형식으로 출력한다(이 블록만 채널에 올라간다):',
    '<<<채널',
    group ? '받는이: 모두' : '받는이: hong 또는 ' + other,
    group ? '상태: 안내' : '상태: 대기 또는 안내   (받는이가 답하거나 처리해야 하면 대기, 알리기만 하면 안내)',
    '주제: ' + (m.topic || '짧은 제목'),
    '(본문 15줄 이내)',
    '채널>>>',
  ].join('\n');
}

// 수정요청에 관한 대화면: 요청 원문 위치, 진행 단계를 적는 「진행:」 줄 안내
function reqLines(m) {
  const q = m._req;
  if (!q) return [];
  return ['',
    '이 대화는 웹 수정요청 #' + q.id + ' 에 관한 것이다(제목: ' + q.title + ' · 지금 단계: ' + (q.status === '보류' ? '보류' : STAGES[q.stage || 0]) + ').',
    '요청 원문(항목 위치·고른 셀과 값·메모·화면 캡처 그림): ' + q.file + '  — 먼저 읽는다. 그림 파일은 같은 폴더에 있다.',
    '엔진 수정은 AGENTS.md 의 버전 흐름(새 번호, 10초본·일반본, 검증자료, Codex 교차검증 통과)을 따르고, 「반영」은 통과 뒤에만 쓴다.',
    '답 블록 안에 진행 줄을 하나 넣으면 웹 요청 목록의 진행 막대와 설명이 바뀐다(hong 이 읽는 쉬운 한 문장):',
    '진행: 검토|수정|검증|반영|보류 - 설명'];
}

// 이어 쓰는 세션에는 그 세션이 아직 못 본 글만 넘긴다
function followUp(agent, m, fresh, group) {
  const other = agent === 'Codex' ? 'Claude' : 'Codex';
  return [
    '웹 「소통」 채널에 이 대화의 새 글이 올라왔다(마지막 글이 너에게 온 요청).',
    '',
    fresh.map(fmt).join('\n\n'),
    '',
    group ? '이 글은 셋이 함께 하는 대화(받는이 모두)다. Claude 가 먼저, Codex 가 이어서 답한다. 같은 말은 되풀이하지 않는다.' : '',
    '할 일: ' + (group ? 'hong 의 글(#' + m.id + ')' : '마지막 글(#' + m.id + ')') + '의 요청을 처리한다. 앞에서와 같은 규칙(AGENTS.md, 되돌리기 어려운 일은 hong 확인)을 따른다.',
    ...reqLines(m),
    '마지막에 채널에 올릴 답을 앞에서와 같은 형식으로 출력한다:',
    '<<<채널',
    group ? '받는이: 모두' : '받는이: hong 또는 ' + other,
    group ? '상태: 안내' : '상태: 대기 또는 안내',
    '주제: ' + (m.topic || '짧은 제목'),
    '(본문 15줄 이내)',
    '채널>>>',
  ].join('\n');
}

function parseReply(out, agent) {
  const all = [...String(out).matchAll(/<<<채널\s*\r?\n([\s\S]*?)\r?\n\s*채널>>>/g)];
  if (!all.length) return null;
  const blk = all[all.length - 1][1];
  const get = (k) => { const x = blk.match(new RegExp('^\\s*' + k + '\\s*:\\s*(.+)$', 'm')); return x ? x[1].trim() : ''; };
  let to = get('받는이'); if (!['hong', 'Codex', 'Claude'].includes(to) || to === agent) to = 'hong';
  let st = get('상태').split(/\s/)[0]; if (!['대기', '안내'].includes(st)) st = '대기';
  const body = blk.split(/\r?\n/).filter((l) => !/^\s*(받는이|상태|주제|진행)\s*:/.test(l)).join('\n').trim();
  const pg = get('진행').match(/^(검토|수정|검증|반영|보류)\s*[-–—:·]?\s*(.*)$/);
  return { to, st, topic: get('주제'), body, progress: pg ? { step: pg[1], text: pg[2].trim() || body.split('\n')[0] } : null };
}

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
  const cm = CTL.claude_model || conf.claudeModel, xm = CTL.codex_model || conf.codexModel, xe = CTL.codex_effort || conf.codexEffort;
  if (agent === 'Claude' && cm) a = a.concat(['--model', cm]);
  if (agent === 'Codex') {
    // 옵션은 exec 바로 뒤에 넣는다(resume 앞)
    const extra = [].concat(xm ? ['-m', xm] : [], xe ? ['-c', 'model_reasoning_effort=' + xe] : []);
    if (extra.length) a = a.slice(0, 1).concat(extra, a.slice(1));
  }
  if (agent === 'Claude') {
    a = a.concat(['--output-format', 'json']);
    if (resumeId) a = a.concat(['--resume', resumeId]);
  } else if (!resumeId && images && images.length) {
    // codex exec -i 그림 … -   (새 세션에서만 이미지로 붙인다. 이어 쓰기에서는 경로만 알려 준다)
    const tail = a[a.length - 1] === '-' ? a.pop() : null;
    images.forEach((f) => a.push('-i', f));
    if (tail) a.push(tail);
  } else if (resumeId) {
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
    p.stdout.on('data', (d) => { bufs.push(d); obufs.push(d); });
    p.stderr.on('data', (d) => { bufs.push(d); });
    p.on('error', (e) => { note += '\n[중계] 실행 실패: ' + e.message; });
    p.on('close', (code) => {
      done = true; clearTimeout(timer); if (watch) clearInterval(watch);
      // claude --output-format json: 표준출력 마지막 JSON 의 result 가 답, session_id 가 세션 번호
      let json = null;
      if (agent === 'Claude') { const so = dec(obufs).trim(); try { json = JSON.parse(so.slice(so.lastIndexOf('\n{') + 1)); } catch (_) { try { json = JSON.parse(so); } catch (_) { /* 형식 밖 출력 */ } } }
      const out = text();
      res({ code, out, json, stopped, reply: json && typeof json.result === 'string' ? json.result : out });
    });
    p.stdin.on('error', (e) => { note += '\n[중계] 입력 전달 실패: ' + e.message; }); // 프로그램이 입력을 읽기 전에 끝나도 중계는 계속
    p.stdin.end(input, 'utf8'); // 프롬프트(표준입력)
  });
}

function keepLog(m, tag, out) { fs.writeFileSync(path.join(LOG_DIR, stamp().replace(/[-:T]/g, '') + '_' + m.id + '_' + tag + '.txt'), out); }

async function handle(m, ctl) {
  const quick = !!m.quick;
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
    const r = await runAgent(m.recipient, m, ch, ctx, false, quick ? null : await rootOf(m, ch, ctx));
    if (r.stopped) await stoppedMsg(m, m.recipient);
    else if (!r.rep) await failed(m, m.recipient, r);
    else {
      await applyProgress(m, m.recipient, r.rep.progress);
      await post({ sender: m.recipient, recipient: r.rep.to, topic: r.rep.topic || m.topic, status: r.rep.st, reply_to: m.id, body: r.rep.body, request_id: m._req ? m._req.id : null });
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
      const r = await runAgent(agent, m, cur, ctx, true, root);
      if (r.stopped) { stop = true; await stoppedMsg(m, agent); break; }
      if (!r.rep) { await failed(m, agent, r, last.id); continue; }
      await applyProgress(m, agent, r.rep.progress);
      const [row] = await post({ sender: agent, recipient: '모두', topic: r.rep.topic || m.topic, status: '안내', reply_to: last.id, body: r.rep.body, request_id: m._req ? m._req.id : null });
      cur = cur.concat([row]); ctx = ctx.concat([row]); last = row; ok++;
      log('완료 #' + m.id, agent, '→ 모두');
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
  await post({ sender: agent, recipient: 'hong', topic: m.topic, status: '대기', reply_to: replyTo || m.id,
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
async function quickHead() {
  let busy = '';
  try { if (CTL.busy_with) { const b = await getMsg(CTL.busy_with); if (b) busy = '#' + b.id + ' ' + b.sender + ' → ' + b.recipient + ' (' + (b.run_note || '') + ' 실행 중): ' + b.body.slice(0, 300); } } catch (_) { /* 없음 */ }
  let tail = '';
  try { tail = fs.readFileSync(path.join(LOG_DIR, stamp().slice(0, 10) + '.log'), 'utf8').trim().split(/\r?\n/).slice(-12).join('\n'); } catch (_) { /* 없음 */ }
  return ['[빠른 질문] 이 실행은 진행 중인 다른 작업과 따로 도는 읽기 전용 실행이다. 파일을 고치거나 명령을 실행하지 말고, 필요한 파일만 읽어 짧게 답한다.',
    '지금 진행 중인 작업: ' + (busy || '없음'), '오늘 중계 기록 끝부분:', tail || '(없음)', '', ''].join('\n');
}

async function runAgent(agent, m, ch, ctx, group, root) {
  await patchMsg(m.id, { run_state: '실행중', run_note: agent });
  const quick = !!m.quick, opt = { quick, stopId: quick ? null : m.id };
  const all = loadSess(), key = agent + ':' + root;
  let s = conf.resume && !quick ? all[key] : null; // 빠른 질문은 세션을 잇지도 남기지도 않는다
  if (s && (s.turns >= conf.sessionTurns || Date.now() - new Date(s.at).getTime() > conf.sessionDays * 864e5)) { log('새 세션(길이·기간 한도)', key); s = null; }
  // 세션이 아직 못 본 글: 이 사슬 + 앞 맥락(직전 대화) 중 마지막으로 본 글 뒤의 것
  const seenIds = new Set();
  const fresh = s ? ctx.concat(ch).filter((x) => x.id > s.lastId && !seenIds.has(x.id) && seenIds.add(x.id)).sort((a, b) => a.id - b.id) : null;
  await fetchFiles(ctx.concat(fresh || []));
  const imgs = (m._local || []).filter((f) => isImg(f) && fs.existsSync(f));
  let r, rep, resumed = false;
  if (s && fresh.length) {
    log('실행 #' + m.id, agent, '세션 이어 쓰기', s.id, '새 글', fresh.length);
    r = await run(agent, followUp(agent, m, fresh, group), s.id, null, opt);
    if (r.stopped) { keepLog(m, agent + '_중지', r.out); return r; }
    rep = parseReply(r.reply, agent);
    resumed = !!rep;
    if (!rep) { log('이어 쓰기 실패 #' + m.id, 'code', r.code, '→ 새 세션으로 다시'); keepLog(m, agent + '_이어쓰기실패', r.out); }
  }
  if (!resumed) {
    log('실행 #' + m.id, agent, '새 세션');
    r = await run(agent, (quick ? await quickHead() : '') + prompt(agent, m, ctx, group), null, imgs, opt);
    if (r.stopped) { keepLog(m, agent + '_중지', r.out); return r; }
    rep = parseReply(r.reply, agent);
  }
  keepLog(m, agent, r.out);
  const sid = sessionOf(agent, r) || (resumed ? s.id : null);
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
async function loop(quick, sec, once) {
  for (;;) {
    try { await tick(quick); } catch (e) { log('오류', quick ? '(빠른 질문)' : '', e.message); }
    if (once) break;
    await new Promise((r) => setTimeout(r, sec * 1000));
  }
}

(async () => {
  await login();
  log('중계 시작', auth.email, '폴더', ROOT);
  log('codex =', conf.codex.cmd, '· claude =', conf.claude.cmd);
  // 지난번 실행 중에 꺼진 글은 실패로 표시(다시 돌리려면 웹에서 새 글로 요청)
  for (const m of await api('GET', 'sk_channel', '?select=id&run_state=eq.' + encodeURIComponent('실행중'))) {
    await patchMsg(m.id, { run_state: '실패', run_note: '중계가 실행 중에 꺼짐' });
  }
  await setRelay({ busy_with: null, stop_id: null });
  const once = process.argv.includes('--once');
  // 신호는 따로 30초마다(긴 작업 중에도 웹에 「작동 중」으로 보이게)
  const beat = () => setRelay({ heartbeat: new Date().toISOString() }).catch((e) => log('신호 오류', e.message));
  await beat();
  if (!once) setInterval(beat, 30000);
  await Promise.all([loop(false, conf.pollSec, once), loop(true, 8, once)]);
})().catch((e) => { log('중단', e.message); process.exit(1); });
