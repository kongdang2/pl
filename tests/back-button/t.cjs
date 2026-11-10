// node tests/back-button/t.cjs — 「목록으로」가 엔진 안에서 쌓인 주소 기록이 있어도 목록으로 가는지(hong 11-10 「간헐적으로 목록으로 눌러도 반응 없음」)
// 가짜 엔진·가짜 Supabase(tests/two-window 것 재사용). 실데이터 없음
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), TW = path.join(REPO, 'tests/two-window'), HONG = 'kongdang2@gmail.com';
const now = () => new Date().toISOString();
// 엔진 안에 ① 기본 동작을 막지 않은 <a href="#"> ② 주소 조각(#)을 바꾸는 단추 — 둘 다 사람이 누르면 브라우저 기록이 하나 더 쌓인다
const eng = fs.readFileSync(TW + '/engine.html', 'utf8').replace('<div id="v">engine</div>',
  '<div id="v">engine</div><a id="aHash" href="#">링크</a> <button id="bHash" onclick="location.hash=\'#dept=\'+Math.random()">조각</button>'
  + '<script>function switchMenu(m){S.menu=m;}<\/script>'); // 브라우저 뒤로 = 직전 메뉴(웹이 switchMenu 를 부른다)
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
}).listen(8792);
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };
(async () => {
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1300, height: 850 } });
  const errs = [];
  const idle = async (p) => { await p.waitForTimeout(100); await p.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 30000 }); };
  const fr = (p) => p.frames().find((f) => f !== p.mainFrame());
  const inList = (p) => p.evaluate(() => !document.getElementById('vList').hidden && document.getElementById('vEngine').hidden);
  async function open() {
    const p = await ctx.newPage(); await p.exposeFunction('__srv', (j) => JSON.stringify(srv(j)));
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8792/index.html?me=' + encodeURIComponent(HONG)); await p.waitForSelector('[data-open="w1"]', { timeout: 20000 });
    await p.click('[data-open="w1"]'); await idle(p); await p.waitForTimeout(1200); return p;
  }
  const menu = async (p, m) => { await fr(p).evaluate((x) => T.go(x), m); await p.waitForTimeout(600); }; // 메뉴 바꿈 → 웹이 기록을 하나 쌓음(400ms 간격 확인)
  async function back(p) { // 「목록으로」 → (저장 안 한 작업 확인 창이 뜨면 확인) → 2초 안에 목록
    await p.click('#btnBack'); await p.waitForTimeout(300);
    if (await p.evaluate(() => !document.getElementById('modal').hidden)) await p.click('#mOk');
    try { await p.waitForFunction(() => !document.getElementById('vList').hidden && document.getElementById('vEngine').hidden, null, { timeout: 2000 }); } catch (_) { /* 아래에서 판정 */ }
    await idle(p); return inList(p);
  }
  const fl = (p) => p.frameLocator('iframe.engine-frame');

  // 1) 메뉴 두 번 바꾼 뒤 엔진 안 <a href="#"> 누름 → 메뉴 한 번 더 → 목록으로
  let p = await open();
  await menu(p, 'sales'); await menu(p, 'cost');
  await fl(p).locator('#aHash').click(); await p.waitForTimeout(200);
  await menu(p, 'pnl');
  ok(await back(p), '① 엔진 안 <a href="#"> 누른 뒤 목록으로');
  await p.close();

  // 2) 엔진 안에서 주소 조각(#)을 바꾸는 단추를 누른 뒤(웹이 막지 못하는 기록) → 목록으로
  p = await open();
  await menu(p, 'sales'); await fl(p).locator('#bHash').click(); await p.waitForTimeout(200); await menu(p, 'cost');
  ok(await back(p), '② 엔진이 주소 조각을 바꾼 뒤 목록으로');
  // 목록에서 다시 열고 바로 목록으로(엉킨 기록이 남아 있어도)
  await p.click('[data-open="w1"]'); await idle(p); await p.waitForTimeout(1200);
  ok(await back(p), '② 다시 열고 바로 목록으로');
  await p.close();

  // 3) 평소: 메뉴 바꾸고 브라우저 뒤로 = 직전 메뉴, 목록으로 = 목록, 목록에서 앞으로 가도 엔진이 다시 열리지 않음
  p = await open();
  await menu(p, 'sales'); await menu(p, 'cost');
  await p.goBack(); await p.waitForTimeout(500);
  ok(await fr(p).evaluate(() => T.where()) === 'sales', '③ 브라우저 뒤로 = 직전 메뉴', await fr(p).evaluate(() => T.where()));
  ok(await back(p), '③ 목록으로');
  await p.goForward().catch(() => {}); await p.waitForTimeout(500);
  ok(await inList(p), '③ 목록에서 앞으로 → 그대로 목록');
  await p.close();

  ok(errs.length === 0, 'page errors', errs);
  console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
  await br.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
