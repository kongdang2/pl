// node tests/egress/t.cjs — 전송량 줄이기(hong 11-22, Supabase 무료 한도) 시험. 가짜 Supabase(실데이터 없음), 시계는 Playwright clock 으로 앞당긴다.
//  ① 수정요청 Realtime 이 이어져 있으면 목록 화면에서 20초마다 다시 읽지 않음(5분마다 예비로만)
//  ② 끊겨 있으면 40초마다 다시 읽음(예전 20초)
//  ③ 5분마다 적는 웹 조회 전송량(sk_egress)에 표별 크기와 Realtime 상태(rt=)가 붙음 — 앞의 'api N' 모양은 그대로
//  ④ 열어 둔 수정요청 「보기」를 진행 알림 때 다시 그릴 때 큰 열(items·body)은 다시 받지 않음
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), HONG = 'hong@x.com';
const now = () => new Date().toISOString();
const DB = { sk_members: [{ email: HONG, name: 'hong', role: 'admin' }], sk_engines: [], sk_snapshots: [], sk_snapshot_revs: [], sk_log: [], sk_egress: [], sk_channel: [], sk_relay: [{ id: 1, paused: false }],
  sk_requests: [{ id: 5, title: '시험 요청', kind: '계산', status: '진행', stage: 1, progress: [{ at: now(), stage: 1, text: '시작' }], working: null, author_name: 'hong', author_email: HONG, created_at: now(), body: '본문', items: [{ kind: 'cell', excerpt: { rows: [['큰', '표']] } }] }] };
const CALLS = [];
function srv(j) {
  const m = JSON.parse(j);
  if (m.kind === 'rpc') return { data: null, error: null };
  if (m.kind !== 'q') return { error: null };
  const T = DB[m.table] || (DB[m.table] = []); let op = 'select', payload = null, single = false, sel = '*'; const f = [];
  for (const [k, a] of m.ops) {
    if (k === 'insert' || k === 'update' || k === 'upsert') { op = k; payload = a[0]; } else if (k === 'delete') op = 'delete';
    else if (k === 'select') sel = a[0] || '*'; else if (k === 'eq') f.push((r) => r[a[0]] === a[1]); else if (k === 'maybeSingle' || k === 'single') single = true;
  }
  if (op === 'select') CALLS.push({ table: m.table, sel, single });
  if (op === 'insert') { (Array.isArray(payload) ? payload : [payload]).forEach((p) => T.push(Object.assign({ at: now() }, p))); return { data: null, error: null }; }
  if (op !== 'select') return { data: null, error: null };
  let out = T.filter((r) => f.every((g) => g(r))).map((r) => Object.assign({}, r));
  if (m.table === 'sk_members' && single) out = out.filter((r) => r.email === m.me);
  if (sel !== '*') { const cols = sel.split(',').map((c) => c.trim()); out = out.map((r) => { const o = {}; cols.forEach((c) => { if (c in r) o[c] = r[c]; }); return o; }); }
  return { data: single ? (out[0] || null) : out, error: null };
}
// createClient 에 넘어온 전송량 세기 fetch 와 Realtime 상태를 시험에서 다룰 수 있게 감싼다
const WRAP = `(function(){const cc=window.supabase.createClient;window.supabase.createClient=function(u,k,o){window.__gfetch=o&&o.global&&o.global.fetch;const c=cc(u,k,o);const ch0=c.channel;
 c.channel=function(name,opts){const x=ch0(name,opts);if(/^sk_(requests|channel)_web$/.test(name)){x.on=function(t,f,h){(window.__rth=window.__rth||{})[name]=h;return x;};x.subscribe=function(cb){(window.__rtcb=window.__rtcb||{})[name]=cb;setTimeout(function(){cb&&cb(window.__rtStatus||'SUBSCRIBED');},10);return x;};}return x;};return c;};})();`;
const PORT = 8797;
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  if (u.startsWith('/rest/v1/')) { const body = Buffer.alloc(60000, 32); res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length }); return res.end(body); }
  if (u === '/wrap.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(WRAP); }
  const fp = u === '/mock.js' ? path.join(REPO, 'tests/two-window/mock.js') : REPO + u; if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(fp); if (u === '/index.html') body = Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/, '<script src="mock.js"></script><script src="wrap.js"></script>'));
  const ct = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.txt': 'text/plain' }[path.extname(fp)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': ct + '; charset=utf-8' }); res.end(body);
}).listen(PORT);
let pass = 0, fail = 0; const ok = (c, m, extra) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, extra !== undefined ? JSON.stringify(extra) : ''); } };
const step = async (P, n) => { for (let i = 0; i < n; i++) { await P.clock.fastForward('00:20'); await P.waitForTimeout(60); } }; // 20초씩 앞당김(한 번에 크게 넘기면 반복 타이머가 한 번만 돈다)
const rq = () => CALLS.filter((c) => c.table === 'sk_requests' && !c.single).length;
(async () => {
  const br = await chromium.launch(); const errs = [];
  async function page(rt) {
    const ctx = await br.newContext({ viewport: { width: 1300, height: 900 } }); const p = await ctx.newPage();
    await p.clock.install();
    await p.exposeFunction('__srv', (j) => JSON.stringify(srv(j)));
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript((s) => { window.__rtStatus = s; try { localStorage.setItem('sk_tab', 'sonik'); } catch (_) { /* */ } }, rt);
    await p.goto('http://127.0.0.1:' + PORT + '/index.html?me=' + encodeURIComponent(HONG));
    await p.waitForSelector('#rqRows tr', { timeout: 20000 }); await p.waitForTimeout(300);
    return p;
  }
  // ① Realtime 이어짐
  let P = await page('SUBSCRIBED');
  let n0 = rq(); await step(P, 6); await P.waitForTimeout(200);
  ok(rq() - n0 === 0, '① Realtime 이 이어져 있으면 2분 동안 수정요청 목록을 다시 읽지 않음(예전 6번)', rq() - n0);
  await step(P, 10); await P.waitForTimeout(200);
  ok(rq() - n0 >= 1 && rq() - n0 <= 2, '① 5분이 지나면 예비로 한 번 읽음', rq() - n0);
  // ③ 표별 전송량 기록
  await P.evaluate(() => window.__gfetch(location.origin + '/rest/v1/sk_channel?select=id'));
  await P.evaluate(() => window.__gfetch(location.origin + '/rest/v1/rpc/sk_usage', { method: 'POST' }));
  await P.waitForTimeout(100);
  const e0 = DB.sk_egress.length; await P.clock.fastForward('05:01'); await P.waitForTimeout(300);
  const rows = DB.sk_egress.slice(e0).map((r) => r.what);
  ok(rows.some((w) => /^api \d+ /.test(w) && /\bchannel=6\dk\b/.test(w) && /\brpc:usage=6\dk\b/.test(w) && /\brt=[01]\b/.test(w)), '③ sk_egress 에 표별 크기·Realtime 상태가 붙음(api N 모양 유지)', rows);
  // ④ 열어 둔 「보기」를 다시 그릴 때 items·body 를 다시 받지 않음
  await P.click('[data-rv="5"]'); await P.waitForSelector('#rqView:not([hidden])'); await P.waitForTimeout(200);
  const v0 = CALLS.length;
  // 중계가 진행을 적은 것처럼 Realtime 변경 알림을 보냄 → 목록과 열린 「보기」를 다시 그림
  await P.evaluate(() => window.__rth.sk_requests_web({ eventType: 'UPDATE' })); await P.waitForTimeout(800);
  const again = CALLS.slice(v0).filter((c) => c.table === 'sk_requests' && c.single);
  ok(again.length === 1 && again[0].sel !== '*' && !/\bitems\b|\bbody\b/.test(again[0].sel), '④ 진행 알림으로 다시 그릴 때 items·body 는 다시 받지 않음', again);
  ok(await P.evaluate(() => /큰/.test(document.getElementById('rvBody').textContent) && /본문/.test(document.getElementById('rvBody').textContent)), '④ 다시 그린 뒤에도 요청 내용·본문이 그대로 보임');
  DB.sk_requests[0].progress.push({ at: now(), stage: 1, text: '두 번째 진행' });
  await P.evaluate(() => window.__rth.sk_requests_web({ eventType: 'UPDATE' })); await P.waitForTimeout(800);
  ok(await P.evaluate(() => /두 번째 진행/.test(document.getElementById('rvBody').textContent)), '④ 새 진행 기록은 반영됨');
  await P.close();
  // ② Realtime 끊김
  P = await page('CHANNEL_ERROR');
  n0 = rq(); await step(P, 6);
  ok(rq() - n0 >= 2 && rq() - n0 <= 4, '② 끊겨 있으면 40초마다(2분에 3번 안팎) 다시 읽음', rq() - n0);
  await P.close();
  ok(errs.length === 0, '페이지 오류 없음', errs);
  console.log('\n결과 pass', pass, 'fail', fail); await br.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
