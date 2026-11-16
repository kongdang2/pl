#!/usr/bin/env node
// 웹 엔진 자동 갱신 — 오프라인 운영본이 새 번호로 Codex 「통과」를 받으면, 그 위에 웹 연결을 얹은 웹 시험판(vNNN-1)을 만들고
// 웹 자동검증(quick)을 통과한 경우에만 빈 엔진을 만들어 웹(Supabase)의 「현재 엔진」으로 올린다. hong 결정(2026-10-30, 소통 스레드).
// PC 위치: 손익추정시스템\웹테스트\웹엔진갱신.cjs   (소통\중계.cjs 가 10분마다 부른다. 직접: node 웹테스트\웹엔진갱신.cjs [--force] [--dry])
// 단계: ① AGENTS.md 의 운영본 줄 → 기반 vNNN  ② 검증자료\vNNN\교차검증.md 「통과」 확인  ③ 웹 현재 엔진이 이미 vNNN-n 이면 끝
//       ④ 웹연결패치.py 로 웹판 생성(v312까지 10초·일반 두 파일, v313부터 운영본 한 파일. 이미 있으면 그대로)  ⑤ 웹 자동검증 extra 사본을 오프라인 extra 에 맞춤
//       ⑥ 웹 연결 검사(runner --web-only: 웹 연결·스크립트 구문·재무손익 항등식·메뉴 열기만, FAIL·ERROR 0 이어야 다음 단계)
//          (2026-11-06 hong 결정 카드 「웹 연결 검사만」: 엔진 계산은 오프라인 운영본에서 Codex 가 전체 검사했으므로 웹판은 웹 연결 부분만 본다)  ⑦ 브라우저로 빈 엔진 생성·검사  ⑧ 웹 업로드(새 엔진을 올린 뒤 현재 엔진을 바꾼다)
//       ⑨ 이전 웹판을 보관\vOLD\ 로 옮기고, 검증자료\vNNN-1\ 기록, README·AGENTS 의 「현재 웹판」 줄 갱신  ⑩ 소통 채널에 결과 안내
// 실패하면 웹 엔진은 그대로 두고 채널로 hong 에게 알린다. 같은 운영본으로는 다시 시도하지 않는다(--force 로 다시).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), zlib = require('zlib'), crypto = require('crypto');

const URL_ = 'https://znqaxyqayxkgqnqnwyez.supabase.co';
const KEY = 'sb_publishable_2dCd3uLHA80B3hY_DflgKA_xMtj4Itl'; // 공개 키. 접근은 로그인 + RLS(중계 계정)
const WEB = __dirname;                     // 손익추정시스템\웹테스트
const ROOT = path.resolve(WEB, '..');      // 손익추정시스템
const LOGIN = process.env.SONIK_CODEX_LOGIN || path.join(os.homedir(), '.sonik-codex.json');
const STATE = path.join(WEB, '웹엔진갱신상태.json');
const force = process.argv.includes('--force'), dry = process.argv.includes('--dry');
// --ver vNNN-n: 같은 번호 r 보정판(v314 r2 등)을 새 웹판 번호로 올릴 때(--force 와 함께). 없으면 기반+'-1'
const verArg = (() => { const i = process.argv.indexOf('--ver'); return i > 0 ? process.argv[i + 1] : null; })();

const p2 = (n) => String(n).padStart(2, '0');
const now = new Date(), YMD = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()), DAY = YMD.slice(0, 4) + '-' + YMD.slice(4, 6) + '-' + YMD.slice(6);
const lines = [];
function log(...a) { const l = '[' + new Date().toLocaleString('sv-SE') + '] ' + a.join(' '); console.log(l); lines.push(l); }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── Supabase(REST) ──
const auth = { tok: null, email: '' };
async function login() {
  const { email, password } = JSON.parse(fs.readFileSync(LOGIN, 'utf8').replace(/^\uFEFF/, ''));
  const r = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error('로그인 실패: ' + (j.error_description || j.msg || r.status));
  auth.tok = j.access_token; auth.email = String(j.user.email).toLowerCase();
}
async function api(method, table, q, body, prefer) {
  const r = await fetch(URL_ + '/rest/v1/' + table + (q || ''), { method, headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(method + ' ' + table + ' ' + r.status + ': ' + t);
  return t ? JSON.parse(t) : null;
}
async function post(body, status) {
  if (dry) { log('[채널 글 생략(--dry)]', body.split('\n')[0]); return; }
  const row = { sender: 'Claude', recipient: 'hong', topic: '웹 엔진 자동 갱신', status: status || '안내', body: '[웹 엔진 자동 갱신] ' + body, author_email: auth.email };
  // 2026-11-05: 긴 검사 뒤 첫 요청이 끊긴 연결로 「fetch failed」가 나면 한 번 더 보낸다(진짜 결과가 가려지지 않게)
  try { await api('POST', 'sk_channel', '', row); } catch (e) { await new Promise((r) => setTimeout(r, 3000)); await api('POST', 'sk_channel', '', row); }
}

function run(cmd, args, label) {
  log('실행', label || cmd, args.join(' '));
  // node 는 지금 이 프로그램을 돌리는 node(Playwright 가 있는 쪽)를 셸 없이, python 은 셸로(Windows 의 py 실행 별칭) 부른다
  const sh = process.platform === 'win32' && cmd !== process.execPath;
  const r = cp.spawnSync(cmd, sh ? args.map(q) : args, { cwd: ROOT, encoding: 'utf8', shell: sh, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, out };
}
const q = (x) => (process.platform === 'win32' && /\s/.test(x) ? '"' + x + '"' : x);

// 웹 자동검증 extra 사본 = 오프라인 extra(파일명 -n 인식) + 끝의 「웹 연결」 검사 블록(README)
function syncExtra() {
  const off = fs.readFileSync(path.join(ROOT, '자동검증_실행용', 'extra.cjs'), 'utf8');
  const webPath = path.join(WEB, '자동검증', 'extra.cjs'), web = fs.readFileSync(webPath, 'utf8');
  const mark = web.indexOf('// ── [v307-1 웹 시험판]');
  if (mark < 0) throw new Error('웹 extra.cjs 에서 「웹 연결」 검사 블록 표시를 찾지 못했습니다');
  const body = off.split('_v(\\d+)[_.]').join('_v(\\d+)(?:-\\d+)?[_.]').replace(/\};\s*$/, '');
  // 웹 블록 뒤에 붙은 오프라인 버전 블록(// ── v3NN: … / // ── v3NN 제목 …)은 body 에 이미 있으므로 잘라 낸다(v313 중복 선언으로 웹 검증이 멈춘 원인).
  // 2026-11-05(Codex #423): 콜론 없는 「// ── v321 보고서…」 머리를 못 잘라 SR321_SYNTH 가 두 번 선언됐다 → 버전 번호 뒤 공백·콜론 모두 경계로 본다
  const tail = web.slice(mark), dup = tail.search(/\n\/\/ ── v\d+[\s:]/);
  const next = body + (dup < 0 ? tail : tail.slice(0, dup) + '\n};\n');
  if (next === web) { log('웹 extra 사본은 오프라인과 같음'); return false; }
  try { new (require('vm').Script)('(async function(){' + next.replace(/^'use strict';/, '').replace('module.exports=', 'const __extra=') + '\n})'); }
  catch (e) { throw new Error('웹 extra 합성 결과 문법 오류(사본을 바꾸지 않음): ' + e.message); }
  if (!dry) { fs.copyFileSync(webPath, path.join(WEB, '자동검증', 'extra_' + YMD + '_갱신전.cjs')); fs.writeFileSync(webPath, next); }
  log('웹 extra 사본을 오프라인 extra 에 맞춤', sha(next).slice(0, 8));
  return true;
}

// 웹판 10초에서 빈 엔진을 만든다(관리자 도구 「빈 엔진 다운로드」와 같은 함수)
async function emptyEngine(file) {
  const { playwright } = require(path.join(WEB, '자동검증', 'lib.cjs'));
  const browser = await playwright().chromium.launch({ channel: 'chrome', headless: true });
  try {
    const c = await browser.newContext();
    await c.route(/^https?:/, (r) => r.abort());
    const p = await c.newPage();
    p.on('dialog', (d) => d.dismiss());
    await p.goto(require('url').pathToFileURL(file).href);
    await p.waitForFunction(() => typeof S === 'object' && typeof __buildEngineHtml === 'function', null, { timeout: 180000 });
    return await p.evaluate(() => __buildEngineHtml({ embedData: false, emptyEngine: true, stripAdminBar: false }));
  } finally { await browser.close(); }
}
function checkEmpty(html) { // 웹 「빈 엔진 올리기」와 같은 검사(engine-loader.js checkEmptyEngine)
  const errs = [];
  if (!/window\.__EMPTY_ENGINE__\s*=\s*true/.test(html)) errs.push('빈 엔진 표시 없음');
  for (const id of ['__SAVED_DATA__', '__SAVED_CONFIRMED__', '__SAVED_PLAN__', '__SAVED_VERSIONS__', '__LINK_STAMP__']) if (new RegExp('<script[^>]*id=["\']' + id + '["\']').test(html)) errs.push('데이터 블록 ' + id);
  if (html.indexOf('__sonikWebBridge') < 0) errs.push('웹 연결 없음');
  const m = /window\.SYS_CHANGELOG\s*=\s*\[\s*\{date:'[^']*',title:'(v\d+(?:-\d+)?)/.exec(html);
  return { errs, ver: m ? m[1] : null };
}

async function upload(html, ver, note) {
  const gz = zlib.gzipSync(Buffer.from(html, 'utf8')), h = sha(Buffer.from(html, 'utf8'));
  const sp = 'engines/' + ver + '_' + h.slice(0, 8) + '.html.gz';
  const r = await fetch(URL_ + '/storage/v1/object/sonik/' + sp, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok, 'Content-Type': 'application/gzip', 'x-upsert': 'false' }, body: gz });
  // 같은 내용이 이미 있으면(경로에 sha 앞 8자) 올린 것으로 본다. Supabase 저장소는 이것을 HTTP 400 + 본문 statusCode "409" 로 돌려준다(2026-11-05 #434)
  if (!r.ok) { const t = await r.text(); if (r.status !== 409 && !/"statusCode"\s*:\s*"409"|KeyAlreadyExists|Duplicate/.test(t)) throw new Error('엔진 파일 올리기 실패 ' + r.status + ': ' + t); log('엔진 파일이 이미 있음(같은 내용) → 그대로 씀', sp); }
  // 새 엔진을 먼저 등록(현재 아님) → 기존 현재 해제 → 새 엔진을 현재로. 중간에 끊겨도 「현재 엔진 없음」이 되지 않게 기존 해제는 등록 뒤에 한다
  await api('POST', 'sk_engines', '', { ver, storage_path: sp, size_bytes: Buffer.byteLength(html), sha256: h, is_current: false, uploaded_by: auth.email, uploaded_at: new Date().toISOString(), note }, 'resolution=merge-duplicates,return=representation');
  await api('PATCH', 'sk_engines', '?is_current=eq.true', { is_current: false });
  await api('PATCH', 'sk_engines', '?ver=eq.' + encodeURIComponent(ver), { is_current: true });
  return { sp, h, gz: gz.length };
}

// README·AGENTS 의 「현재 웹판」 표기를 새 웹판으로. 바꾸는 곳: README 「지금은」 줄·만들기 명령 두 줄·보관 표 한 줄, AGENTS 웹 시험판 줄(그 밖의 옛 번호 기록은 그대로)
function localWebVer() { // PC 에 있는 「현재 웹판」(README 「지금은」). 웹에 올라간 엔진과 다를 수 있다(전에는 hong 이 손으로 올림)
  try { const m = /지금은 `(v\d+-\d+)`/.exec(fs.readFileSync(path.join(WEB, 'README.md'), 'utf8')); return m ? m[1] : null; } catch (_) { return null; }
}
function updateDocs(oldLocal, ver, basever, base10, baseG, web10, moved) {
  const fileDay = (/_(\d{8})\.html$/.exec(web10) || [0, YMD])[1], D = fileDay.slice(0, 4) + '-' + fileDay.slice(4, 6) + '-' + fileDay.slice(6);
  const rp = path.join(WEB, 'README.md');
  let t = fs.readFileSync(rp, 'utf8');
  t = t.replace(/지금은 `[^`]+`\([^)\n]*\)/, '지금은 `' + ver + '`(오프라인 ' + basever + ' + 웹 연결, ' + D + ', 웹 반영 ' + DAY + ' 자동 갱신)');
  t = t.replace(/^python -I 웹테스트\/.*$/m, 'python -I 웹테스트/웹연결패치.py --ver ' + ver + ' --basever ' + basever + ' --date ' + fileDay + (baseG ? ' --base10 ' + base10 + ' --base ' + baseG : ' --base ' + base10) + ' --out 웹테스트');
  t = t.replace(/^node 웹테스트\/자동검증\/runner\.cjs .*$/m, 'node 웹테스트/자동검증/runner.cjs --project 웹테스트 --mode quick --web-only --plan-year 2027 --file 웹테스트/' + web10 + ' --out 웹테스트/자동검증/runs/<날짜>-' + ver);
  if (moved && t.indexOf('`보관\\' + oldLocal + '\\`') < 0) t = t.replace(/(\| `보관\\v[^\n]*\n)(?!\| `보관)/, '$1| `보관\\' + oldLocal + '\\` | 이전 웹판(' + oldLocal + ', ' + DAY + ' 자동 갱신 때 이동) |\n');
  if (!dry) fs.writeFileSync(rp, t);
  const ap = path.join(ROOT, 'AGENTS.md');
  const a = fs.readFileSync(ap, 'utf8').split('\n');
  const i = a.findIndex((l) => /웹 시험판\(별도 관리/.test(l));
  const lv = i >= 0 ? (/현재 (v\d+-\d+)/.exec(a[i]) || [])[1] : null;
  if (lv && lv !== ver) {
    a[i] = a[i].replace(new RegExp('웹연결_' + lv.replace('-', '\\-') + '_\\d{8}', 'g'), '웹연결_' + ver + '_' + fileDay).split(lv).join(ver).replace(/\(현재 (v\d+-\d+), [\d-]+\)/, '(현재 $1, ' + D + ')');
    if (!dry) fs.writeFileSync(ap, a.join('\n'));
  }
}

// 수정요청 단계: 웹 현재 엔진에 운영본이 들어가면, 그 버전 SYS_CHANGELOG 첫 항목 제목의 「웹 요청 #3·#4」 요청을 「반영」으로 올린다(중계는 대화에 「진행:」 줄이 있을 때만 단계를 올린다).
// 실패하면 표시를 남기지 않아 다음 확인(10분 뒤) 때 다시 한다. 이미 반영·보류인 요청은 건드리지 않는다.
function requestIdsOf(file, basever) {
  const m = /window\.SYS_CHANGELOG\s*=\s*\[\s*\{date:'[^']*',title:'([^']*)'/.exec(fs.readFileSync(file, 'utf8'));
  if (!m || !m[1].startsWith(basever)) throw new Error('SYS_CHANGELOG 첫 항목이 ' + basever + ' 가 아닙니다');
  const seg = /(?:웹\s*요청|수정요청)\s*((?:#\d+[·,\s]*)+)/.exec(m[1]);
  return seg ? seg[1].match(/\d+/g).map(Number) : [];
}
async function markRequests(basever, ver, base10, st, saveState) {
  if (st.reqMarked === basever) return;
  try {
    for (const id of requestIdsOf(path.join(ROOT, base10), basever)) {
      const [r] = await api('GET', 'sk_requests', '?select=stage,status,progress&id=eq.' + id);
      if (!r) { log('수정요청 #' + id, '없음 → 건너뜀'); continue; }
      if (r.stage >= 4 || r.status === '보류') { log('수정요청 #' + id, r.status, '→ 그대로'); continue; }
      if (dry) { log('[수정요청 단계 생략(--dry)] #' + id, '→ 반영'); continue; }
      const at = new Date().toISOString();
      const progress = (r.progress || []).concat([{ at, stage: 4, text: '[자동] ' + basever + ' Codex 교차검증 통과, 웹 엔진 ' + ver + ' 반영 완료' }]);
      const done = await api('PATCH', 'sk_requests', '?id=eq.' + id, { stage: 4, status: '완료', progress, updated_at: at });
      if (!done || !done.length) throw new Error('#' + id + ' 고칠 권한이 없습니다');
      log('수정요청 #' + id, '반영으로 올림');
    }
    saveState({ reqMarked: basever });
  } catch (e) { log('수정요청 단계 올리기 실패', e.message); }
}

// 동시 실행 잠금(hong #238): 두 실행이 겹치면 늦게 끝난 쪽이 처음에 읽은 옛 상태로 상태 파일을 덮고 잘못된 실패 글을 올린다(2026-11-02 #233).
// 잠금 파일이 있고 그 pid 가 살아 있으며 3시간 안이면 건너뛴다. 아니면 남은 잠금으로 보고 지운 뒤 잡는다. 상태 파일은 잠금을 잡은 뒤에 읽는다.
const LOCK = path.join(WEB, '웹엔진갱신.lock');
let locked = false;
function takeLock() {
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let o = {};
      try { o = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (_) {}
      let alive = false;
      try { process.kill(o.pid, 0); alive = true; } catch (er) { alive = er.code === 'EPERM'; }
      if (alive && Date.now() - Date.parse(o.at) < 3 * 3600000) { log('다른 갱신이 실행 중(pid', o.pid + ',', o.at + ') → 건너뜀'); return false; }
      log('남은 잠금 정리(pid', o.pid, o.at, ')');
      try { fs.unlinkSync(LOCK); } catch (_) {}
    }
  }
  return false;
}

(async () => {
  locked = takeLock();
  if (!locked) return;
  const st = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) { return {}; } })();
  const saveState = (v) => { if (!dry) fs.writeFileSync(STATE, JSON.stringify(Object.assign(st, v, { at: new Date().toISOString() }), null, 1)); };
  // ① 운영본
  const ag = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  // v312까지: 운영본 = 10초본(일반본은 이름에서 「10초_」를 뺀 것). v313부터(hong 10/30): 일반본 없이 운영본 한 파일(손익추정_<내용>_vNNN_날짜.html)
  const m = /운영본\(현 기준 최종본\)\s*=\s*(손익추정_\S+?_v(\d+)_\d{8}\.html)/.exec(ag);
  if (!m) throw new Error('AGENTS.md 에서 운영본 줄을 찾지 못했습니다');
  const base10 = m[1], NNN = +m[2], basever = 'v' + NNN, two = base10.startsWith('손익추정_10초_'), baseG = two ? base10.replace('손익추정_10초_', '손익추정_') : null;
  for (const f of [base10, baseG].filter(Boolean)) if (!fs.existsSync(path.join(ROOT, f))) throw new Error('운영본 파일 없음: ' + f);
  // ② Codex 통과
  const cx = path.join(ROOT, '검증자료', basever, '교차검증.md');
  const cxt = fs.existsSync(cx) ? fs.readFileSync(cx, 'utf8') : '';
  // 판정 줄 = 첫 줄(「통과 · 검증: Codex · 날짜 …」). 본문의 1차 보류 기록은 보지 않는다
  const verdict = (cxt.replace(/^\uFEFF/, '').split('\n').find((l) => l.trim()) || '').trim();
  if (!/^통과/.test(verdict)) { log('운영본', basever, '교차검증 첫 줄이 「통과」가 아님(' + (verdict.slice(0, 30) || '파일 없음') + ') → 대기'); return; }
  // ③ 웹 현재 엔진
  await login();
  const [cur] = await api('GET', 'sk_engines', '?select=ver,uploaded_at&is_current=eq.true');
  // 현재 엔진이 안 보이면(중계 계정 권한 011 이 없을 때 등) 아무것도 하지 않는다. 웹에는 늘 현재 엔진이 하나 있다
  if (!cur) { log('웹 현재 엔진을 읽지 못함(권한 확인: supabase/011_relay_engines.sql) → 대기'); return; }
  const curVer = cur ? cur.ver : null, curBase = curVer ? +(/^v(\d+)/.exec(curVer) || [0, 0])[1] : 0;
  // 번호 크기가 아니라 「운영본 번호와 같은가」로 본다(hong 11-08: v344 가 먼저 운영본이 되고 v344 위에 만든 v343 이 다음 운영본 → 번호가 더 작아도 갱신)
  if (curBase === NNN && !force) { await markRequests(basever, curVer, base10, st, saveState); log('웹 엔진', curVer, '이 운영본', basever, '과 같은 버전 → 할 일 없음'); return; }
  if (st.failed === base10 && !force) { log('이 운영본으로 지난번에 실패함(', st.reason, ') → 건너뜀. 다시 하려면 --force'); return; }
  const ver = verArg || basever + '-1';
  if (verArg && !/^v\d+-\d+$/.test(verArg) || verArg && !verArg.startsWith(basever + '-')) throw new Error('--ver ' + verArg + ' 는 ' + basever + '-n 꼴이어야 합니다');
  log('웹 엔진 갱신 시작:', curVer || '(없음)', '→', ver, '(운영본', base10 + ')');
  const fail = async (step, why, extra) => {
    log('실패', step, why);
    saveState({ failed: base10, reason: step + ': ' + why });
    await post(ver + ' 만들기를 「' + step + '」 단계에서 멈췄습니다. 웹 엔진은 ' + (curVer || '그대로') + ' 를 계속 씁니다.\n\n- **이유**: ' + why + (extra ? '\n- **기록**: `' + extra + '`' : '') + '\n\n고친 뒤 다시 하려면 Claude 에게 「웹 엔진 갱신 다시 해줘」라고 보내 주세요.', '대기');
  };
  try {
    // ④ 웹판 생성
    const dir = path.join(WEB, '검증자료', ver);
    fs.mkdirSync(dir, { recursive: true });
    const WP = two ? '손익추정_10초_웹연결_' : '손익추정_웹연결_';
    const have = fs.readdirSync(WEB).find((x) => x.startsWith(WP + ver + '_') && x.endsWith('.html'));
    let web10 = have, webG = have && two ? have.replace('손익추정_10초_', '손익추정_') : null;
    if (!have) {
      const r = run('python', ['-I', path.join(WEB, '웹연결패치.py'), '--ver', ver, '--basever', basever, '--date', YMD].concat(two ? ['--base10', base10, '--base', baseG] : ['--base', base10], ['--out', WEB]), '웹연결패치.py');
      fs.writeFileSync(path.join(dir, 'patch_출력.txt'), r.out);
      if (r.code !== 0) return await fail('웹 연결 패치', '웹연결패치.py 종료 코드 ' + r.code + ' — ' + r.out.trim().split('\n').slice(-3).join(' / '), '웹테스트\\검증자료\\' + ver + '\\patch_출력.txt');
      web10 = WP + ver + '_' + YMD + '.html'; webG = two ? '손익추정_웹연결_' + ver + '_' + YMD + '.html' : null;
      fs.copyFileSync(path.join(WEB, '웹연결패치.py'), path.join(dir, 'patch.py'));
    } else log('이미 있는 웹판을 씀:', web10);
    // ⑤ extra 사본
    const synced = syncExtra();
    // ⑥ 웹 연결 검사(--web-only)
    const runDir = path.join('웹테스트', '자동검증', 'runs', YMD + '-' + ver);
    const t = run(process.execPath, [path.join('웹테스트', '자동검증', 'runner.cjs'), '--project', '웹테스트', '--mode', 'quick', '--web-only', '--plan-year', '2027', '--file', path.join('웹테스트', web10), '--out', runDir], '웹 연결 검사');
    const cnt = (k) => (t.out.match(new RegExp('^' + k + ' ', 'gm')) || []).length;
    const counts = { PASS: cnt('PASS'), FAIL: cnt('FAIL'), ERROR: cnt('ERROR'), UNVERIFIED: cnt('UNVERIFIED') };
    const webTests = (t.out.match(/^PASS \S+ 웹 /gm) || []).length;
    fs.writeFileSync(path.join(dir, 'quick_출력.txt'), t.out);
    log('웹 quick', JSON.stringify(counts), 'code', t.code);
    if (t.code !== 0 || counts.FAIL || counts.ERROR || !counts.PASS || !webTests) return await fail('웹 연결 검사', 'PASS ' + counts.PASS + ' / FAIL ' + counts.FAIL + ' / ERROR ' + counts.ERROR, runDir + '\\검증결과.html');
    // ⑦ 빈 엔진
    const html = await emptyEngine(path.join(WEB, web10));
    const ck = checkEmpty(html);
    if (ck.errs.length || ck.ver !== ver) return await fail('빈 엔진 검사', (ck.errs.join(', ') || '') + (ck.ver !== ver ? ' 버전 ' + ck.ver + ' ≠ ' + ver : ''));
    // ⑧ 업로드
    let up = { sp: '(--dry)', h: sha(Buffer.from(html, 'utf8')), gz: 0 };
    if (!dry) up = await upload(html, ver, 'sonik_empty_engine_' + ver + '.html (웹엔진갱신.cjs 자동)');
    log('웹 업로드', up.sp, up.h.slice(0, 8));
    // ⑨ 정리·기록
    // 이전 웹판(PC 의 README 기준)을 보관으로. 이미 보관에 같은 것이 있으면 건너뛴다(업로드는 끝났으므로 여기서는 멈추지 않는다)
    const oldLocal = localWebVer(), oldVer = oldLocal && oldLocal !== ver ? oldLocal : null;
    let moved = false;
    if (oldVer && !dry) {
      try {
        const arc = path.join(WEB, '보관', oldVer);
        fs.mkdirSync(arc, { recursive: true });
        for (const x of fs.readdirSync(WEB)) if (x.includes('_웹연결_' + oldVer + '_') && x.endsWith('.html') && !fs.existsSync(path.join(arc, x))) { fs.renameSync(path.join(WEB, x), path.join(arc, x)); moved = true; }
        const od = path.join(WEB, '검증자료', oldVer), oa = path.join(arc, '검증자료_' + oldVer);
        if (fs.existsSync(od) && !fs.existsSync(oa)) { fs.renameSync(od, oa); moved = true; }
      } catch (e) { log('이전 웹판 보관 이동 일부 실패', e.message); }
    }
    // 기록: 이미 손으로 만든 기록이 있으면 덮지 않고 「자동갱신_」 이름으로 따로 쓴다
    const rec = (n) => path.join(dir, fs.existsSync(path.join(dir, n)) ? '자동갱신_' + n : n);
    const h10 = sha(fs.readFileSync(path.join(WEB, web10))), hG = webG ? sha(fs.readFileSync(path.join(WEB, webG))) : null;
    fs.writeFileSync(rec('변경내역.md'), ['# ' + ver + ' 변경내역 (웹 시험판, ' + DAY + ', 자동 갱신)', '',
      '- 기반: 오프라인 운영본 ' + basever + ' (' + base10 + ' ' + sha(fs.readFileSync(path.join(ROOT, base10))).slice(0, 8) + '…' + (baseG ? ' / ' + baseG + ' ' + sha(fs.readFileSync(path.join(ROOT, baseG))).slice(0, 8) + '…' : '') + ', 교차검증 「통과」)',
      '- 얹은 것: 웹 연결(window.__sonikWebBridge, 웹 안에서 저장 → sonik:save, DB 내보내기 sysVer) — 웹테스트\\웹연결패치.py. 계산·데이터·<title>·script 블록 수 불변.',
      '- 결과: ' + web10 + ' (' + h10.slice(0, 8) + '…)' + (webG ? ', ' + webG + ' (' + hG.slice(0, 8) + '…)' : '')].join('\n') + '\n');
    fs.writeFileSync(rec('검증결과.md'), ['# ' + ver + ' 검증결과 (웹 시험판, ' + DAY + ', 웹엔진갱신.cjs 자동)', '',
      '데이터 머리: 엔진만 교체(오프라인 ' + basever + ' 운영본 데이터 그대로). 웹판은 정규화 전까지 Codex 교차검증 대상 아님(웹테스트\\README.md).', '',
      '| 항목 | 값 |', '|---|---|',
      '| ' + web10 + ' | ' + h10 + ' |'].concat(webG ? ['| ' + webG + ' | ' + hG + ' |'] : [], [
      '| 웹 연결 검사(--web-only) | PASS ' + counts.PASS + ' (웹 연결 ' + webTests + '건)' + ' / FAIL 0 / ERROR 0 / UNVERIFIED ' + counts.UNVERIFIED + ' — ' + runDir + ' |',
      '| 웹 extra 사본 | ' + (synced ? '오프라인 extra 에 맞춤(이전 사본 extra_' + YMD + '_갱신전.cjs)' : '변경 없음') + ' |',
      '| 빈 엔진(웹 업로드) | ' + up.h + ' · ' + up.sp + ' |',
      '| 이전 웹 엔진(웹) | ' + (curVer || '없음') + ' |', '| 이전 웹판 파일(PC) | ' + (oldVer ? oldVer + (moved ? ' → 웹테스트\\보관\\' + oldVer + '\\' : ' (옮길 것 없음)') : '없음') + ' |', '',
      '결론: 웹 시험판 ' + ver + ' 를 웹 현재 엔진으로 올림. 사업계획 웹판은 만들지 않았다(필요하면 웹판에서 [📘 사업계획 시스템 다운로드]).']).join('\n') + '\n');
    try { updateDocs(oldVer, ver, basever, base10, baseG, web10, moved); } catch (e) { log('README·AGENTS 갱신 실패', e.message); }
    saveState({ failed: null, reason: null, done: base10, ver });
    await markRequests(basever, ver, base10, st, saveState);
    fs.writeFileSync(path.join(dir, '웹엔진갱신.log'), lines.join('\n') + '\n');
    await post('웹 엔진을 **' + ver + '** 로 바꿨습니다(운영본 ' + basever + ' + 웹 연결).\n\n- **웹 연결 검사**: PASS ' + counts.PASS + ' (웹 연결 ' + webTests + '건)' + ' / FAIL 0 / 미검증 ' + counts.UNVERIFIED + '\n- **이전 웹 엔진**: ' + (curVer || '없음') + (moved ? '\n- **이전 웹판 파일**: `웹테스트\\보관\\' + oldVer + '\\`' : '') + '\n- **기록**: `웹테스트\\검증자료\\' + ver + '\\`\n\n웹에서 Ctrl+F5 로 새로고침하면 새 엔진으로 열립니다. 스냅샷은 그대로 쓸 수 있습니다.');
    log('끝');
  } catch (e) { await fail('실행 중 오류', e.message); }
})().catch((e) => { log('중단', e.message); process.exitCode = 1; })
  .finally(() => { if (locked) try { fs.unlinkSync(LOCK); } catch (_) {} });
