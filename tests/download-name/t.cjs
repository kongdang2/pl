// node tests/download-name/t.cjs — 목록의 JSON·오프라인 파일 받기 이름에 추정자료명이 들어가는지(hong 11-18 「JSON이나 오프라인파일을 받을때 추정자료명이 포함되게」).
// (아래는 tests/back-button 준비 부분을 그대로 가져옴)
// — 「목록으로」가 엔진 안에서 쌓인 주소 기록이 있어도 목록으로 가는지(hong 11-10 「간헐적으로 목록으로 눌러도 반응 없음」)
// 가짜 엔진·가짜 Supabase(tests/two-window 것 재사용). 실데이터 없음
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), TW = path.join(REPO, 'tests/two-window'), HONG = 'kongdang2@gmail.com';
const now = () => new Date().toISOString();
// 엔진 안에 ① 기본 동작을 막지 않은 <a href="#"> ② 주소 조각(#)을 바꾸는 단추 — 둘 다 사람이 누르면 브라우저 기록이 하나 더 쌓인다
const eng = fs.readFileSync(TW + '/engine.html', 'utf8').replace('<div id="v">engine</div>',
  '<div id="v">engine</div><a id="aHash" href="#">링크</a> <button id="bHash" onclick="location.hash=\'#dept=\'+Math.random()">조각</button>'
  + '<script>function switchMenu(m){S.menu=m;}window.__buildEngineHtml=function(){return "<html><body>offline<script id=\'__SAVED_DATA__\' type=\'application/json\'>{}<\\/script></body></html>";};<\/script>'); // 브라우저 뒤로 = 직전 메뉴(웹이 switchMenu 를 부른다)
const DB = { sk_members: [{ email: HONG, name: 'hong', role: 'admin' }], sk_engines: [], sk_snapshots: [], sk_snapshot_revs: [], sk_log: [] };
const FILES = { 'engines/e.html.gz': zlib.gzipSync(eng) };
DB.sk_engines.push({ ver: 'v319-1', storage_path: 'engines/e.html.gz', sha256: crypto.createHash('sha256').update(eng).digest('hex'), is_current: true, uploaded_at: now() });
const S0 = { session: { name: 't', baseYm: '2026-11', baseYear: 2026, months: [{ ym: '2026-11', type: 'estimate', active: true }] },
  onsan: { sales: { '2026-11': [{ prod: 'MEG', qty: 20 }] }, purchase: {}, prices: { fx: 1400 } }, ulsan: { sales: {}, purchase: {} }, sysLog: [] };
FILES['snapshots/w1/r1.json.gz'] = zlib.gzipSync(JSON.stringify({ format: 'pnl-db/1', scope: 'all', sysVer: 'v319-1', mode: 'sonik', baseYm: '2026-11', months: S0.session.months, payload: S0, confirmed: { c: 1 }, plan: null }));
DB.sk_snapshots.push({ id: 'w1', base_ym: '2026-11', engine_ver: 'v319-1', mode: 'sonik', source: 'web', author_email: HONG, author_name: 'hong', memo: '11월 추정 / 1차안:최종', storage_path: 'snapshots/w1/r1.json.gz', size_bytes: 1, rev: 1, created_at: now(), updated_at: now() });
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
}).listen(8793);
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };
(async () => {
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1300, height: 850 }, acceptDownloads: true });
  const errs = [];
  const p = await ctx.newPage(); await p.exposeFunction('__srv', (j) => JSON.stringify(srv(j)));
  p.on('pageerror', (e) => errs.push(e.message));
  // 받기 이름 = 앱이 누르는 <a> 의 download 값(브라우저가 쓰는 이름). headless 의 blob 받기 이벤트는 이름을 「download」로 줄 때가 있어 클릭 순간의 값을 기록한다
  await p.addInitScript(() => { window.__dl = []; const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) { window.__dl.push(this.download); return; } return c.apply(this, arguments); }; });
  await p.goto('http://127.0.0.1:8793/index.html?me=' + encodeURIComponent(HONG)); await p.waitForSelector('[data-dl="w1"]', { timeout: 20000 });
  const idle = async () => { await p.waitForTimeout(100); await p.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 60000 }); };
  const last = () => p.evaluate(() => window.__dl[window.__dl.length - 1] || '');
  // 기대 이름: 추정자료명 「11월 추정 / 1차안:최종」 → 파일 이름에 못 쓰는 / : 는 빠지고 공백은 _ (앱 함수를 쓰지 않고 여기서 직접 적음)
  const memo = '11월_추정_1차안최종';
  await p.click('[data-dl="w1"]'); await idle();
  const n1 = await last();
  ok(n1.startsWith('손익추정DB_전체_2026-11_' + memo + '_웹_') && n1.endsWith('.json'), 'JSON 이름에 추정자료명', n1);
  await p.click('[data-html="w1"]'); await idle(); await p.waitForTimeout(500);
  const n2 = await last();
  ok(/^손익추정_웹받음_v319-1_2026-11_/.test(n2) && n2.includes('_' + memo + '_') && n2.endsWith('.html'), '목록 오프라인 파일 이름에 추정자료명', [n2, await p.evaluate(() => (document.getElementById('toast') || {}).textContent)]);
  const k2 = await p.evaluate(() => window.__dl.length);
  await p.click('[data-open="w1"]'); await idle(); await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('btnOffline').click()); await idle(); await p.waitForTimeout(300);
  const n3 = await last();
  ok((await p.evaluate(() => window.__dl.length)) === k2 + 1 && n3.includes('_2026-11_' + memo + '_') && n3.endsWith('.html'), '열린 화면 오프라인 파일 이름에 추정자료명', n3);
  const n1b = n1, n2b = n2;
  console.log('names:', n1b, '|', n2b, '|', n3);
  ok(!errs.length, '페이지 오류 없음', errs.slice(0, 3));
  await br.close(); server.close();
  console.log('PASS', pass, 'FAIL', fail); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
