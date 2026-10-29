#!/usr/bin/env node
// 소통 중계 — 웹 「소통」(sk_channel)에서 Codex·Claude 앞 「대기」 글을 찾아 PC의 codex exec / claude -p 로 실행하고 답을 올린다.
// hong 이 무인 자동 방식을 직접 골랐다(2026-10-30, 프로젝트 대화방 결정 카드). 웹 「멈춤」으로 언제든 세운다.
// PC 위치: 손익추정시스템\소통\중계.cjs  (실행: node 소통\중계.cjs  · 한 번만: node 소통\중계.cjs --once)
// 로그인: 사용자 폴더 .sonik-codex.json (채널.cjs 와 같은 Codex 에이전트 계정, sk_agents.can_relay = true)
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
const getRelay = async () => (await api('GET', 'sk_relay', '?select=*&id=eq.1'))[0];
const setRelay = (v) => api('PATCH', 'sk_relay', '?id=eq.1', Object.assign({ updated_at: new Date().toISOString() }, v));

// ── 글 흐름: 답글 사슬을 거슬러 올라간다 ─────────────
async function chain(m, max) {
  const out = [m];
  let cur = m;
  while (cur.reply_to && out.length < max) { cur = await getMsg(cur.reply_to); if (!cur) break; out.unshift(cur); }
  return out;
}
// 답글이 아닌 새 글이면, 그 전에 hong 과 이 담당이 나눈 최근 글을 앞 맥락으로 붙인다
async function recent(m, agent, n) {
  const who = '(hong,' + agent + ')';
  const q = '?select=*&id=lt.' + m.id + '&sender=in.' + who + '&recipient=in.' + encodeURIComponent('(hong,' + agent + ',모두)') + '&order=id.desc&limit=' + n;
  return (await api('GET', 'sk_channel', q)).reverse();
}
// 마지막 hong 글 이후 Codex·Claude 끼리 이어진 글 수
function hopsSinceHong(ch) { let n = 0; for (let i = ch.length - 1; i >= 0 && ch[i].sender !== 'hong'; i--) n++; return n; }

const fmt = (m) => '#' + m.id + ' ' + m.sender + ' → ' + m.recipient + (m.topic ? ' · ' + m.topic : '') + ' · ' + m.status + '\n' + m.body;

function prompt(agent, m, ch) {
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
    '할 일: 마지막 글(#' + m.id + ')의 요청을 처리한다. 긴 결과는 지금처럼 검증자료\\vNNN\\ 등 파일에 쓰고 채널에는 요약과 경로만 남긴다.',
    '되돌리기 어려운 일(운영본 교체·보관 이동·파일 삭제·외부 전송)은 하지 말고 받는이를 hong 으로 해서 확인을 요청한다.',
    '다른 담당에게 넘길 일이 있으면 받는이를 ' + other + ' 로, hong 이 결정할 일이면 hong 으로 한다.',
    '',
    '마지막에 채널에 올릴 답을 정확히 아래 형식으로 출력한다(이 블록만 채널에 올라간다):',
    '<<<채널',
    '받는이: hong 또는 ' + other,
    '상태: 대기 또는 안내   (받는이가 답하거나 처리해야 하면 대기, 알리기만 하면 안내)',
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
  const body = blk.split(/\r?\n/).filter((l) => !/^\s*(받는이|상태|주제)\s*:/.test(l)).join('\n').trim();
  return { to, st, topic: get('주제'), body };
}

function run(agent, text) {
  const c = conf[agent.toLowerCase()];
  // Windows 는 shell 로 실행하므로 공백 든 인자는 따옴표로 감싼다
  const q = (x) => (process.platform === 'win32' && /\s/.test(x) && !/^".*"$/.test(x) ? '"' + x + '"' : x);
  const args = c.args.map((a) => q(a.replace('{ROOT}', ROOT)));
  return new Promise((res) => {
    const bufs = [];
    let note = '', done = false;
    // Windows 명령창 오류는 CP949 로 나온다: UTF-8 로 깨지면 EUC-KR 로 다시 읽는다
    const text = () => { const b = Buffer.concat(bufs); let t = b.toString('utf8'); if (t.includes('\uFFFD')) { try { t = new TextDecoder('euc-kr').decode(b); } catch (_) { /* ICU 없음 */ } } return t + note; };
    const p = cp.spawn(c.cmd, args, { cwd: ROOT, shell: process.platform === 'win32', windowsHide: true });
    const timer = setTimeout(() => { if (!done) { note += '\n[중계] 시간 초과로 중단'; p.kill(); } }, conf.timeoutMin * 60000);
    p.stdout.on('data', (d) => { bufs.push(d); });
    p.stderr.on('data', (d) => { bufs.push(d); });
    p.on('error', (e) => { note += '\n[중계] 실행 실패: ' + e.message; });
    p.on('close', (code) => { done = true; clearTimeout(timer); res({ code, out: text() }); });
    p.stdin.end(text);
  });
}

async function handle(m, ctl) {
  const agent = m.recipient;
  const ch = await chain(m, conf.contextMax || 30);
  const ctx = ch.length > 1 ? ch : (await recent(m, agent, conf.recentMax || 10)).concat([m]);
  const hops = hopsSinceHong(ch);
  if (hops >= ctl.max_hops) {
    await patchMsg(m.id, { run_state: '건너뜀', run_note: 'hong 없이 자동 왕복 ' + hops + '회' });
    await post({ sender: agent, recipient: 'hong', topic: m.topic, status: '대기', reply_to: m.id,
      body: '[중계] hong 없이 Codex·Claude 가 ' + hops + '번 주고받아 자동 실행을 멈췄습니다. #' + m.id + ' 를 보고 이어갈지 정해 주세요(이 글에 답하면 다시 시작합니다).' });
    log('건너뜀 #' + m.id, '왕복', hops);
    return;
  }
  await patchMsg(m.id, { run_state: '실행중', run_note: '' });
  await setRelay({ busy_with: m.id });
  log('실행 #' + m.id, agent);
  const r = await run(agent, prompt(agent, m, ctx));
  fs.writeFileSync(path.join(LOG_DIR, stamp().replace(/[-:T]/g, '') + '_' + m.id + '_' + agent + '.txt'), r.out);
  const rep = parseReply(r.out, agent);
  if (!rep) {
    const tail = r.out.trim().split(/\r?\n/).slice(-12).join('\n');
    await post({ sender: agent, recipient: 'hong', topic: m.topic, status: '대기', reply_to: m.id,
      body: '[중계] ' + agent + ' 실행이 답 형식 없이 끝났습니다(종료 코드 ' + r.code + '). 마지막 출력:\n' + tail + '\n전체 기록: 소통\\중계로그' });
    await patchMsg(m.id, { status: '답변', run_state: '실패', run_note: '종료 코드 ' + r.code });
    log('실패 #' + m.id, 'code', r.code);
  } else {
    await post({ sender: agent, recipient: rep.to, topic: rep.topic || m.topic, status: rep.st, reply_to: m.id, body: rep.body });
    await patchMsg(m.id, { status: '답변', run_state: '완료', run_note: '' });
    log('완료 #' + m.id, '→', rep.to, rep.st);
  }
  await setRelay({ busy_with: null });
}

async function tick() {
  await setRelay({ heartbeat: new Date().toISOString() });
  const ctl = await getRelay();
  if (!ctl || ctl.paused) return;
  const q = '?select=*&status=eq.' + encodeURIComponent('대기') + '&run_state=is.null&recipient=in.(Codex,Claude)&order=at.asc&limit=1';
  const [m] = await api('GET', 'sk_channel', q);
  if (m) await handle(m, ctl);
}

(async () => {
  await login();
  log('중계 시작', auth.email, '폴더', ROOT);
  log('codex =', conf.codex.cmd, '· claude =', conf.claude.cmd);
  // 지난번 실행 중에 꺼진 글은 실패로 표시(다시 돌리려면 웹에서 새 글로 요청)
  for (const m of await api('GET', 'sk_channel', '?select=id&run_state=eq.' + encodeURIComponent('실행중'))) {
    await patchMsg(m.id, { run_state: '실패', run_note: '중계가 실행 중에 꺼짐' });
  }
  await setRelay({ busy_with: null });
  const once = process.argv.includes('--once');
  for (;;) {
    try { await tick(); } catch (e) { log('오류', e.message); }
    if (once) break;
    await new Promise((r) => setTimeout(r, conf.pollSec * 1000));
  }
})().catch((e) => { log('중단', e.message); process.exit(1); });
