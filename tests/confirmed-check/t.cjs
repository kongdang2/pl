// node tests/confirmed-check/t.cjs — 확정 자료가 바뀌면 저장 전에 확인 창(hong 11-27) Playwright 조작 시험. 가짜 엔진·가짜 Supabase(two-window/mock.js), 실데이터 없음
// APP=<파일> 을 주면 그 app.js 로 시험한다(이전 판으로 돌리면 확인 창이 뜨지 않아 실패해야 한다). SHOT=경로 면 확인 창 화면을 남긴다
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), HERE = __dirname, MOCK = path.join(REPO, 'tests/two-window/mock.js'), ME = 'a@example.com', PORT = 8813;
const APP = process.env.APP ? path.resolve(process.env.APP) : path.join(REPO, 'app.js');
const now = () => new Date().toISOString();
const DB = { sk_members: [{ email: ME, name: '가', role: 'admin' }], sk_engines: [], sk_snapshots: [], sk_snapshot_revs: [], sk_log: [] };
const FILES = {};
const eng = fs.readFileSync(HERE + '/engine.html', 'utf8');
FILES['engines/e.html.gz'] = zlib.gzipSync(eng);
DB.sk_engines.push({ ver: 'v415-1', storage_path: 'engines/e.html.gz', sha256: crypto.createHash('sha256').update(eng).digest('hex'), is_current: true, uploaded_at: now() });
const S0 = { session: { name: 't', baseYm: '2026-11', baseYear: 2026, months: [{ ym: '2026-11', type: 'estimate', active: true }] },
  onsan: { sales: { '2026-11': [{ prod: 'MEG', qty: 20 }] }, purchase: {}, prices: { fx: 1400 } }, ulsan: { sales: {}, purchase: {} }, sysLog: [] };
const C0 = { onsan: { confirmedPrice: { '2026-01': { mopj: 700 }, '2026-10': { mopj: 800 } } },
  ulsan: { confirmedSales: { '2026-01': { HDPE: { dom: { qty: 13374.825, amt: 18990.06, unitKrw: 1419836, unitUsd: 976.08 } } }, '2026-10': { HDPE: { dom: { qty: 9463.525, amt: 13100.5, unitKrw: 1384315, unitUsd: 968.05 } } } } }, head: {} };
const db0 = { format: 'pnl-db/1', scope: 'all', sysVer: 'v415-1', mode: 'sonik', baseYm: '2026-11', months: S0.session.months, payload: S0, confirmed: C0, plan: null };
FILES['snapshots/w1/r1.json.gz'] = zlib.gzipSync(JSON.stringify(db0));
DB.sk_snapshots.push({ id: 'w1', base_ym: '2026-11', engine_ver: 'v415-1', mode: 'sonik', source: 'web', author_email: ME, author_name: '가', memo: '11월 추정', storage_path: 'snapshots/w1/r1.json.gz', size_bytes: 1, rev: 1, created_at: '2026-11-04T01:00:00Z', updated_at: '2026-11-04T01:00:00Z' });
function srv(j) {
  const m = JSON.parse(j);
  if (m.kind === 'up') { if (FILES[m.path] && !m.upsert) return { error: { message: 'exists' } }; FILES[m.path] = Buffer.from(m.data, 'base64'); return { error: null }; }
  if (m.kind === 'down') return FILES[m.path] ? { data: FILES[m.path].toString('base64') } : { error: { message: 'missing ' + m.path } };
  if (m.kind === 'rm') { m.paths.forEach((p) => delete FILES[p]); return { error: null }; }
  if (m.kind === 'rpc') {
    const a = m.a; if (m.fn !== 'sk_overwrite_snapshot') return { data: null, error: null };
    const s = DB.sk_snapshots.find((r) => r.id === a.p_id); if (!s) return { error: { message: 'NOT_FOUND' } };
    if (s.rev !== a.p_expected_rev) return { error: { message: 'CONFLICT:' + s.rev } };
    DB.sk_snapshot_revs.push({ snapshot_id: s.id, rev: s.rev, storage_path: s.storage_path, saved_at: s.updated_at });
    Object.assign(s, { storage_path: a.p_path, size_bytes: a.p_size, rev: s.rev + 1, updated_at: now(), last_saved_by: m.me, last_saved_name: '가' });
    return { data: { rev: s.rev, prune: [] }, error: null };
  }
  const T = DB[m.table] || (DB[m.table] = []); let op = 'select', payload = null, single = false, lim = null, ord = null; const f = [];
  for (const [k, a] of m.ops) { if (k === 'insert' || k === 'update' || k === 'upsert') { op = k; payload = a[0]; } else if (k === 'delete') op = 'delete'; else if (k === 'eq') f.push((r) => r[a[0]] === a[1]); else if (k === 'in') f.push((r) => a[1].includes(r[a[0]])); else if (k === 'neq') f.push((r) => r[a[0]] !== a[1]); else if (k === 'maybeSingle' || k === 'single') single = true; else if (k === 'limit') lim = a[0]; else if (k === 'order') ord = [a[0], a[1] && a[1].ascending]; }
  if (op === 'insert' || op === 'upsert') { (Array.isArray(payload) ? payload : [payload]).forEach((p) => { const r = Object.assign({ created_at: now() }, p); if (m.table === 'sk_snapshots') { r.rev = r.rev || 1; r.updated_at = r.created_at; } T.push(r); }); return { data: null, error: null }; }
  if (op === 'update') { T.filter((r) => f.every((g) => g(r))).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
  if (op === 'delete') { DB[m.table] = T.filter((r) => !f.every((g) => g(r))); return { data: null, error: null }; }
  let out = T.filter((r) => f.every((g) => g(r))).map((r) => Object.assign({}, r)); if (ord) out.sort((a, b) => (a[ord[0]] < b[ord[0]] ? -1 : a[ord[0]] > b[ord[0]] ? 1 : 0) * (ord[1] ? 1 : -1)); if (lim) out = out.slice(0, lim);
  return { data: single ? (out[0] || null) : out, error: null };
}
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const fp = u === '/mock.js' ? MOCK : u === '/app.js' ? APP : REPO + u; if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(fp); if (u === '/index.html') body = Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/, '<script src="mock.js"></script>'));
  const ct = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.txt': 'text/plain' }[path.extname(fp)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': ct + '; charset=utf-8' }); res.end(body);
}).listen(PORT);
const snap = (id) => DB.sk_snapshots.find((x) => x.id === id);
const stored = (id) => { const s = snap(id); return JSON.parse(zlib.gunzipSync(FILES[s.storage_path])); };
const logs = (a) => DB.sk_log.filter((l) => l.action === a);
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };
(async () => {
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); const errs = [];
  await p.exposeFunction('__srv', (j) => JSON.stringify(srv(j)));
  p.on('pageerror', (e) => errs.push(e.message));
  const idle = async () => { await p.waitForTimeout(100); await p.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 30000 }); };
  const fr = () => p.frames().find((f) => f !== p.mainFrame());
  const T = (fn, arg) => fr().evaluate(fn, arg);
  const modal = () => p.evaluate(() => (document.getElementById('modal').hidden ? null : { title: document.getElementById('mTitle').textContent, body: document.getElementById('mBody').innerText, ok: document.getElementById('mOk').textContent, wide: document.querySelector('#modal .modal-card').classList.contains('wide') }));
  // 「저장」을 누르고 잠깐 기다린다. 확인 창이 떠 있으면 그 내용을, 아니면 null
  const save = async (sel) => { await p.click(sel || '#btnSave'); await p.waitForTimeout(500); return modal(); };
  await p.goto('http://127.0.0.1:' + PORT + '/index.html?me=' + encodeURIComponent(ME)); await p.waitForSelector('[data-open="w1"]', { timeout: 20000 });
  await p.click('[data-open="w1"]'); await idle(); await p.waitForTimeout(1900);

  // ① 추정 입력만 고침 → 묻지 않고 저장
  await T(() => T.est('MEG', 21));
  let md = await save(); await idle();
  ok(md === null && snap('w1').rev === 2, '① 추정 입력만 고치면 확인 창 없이 저장', { md, rev: snap('w1').rev });

  // ② 화면을 그리며 생긴 빈 자리·계산 오차 + 추정 입력 → 묻지 않음
  await T(() => { T.touch(); T.est('MEG', 22); });
  md = await save(); await idle();
  ok(md === null && snap('w1').rev === 3, '② 빈 자리·계산 오차는 변경으로 보지 않음', { md, rev: snap('w1').rev });

  // ③ 사고 모양: 1월 수량 0, 10월 칸에 이어 붙음 → 확인 창에 두 곳이 이전·지금 값과 함께
  await T(() => { T.conf('2026-01', 'HDPE', 'dom', 'qty', 0); T.conf('2026-10', 'HDPE', 'dom', 'qty', 9463.52513374); });
  md = await save();
  if (process.env.SHOT && md) await p.screenshot({ path: process.env.SHOT });
  ok(!!md && /확정 자료가 바뀌었습니다/.test(md.title), '③ 확정 칸이 바뀌면 저장 전에 확인 창', md);
  ok(!!md && /울산 · 확정 판매 · 2026-01 · HDPE · 내수/.test(md.body) && /수량 13,374\.825/.test(md.body) && /수량 0/.test(md.body), '③ 1월 칸: 위치와 이전 13,374.825 → 지금 0', md && md.body);
  ok(!!md && /2026-10 · HDPE · 내수/.test(md.body) && /9,463\.525/.test(md.body) && /9,463\.52513374/.test(md.body), '③ 10월 칸: 이전 9,463.525 → 지금 9,463.52513374', md && md.body);
  ok(!!md && /값이 바뀐 곳 2/.test(md.body) && md.ok === '이대로 저장', '③ 바뀐 곳 2, 단추 「이대로 저장」', md);
  ok(snap('w1').rev === 3, '③ 묻는 동안에는 저장하지 않음', snap('w1').rev);
  // 취소 → 저장 안 함, 화면 값은 그대로(고친 상태), 기록 남김
  if (md) await p.click('#mCancel'); await idle(); await p.waitForTimeout(300);
  ok(snap('w1').rev === 3 && stored('w1').confirmed.ulsan.confirmedSales['2026-01'].HDPE.dom.qty === 13374.825, '③ 취소하면 저장하지 않음', snap('w1').rev);
  ok((await T(() => T.C().ulsan.confirmedSales['2026-01'].HDPE.dom.qty)) === 0, '③ 취소해도 화면 값은 그대로 둠');
  ok(logs('conf_cancel').length === 1 && /확정 \d+칸/.test(logs('conf_cancel')[0].detail || ''), '③ 취소 기록(conf_cancel)', logs('conf_cancel'));
  ok((await p.evaluate(() => document.getElementById('mOk').textContent)) === '확인', '③ 단추 글자 원래대로');

  // ④ 다시 저장 → 또 묻는다 → 1월만 고치고(10월은 그대로) 저장하면 10월 한 곳만 → 「이대로 저장」
  await T(() => { T.conf('2026-01', 'HDPE', 'dom', 'qty', 13374.825); T.conf('2026-01', 'HDPE', 'dom', 'unitKrw', 1419836); T.conf('2026-01', 'HDPE', 'dom', 'unitUsd', 976.08); });
  md = await save();
  ok(!!md && /값이 바뀐 곳 1/.test(md.body) && !/2026-01/.test(md.body), '④ 되돌린 칸은 빠지고 남은 한 곳만 묻는다', md && md.body);
  if (md) await p.click('#mOk'); await idle(); await p.waitForTimeout(300);
  ok(snap('w1').rev === 4 && stored('w1').confirmed.ulsan.confirmedSales['2026-10'].HDPE.dom.qty === 9463.52513374, '④ 「이대로 저장」 → 저장됨', snap('w1').rev);
  const sv = logs('save_web').slice(-1)[0];
  ok(!!sv && /확정 1칸/.test(sv.detail || '') && /2026-10/.test(sv.detail || ''), '④ 저장 기록에 확정 변경 요약', sv && sv.detail);

  // ⑤ 저장한 뒤에는 그 값이 기준 → 추정만 고쳐 저장하면 묻지 않음
  await T(() => T.est('MEG', 23));
  md = await save(); await idle();
  ok(md === null && snap('w1').rev === 5, '⑤ 저장한 뒤에는 다시 묻지 않음', { md, rev: snap('w1').rev });

  // ⑥ 새 달(월 마감)이 들어옴 → 「새로 들어온 달」 한 줄로, 값이 바뀐 곳 표는 없음
  await T(() => T.addMonth('2026-11'));
  md = await save();
  ok(!!md && /새로 들어온 달 1/.test(md.body) && /2026-11/.test(md.body) && /울산 확정 판매/.test(md.body) && /온산 확정 가격/.test(md.body) && !/값이 바뀐 곳/.test(md.body), '⑥ 새 달은 묶어서 한 줄', md && md.body);
  if (md) await p.click('#mOk'); await idle(); await p.waitForTimeout(300);
  ok(snap('w1').rev === 6, '⑥ 저장됨', snap('w1').rev);

  // ⑦ 있던 달이 통째로 없어짐 + 가격 칸 하나 바뀜 → 둘 다 표에
  await T(() => { T.dropMonth('2026-11'); T.price('2026-10', 'mopj', 810); });
  md = await save();
  ok(!!md && /울산 · 확정 판매 · 2026-11/.test(md.body) && /없어짐/.test(md.body) && /온산 · 확정 가격 · 2026-10/.test(md.body) && /mopj 800/.test(md.body) && /mopj 810/.test(md.body), '⑦ 없어진 달과 바뀐 가격 칸', md && md.body);
  if (md) await p.click('#mCancel'); await idle(); await p.waitForTimeout(300);
  ok(snap('w1').rev === 6, '⑦ 취소 → 저장 안 함', snap('w1').rev);

  // ⑧ 「새 버전으로 저장」도 이름을 받은 뒤 묻는다 → 「이대로 저장」 → 새 자료
  await p.click('#btnSaveNew'); await p.waitForSelector('#modal:not([hidden])');
  await p.fill('#memoIn', '시험 새 버전'); await p.click('#mOk'); await p.waitForTimeout(600);
  md = await modal();
  ok(!!md && /확정 자료가 바뀌었습니다/.test(md.title), '⑧ 새 버전으로 저장도 확인 창', md);
  if (md) await p.click('#mOk'); await idle(); await p.waitForTimeout(400);
  const nw = DB.sk_snapshots.find((x) => x.memo === '시험 새 버전');
  ok(!!nw && snap('w1').rev === 6, '⑧ 새 자료로 저장(원래 자료는 그대로)', { nw: !!nw, rev: snap('w1').rev });

  // ── 두 창(같은 자료 w1 을 A·B 가 함께 엶) ──
  const openW = async (tag) => {
    const q = await ctx.newPage(); await q.exposeFunction('__srv', (j) => JSON.stringify(srv(j))); q.on('pageerror', (e) => errs.push(tag + ': ' + e.message));
    await q.goto('http://127.0.0.1:' + PORT + '/index.html?me=' + encodeURIComponent(ME)); await q.waitForSelector('[data-open="w1"]', { timeout: 20000 });
    await q.click('[data-open="w1"]'); await q.waitForTimeout(100); await q.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 30000 }); await q.waitForTimeout(1900);
    q.T = (fn, arg) => q.frames().find((f) => f !== q.mainFrame()).evaluate(fn, arg);
    q.idle = async () => { await q.waitForTimeout(100); await q.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 30000 }); };
    q.modal = () => q.evaluate(() => (document.getElementById('modal').hidden ? null : { title: document.getElementById('mTitle').textContent, body: document.getElementById('mBody').innerText }));
    q.save = async () => { await q.click('#btnSave'); await q.waitForTimeout(500); return q.modal(); };
    return q;
  };
  await p.close();
  const A = await openW('A'), Bw = await openW('B');
  const rev0 = snap('w1').rev;
  // ⑨ B 가 확정 가격 칸을 고쳐 저장(B 에게는 묻는다) → A 는 추정만 고친 채 「⤵ 반영」 → 저장: A 에게는 묻지 않는다(남이 확인하고 저장한 칸)
  await Bw.T(() => T.price('2026-01', 'mopj', 705));
  md = await Bw.save();
  ok(!!md && /온산 · 확정 가격 · 2026-01/.test(md.body), '⑨ 고친 창(B)에는 확인 창', md && md.body);
  await Bw.click('#mOk'); await Bw.idle(); await A.waitForTimeout(600);
  ok(snap('w1').rev === rev0 + 1, '⑨ B 저장됨', snap('w1').rev);
  await A.T(() => T.est('MEG', 30));
  await A.click('#btnMerge'); await A.idle(); await A.waitForTimeout(400);
  ok((await A.T(() => T.C().onsan.confirmedPrice['2026-01'].mopj)) === 705, '⑨ A 가 「⤵ 반영」으로 B 의 확정 값을 받음');
  md = await A.save(); await A.idle();
  ok(md === null && snap('w1').rev === rev0 + 2 && stored('w1').payload.onsan.sales['2026-11'][0].qty === 30, '⑨ 받은 확정 값은 A 저장 때 묻지 않음', { md, rev: snap('w1').rev });
  // ⑩ B 가 추정을 고쳐 저장, A 는 그걸 모르고 확정 칸을 고쳐 저장 → A 에게 묻고(내 수정) → 「이대로 저장」 → 최신 판과 합쳐 저장
  await Bw.waitForTimeout(500); await Bw.click('#btnMerge'); await Bw.idle(); await Bw.waitForTimeout(300);
  await Bw.T(() => T.est('MEG', 31)); md = await Bw.save(); await Bw.idle();
  ok(md === null && snap('w1').rev === rev0 + 3, '⑩ B 추정만 고쳐 저장(묻지 않음)', { md, rev: snap('w1').rev });
  await A.T(() => T.price('2026-10', 'mopj', 820));
  md = await A.save();
  ok(!!md && /온산 · 확정 가격 · 2026-10/.test(md.body) && /값이 바뀐 곳 1/.test(md.body), '⑩ 내가 고친 확정 칸만 묻는다', md && md.body);
  await A.click('#mOk'); await A.idle(); await A.waitForTimeout(500);
  const L = stored('w1');
  ok(snap('w1').rev === rev0 + 4 && L.confirmed.onsan.confirmedPrice['2026-10'].mopj === 820 && L.payload.onsan.sales['2026-11'][0].qty === 31, '⑩ 확인 뒤 최신 판과 합쳐 저장(내 확정 820 + B 추정 31)', { rev: snap('w1').rev, mopj: L.confirmed.onsan.confirmedPrice['2026-10'].mopj, qty: L.payload.onsan.sales['2026-11'][0].qty });
  md = await A.save(); await A.idle();
  ok(md === null, '⑩ 합쳐 저장한 뒤 바로 다시 저장해도 묻지 않음', md);
  ok(errs.length === 0, '화면 오류 없음', errs);

  await br.close(); server.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
