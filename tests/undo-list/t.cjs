// node tests/undo-list/t.cjs — 웹 화면에서 되돌리기 목록 ▾(엔진 v400 #undoListBtn400)이 ↶ ↷ 옆에 보이고 눌리는지
// hong 11-19 「오른쪽에 ▼버튼이 없는디?」: 웹이 머리줄을 숨기며 ↶ ↷ 인쇄만 위 줄로 옮겨 ▾ 가 숨은 머리줄에 남았다
// 가짜 엔진·가짜 Supabase(tests/two-window 것 재사용). 실데이터 없음
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), TW = path.join(REPO, 'tests/two-window'), HONG = 'kongdang2@gmail.com';
const now = () => new Date().toISOString();
// 엔진 안에 ① 기본 동작을 막지 않은 <a href="#"> ② 주소 조각(#)을 바꾸는 단추 — 둘 다 사람이 누르면 브라우저 기록이 하나 더 쌓인다
const eng = fs.readFileSync(TW + '/engine.html', 'utf8').replace('<div id="v">engine</div>',
  '<div id="dbAdminBar" style="display:flex;"><button>DB</button><span style="flex:1;"></span><button id="pnlDbQuickBtn">월별손익DB</button></div>'
  + '<div id="appHeader"><div id="appHeaderTools"><button id="undoBtn">↶</button><button id="redoBtn">↷</button>'
  + '<button id="undoListBtn400" onclick="window.__listOpened=(window.__listOpened||0)+1">▾</button>'
  + '<button onclick="printCurrentMenu()">인쇄</button></div></div><div id="v">engine</div>'
  + '<script>function printCurrentMenu(){}<\/script>');
const DB = { sk_members: [{ email: HONG, name: 'hong', role: 'admin' }], sk_engines: [], sk_snapshots: [], sk_snapshot_revs: [], sk_log: [] };
const FILES = { 'engines/e.html.gz': zlib.gzipSync(eng) };
DB.sk_engines.push({ ver: 'v319-1', storage_path: 'engines/e.html.gz', sha256: crypto.createHash('sha256').update(eng).digest('hex'), is_current: true, uploaded_at: now() });
const S0 = { session: { name: 't', baseYm: '2026-11', baseYear: 2026, months: [{ ym: '2026-11', type: 'estimate', active: true }] },
  onsan: { sales: { '2026-11': [{ prod: 'MEG', qty: 20 }] }, purchase: {}, prices: { fx: 1400 } }, ulsan: { sales: {}, purchase: {} }, sysLog: [] };
FILES['snapshots/w1/r1.json.gz'] = zlib.gzipSync(JSON.stringify({ format: 'pnl-db/1', scope: 'all', sysVer: 'v319-1', mode: 'sonik', baseYm: '2026-11', months: S0.session.months, payload: S0, confirmed: { c: 1 }, plan: null }));
DB.sk_snapshots.push({ id: 'w1', base_ym: '2026-11', engine_ver: 'v319-1', mode: 'sonik', source: 'web', author_email: HONG, author_name: 'hong', memo: '11월 추정', storage_path: 'snapshots/w1/r1.json.gz', size_bytes: 1, rev: 1, created_at: now(), updated_at: now() });
function srv(j) {
  const m = JSON.parse(j);
  if (m.kind === 'down') return FILES[m.path] ? { data: FILES[m.path].toString('base64') } : { error: { message: 'missing ' + m.path } };
  if (m.kind !== 'q') return { data: null, error: null };
  const T = DB[m.table] || (DB[m.table] = []); let single = false, lim = null, write = false; const f = [];
  for (const [k, a] of m.ops) { if (['insert', 'update', 'upsert', 'delete'].includes(k)) write = true; else if (k === 'eq') f.push((r) => r[a[0]] === a[1]); else if (k === 'maybeSingle' || k === 'single') single = true; else if (k === 'limit') lim = a[0]; }
  if (write) return { data: null, error: null };
  let out = T.filter((r) => f.every((g) => g(r))).map((r) => Object.assign({}, r)); if (lim) out = out.slice(0, lim);
  return { data: single ? (out[0] || null) : out, error: null };
}
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const fp = u === '/mock.js' ? TW + u : REPO + u; if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(fp); if (u === '/index.html') body = Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/, '<script src="mock.js"></script>'));
  const ct = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.txt': 'text/plain' }[path.extname(fp)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': ct + '; charset=utf-8' }); res.end(body);
}).listen(8796);
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };
(async () => {
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1300, height: 850 } });
  const errs = [];
  const p = await ctx.newPage(); await p.exposeFunction('__srv', (j) => JSON.stringify(srv(j)));
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8796/index.html?me=' + encodeURIComponent(HONG)); await p.waitForSelector('[data-open="w1"]', { timeout: 20000 });
  await p.click('[data-open="w1"]'); await p.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 30000 }); await p.waitForTimeout(1200);
  const fr = p.frames().find((f) => f !== p.mainFrame());
  const where = () => fr.evaluate(() => ['undoBtn', 'redoBtn', 'undoListBtn400'].map((id) => { const e = document.getElementById(id); return [e.parentNode.id, e.offsetWidth > 0]; }));
  const w = await where();
  ok(w[0][0] === 'skWebBox' && w[0][1], '↶ 위 줄로 옮겨져 보임', w[0]);
  ok(w[2][0] === 'skWebBox' && w[2][1], '▾ 도 위 줄로 옮겨져 보임', w[2]);
  ok(await fr.evaluate(() => { const b = document.getElementById('skWebBox').children; return [...b].map((x) => x.textContent).join(''); }) === '↶↷▾인쇄', '순서 ↶ ↷ ▾ 인쇄');
  await p.frameLocator('iframe.engine-frame').locator('#undoListBtn400').click();
  ok(await fr.evaluate(() => window.__listOpened) === 1, '▾ 누르면 목록 열기 호출');
  // PC 파일로 받을 때(웹 요청 #9)는 원래 머리줄로 돌아감
  const back = await fr.evaluate(() => { const re = window.__skWebUnTrim(); const r = ['undoBtn', 'redoBtn', 'undoListBtn400'].map((id) => document.getElementById(id).parentNode.id); re(); return r; });
  ok(back.every((x) => x === 'appHeaderTools'), '저장 때 세 버튼 모두 원래 머리줄로', back);
  ok((await where()).every((x) => x[0] === 'skWebBox'), '저장 뒤 다시 위 줄로');
  ok(errs.length === 0, 'page errors', errs);
  console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
  await br.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
