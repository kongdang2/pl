// node tests/office/t.cjs — 사무실(hong 전용 시험 메뉴, hong 11-22) Playwright 조작 시험. 가짜 Supabase(storage-clean/mock.js), 실데이터 없음
// 보는 것: 관리자에게만 단추 · 창구 숫자 = hong 이 답할 대기 글 · 담당 누르면 다가가 대화창 · 보낸 말이 ⚡ 빠른 질문 글(주제 「사무실 · 손익담당」)로 올라감
//          · 답이 오면 대화창·말풍선에 뜸 · 이어 묻기는 앞 답에 이어 씀 · 담당 9 모두 연결(Codex 는 Codex 앞) · 가만히 있으면 안 그림 · 바닥 누르면 hong 이동 · 기존 챗봇 그대로
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), MOCK = path.resolve(__dirname, '../storage-clean/mock.js'), HONG = 'kongdang2@gmail.com', KIM = 'kim@x.com';
const T = (min) => new Date(Date.now() - (60 - min) * 60000).toISOString();
const row = (r) => Object.assign({ reply_to: null, files: [], quick: false, live: [], run_state: null, run_note: null, owner: null, author_email: 'x@y', updated_at: r.at, ctx: null, request_id: null }, r);
const DB = {
  sk_members: [{ email: HONG, name: 'hong', role: 'admin' }, { email: KIM, name: '김작성', role: 'writer' }],
  sk_engines: [{ ver: 'v409-1', storage_path: 'engines/v409-1.html.gz', is_current: true, uploaded_at: T(0) }],
  sk_snapshots: [{ id: 's1', base_ym: '2026-11', source: 'web', author_email: HONG, author_name: 'hong', memo: '시험 자료', storage_path: 'snapshots/s1/r1.json.gz', rev: 1, created_at: T(0), updated_at: T(0) }],
  sk_relay: [{ id: 1, heartbeat: new Date().toISOString(), paused: false }], sk_requests: [],
  sk_channel: [
    row({ id: 1, at: T(1), sender: 'hong', recipient: 'Claude', topic: 'v409', status: '답변', body: '올려줘' }),
    row({ id: 2, at: T(2), sender: 'Claude', recipient: 'hong', topic: 'v409', status: '대기', reply_to: 1, body: '운영본으로 올릴까요?' }),
    row({ id: 3, at: T(3), sender: 'Codex', recipient: 'hong', topic: 'v410 교차검증', status: '대기', body: '통과입니다. 확인 부탁드립니다.' }),
    row({ id: 4, at: T(4), sender: 'Claude', recipient: 'hong', topic: '웹 엔진 자동 갱신', status: '안내', body: '바꿨습니다.' }),
  ],
};
function srv(j) {
  const m = JSON.parse(j);
  if (m.kind === 'rpc') return { data: m.fn === 'sk_usage' ? { egress_month: 1e8, egress_today: 1e6, storage: 1e8, db: 1e7, at: new Date().toISOString() } : null, error: null };
  if (m.kind !== 'q') return { data: [], error: null };
  const Tb = DB[m.table] || (DB[m.table] = []); let op = 'select', payload = null, single = false, lim = null, ord = null; const f = [];
  for (const [k, a] of m.ops) {
    if (k === 'insert' || k === 'update' || k === 'upsert') { op = k; payload = a[0]; } else if (k === 'delete') op = 'delete';
    else if (k === 'eq') f.push((r) => r[a[0]] === a[1]); else if (k === 'in') f.push((r) => a[1].includes(r[a[0]])); else if (k === 'gt') f.push((r) => r[a[0]] > a[1]);
    else if (k === 'order') ord = [a[0], !(a[1] && a[1].ascending === false)]; else if (k === 'limit') lim = a[0]; else if (k === 'single' || k === 'maybeSingle') single = true;
  }
  if (op === 'insert') { (Array.isArray(payload) ? payload : [payload]).forEach((p) => { const now = new Date().toISOString(); Tb.push(Object.assign({ id: Math.max(0, ...Tb.map((x) => +x.id || 0)) + 1, at: now, updated_at: now, live: [], run_state: null, run_note: null, owner: null }, p)); }); return { data: null, error: null }; }
  if (op === 'update') { Tb.filter((r) => f.every((g) => g(r))).forEach((r) => Object.assign(r, payload, { updated_at: new Date().toISOString() })); return { data: null, error: null }; }
  if (op === 'delete') return { data: null, error: null };
  let out = Tb.filter((r) => f.every((g) => g(r))).map((r) => Object.assign({}, r));
  if (ord) out.sort((a, b) => (a[ord[0]] < b[ord[0]] ? -1 : a[ord[0]] > b[ord[0]] ? 1 : 0) * (ord[1] ? 1 : -1)); if (lim) out = out.slice(0, lim);
  if (m.table === 'sk_members' && single) out = out.filter((r) => r.email === m.me);
  return { data: single ? (out[0] || null) : out, error: null };
}
const PORT = 8797;
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const fp = u === '/mock.js' ? MOCK : REPO + u; if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(fp); if (u === '/index.html') body = Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/, '<script src="mock.js"></script>'));
  res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[path.extname(fp)] || 'text/plain') + '; charset=utf-8' }); res.end(body);
}).listen(PORT);
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };
async function page(br, me) {
  const p = await br.newPage({ viewport: { width: 1320, height: 800 } }); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  p.reqs = []; p.on('request', (r) => p.reqs.push(r.url()));
  await p.exposeFunction('__srv', (j) => JSON.stringify(srv(j)));
  await p.goto('http://127.0.0.1:' + PORT + '/index.html?me=' + encodeURIComponent(me));
  await p.waitForSelector('#snapRows tr', { timeout: 20000 }); return p;
}
const labXY = (p, name) => p.evaluate((n) => { const e = [...document.querySelectorAll('.ofc-lab')].find((x) => x.textContent.trim() === n); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom]; }, name);
const still = async (p, name) => { let a = await labXY(p, name); for (let i = 0; i < 200; i++) { await p.waitForTimeout(250); const b = await labXY(p, name); if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.5) return b; a = b; } return a; };
(async () => {
  const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // 담당자: 단추 없음, 3D 파일도 받지 않음
  let p = await page(br, KIM);
  ok(await p.evaluate(() => !document.getElementById('btnOffice')), '담당자에게는 사무실 단추가 없다');
  ok(!p.reqs.some((u) => /three-r128/.test(u)), '담당자는 3D 파일을 받지 않는다'); ok(!p.errs.length, '담당자 화면 오류 없음', p.errs); await p.close();
  // hong
  p = await page(br, HONG);
  ok(await p.evaluate(() => { const b = document.getElementById('btnOffice'); return !!b && !b.hidden; }), 'hong 에게는 사무실 단추가 보인다');
  ok(!p.reqs.some((u) => /three-r128/.test(u)), '열기 전에는 3D 파일을 받지 않는다');
  const selBefore = DB.sk_channel.length;
  await p.click('#btnOffice'); await p.waitForSelector('#ofc canvas', { timeout: 20000 }); await p.waitForSelector('.ofc-lab');
  ok(await p.evaluate(() => !document.getElementById('ofc').hidden), '사무실이 열린다');
  ok((await p.textContent('#ofcCnt')) === '2', '창구 숫자 = hong 이 답할 대기 글 2건', await p.textContent('#ofcCnt'));
  ok((await p.evaluate(() => [...document.querySelectorAll('.ofc-sign.p')].filter((e) => !e.hidden).map((e) => e.textContent))).length === 2, '주황 상자 이름표 2개');
  ok((await p.evaluate(() => document.querySelectorAll('.ofc-lab').length)) === 10, '담당 8 + Codex + hong = 이름표 10개', await p.evaluate(() => document.querySelectorAll('.ofc-lab').length));
  // 바닥 누르면 hong 이 움직인다
  const h0 = await labXY(p, 'hong'); await p.mouse.click(330, 600); await p.waitForTimeout(600); const h1 = await still(p, 'hong');
  ok(Math.hypot(h1[0] - h0[0], h1[1] - h0[1]) > 80, '바닥을 누르면 hong 이 걸어간다', [h0, h1]);
  // 손익담당을 누르면 다가가 대화창이 열린다
  let xy = await labXY(p, '손익담당'); await p.mouse.click(xy[0], xy[1] + 45);
  await p.waitForSelector('#ofcTalk', { timeout: 120000 });
  ok(/손익담당 와 대화/.test(await p.textContent('#ofcPh')), '대화창 제목', await p.textContent('#ofcPh'));
  await p.locator('#ofcIn2').click(); await p.keyboard.type('11월 재무손익이 얼마야?'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('.ofc-msg.me').length === 1, null, { timeout: 10000 });
  const sent = DB.sk_channel[DB.sk_channel.length - 1];
  ok(DB.sk_channel.length === selBefore + 1 && sent.topic === '사무실 · 손익담당' && sent.quick === true && sent.recipient === 'Claude' && sent.sender === 'hong' && sent.status === '대기' && sent.reply_to === null && sent.author_email === HONG, '보낸 말 = ⚡ 빠른 질문 글, 주제 「사무실 · 손익담당」', sent);
  ok(/답을 기다리는 중/.test(await p.textContent('#ofcChat')), '답을 기다리는 표시');
  ok((await p.textContent('#ofcCnt')) === '2', '내가 보낸 말은 창구 숫자에 안 들어간다');
  // 중계가 답한 것처럼 글을 넣는다
  sent.status = '답변'; sent.updated_at = new Date().toISOString();
  DB.sk_channel.push(row({ id: sent.id + 1, at: new Date().toISOString(), sender: 'Claude', recipient: 'hong', topic: '11월 재무손익', status: '안내', reply_to: sent.id, quick: true, body: '11월 재무손익은 Δ222.8억입니다.\n- **근거**: 2차안\n\n<<<자세히\n근거\n자세히>>>' }));
  await p.evaluate(() => window.SonikChannel.reload());
  await p.waitForFunction(() => document.querySelectorAll('#ofcChat .ofc-msg:not(.me):not(.wait)').length === 1, null, { timeout: 10000 });
  const ans = await p.textContent('#ofcChat .ofc-msg:not(.me)');
  ok(/Δ222\.8억/.test(ans) && !/자세히/.test(ans), '답이 대화창에 뜬다(자세히 묶음은 뺌)', ans);
  ok(await p.evaluate(() => { const b = document.querySelector('#ofcChat .ofc-msg:not(.me) b'); return !!b && b.textContent === '근거' && !/\*\*/.test(document.getElementById('ofcChat').textContent); }), '답의 **굵게** 는 굵은 글씨로');
  ok(await p.evaluate(() => [...document.querySelectorAll('.ofc-say')].some((e) => !e.hidden && /손익담당/.test(e.textContent) && /222\.8/.test(e.textContent))), '답이 오면 손익담당 말풍선');
  // 입력 중에 답이 와도 적던 글이 남는다 + 이어 묻기는 앞 답에 이어 쓴다
  await p.locator('#ofcIn2').click(); await p.keyboard.type('관리손익은?');
  DB.sk_channel.push(row({ id: 99, at: new Date().toISOString(), sender: 'Claude', recipient: 'hong', topic: '다른 일', status: '안내', body: '다른 알림' })); await p.evaluate(() => window.SonikChannel.reload());
  ok((await p.inputValue('#ofcIn2')) === '관리손익은?', '다른 글이 와도 적던 글이 남는다');
  await p.keyboard.press('Enter'); await p.waitForFunction(() => document.querySelectorAll('.ofc-msg.me').length === 2, null, { timeout: 10000 });
  const s2 = DB.sk_channel[DB.sk_channel.length - 1];
  const nAfter2 = DB.sk_channel.length;
  ok(s2.topic === '사무실 · 손익담당' && s2.reply_to === sent.id + 1, '이어 묻기는 앞 답에 이어 쓴다', s2);
  ok(await p.evaluate(() => document.querySelectorAll('#ofcChat .ofc-msg').length) === 4, '대화 4줄(질문·답·질문·기다림)', await p.evaluate(() => document.querySelectorAll('#ofcChat .ofc-msg').length));
  // 명함은 필요할 때만
  await p.click('#ofcCard'); ok(/명함/.test(await p.textContent('#ofcPh')) && /재무손익/.test(await p.textContent('#ofcPb')), '명함 보기'); await p.click('#ofcBack'); await p.waitForSelector('#ofcTalk');
  ok(await p.evaluate(() => document.querySelectorAll('.ofc-msg.me').length) === 2, '대화로 돌아오면 대화가 그대로');
  // 대화창 끌기(hong 11-22 「기존 챗봇창처럼 드래그로 자유롭게」): 머리줄 = 위치, 모서리·가장자리 = 크기, 기억, 두 번 누르면 처음 자리
  const R0 = await p.evaluate(() => { const r = document.getElementById('ofcPop').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const ph = await p.locator('#ofcPh .grow').boundingBox();
  await p.mouse.move(ph.x + 20, ph.y + 10); await p.mouse.down(); await p.mouse.move(ph.x - 200, ph.y + 60, { steps: 6 }); await p.mouse.up();
  const R1 = await p.evaluate(() => { const r = document.getElementById('ofcPop').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  ok(Math.abs(R1.l - (R0.l - 220)) < 3 && Math.abs(R1.t - (R0.t + 50)) < 3, '머리줄을 끌면 대화창이 옮겨진다', [R0, R1]);
  const se = await p.locator('#ofcPop .ofc-rz-se').boundingBox();
  await p.mouse.move(se.x + 7, se.y + 7); await p.mouse.down(); await p.mouse.move(se.x + 127, se.y + 87, { steps: 6 }); await p.mouse.up();
  const R2 = await p.evaluate(() => { const r = document.getElementById('ofcPop').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  ok(Math.abs(R2.w - (R1.w + 120)) < 3 && Math.abs(R2.h - (R1.h + 80)) < 3 && Math.abs(R2.l - R1.l) < 2, '모서리를 끌면 크기가 바뀐다', [R1, R2]);
  const w0 = await p.locator('#ofcPop .ofc-rz-w').boundingBox();
  await p.mouse.move(w0.x + 3, w0.y + 30); await p.mouse.down(); await p.mouse.move(w0.x - 57, w0.y + 30, { steps: 4 }); await p.mouse.up();
  const R3 = await p.evaluate(() => { const r = document.getElementById('ofcPop').getBoundingClientRect(); return { l: r.left, w: r.width, r: r.right }; });
  ok(Math.abs(R3.w - (R2.w + 60)) < 3 && Math.abs(R3.r - (R2.l + R2.w)) < 2, '왼쪽 가장자리를 끌면 오른쪽은 그대로 두고 넓어진다', [R2, R3]);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sonik.ofc.box') || 'null'));
  ok(saved && Math.abs(saved.w - R3.w) < 2, '크기·위치를 기억한다', saved);
  ok(DB.sk_channel.length === nAfter2, '끄는 동안 글이 새로 생기지 않는다');
  await p.click('#ofcPx');
  await p.click('#ofcLog'); const RL = await p.evaluate(() => { const r = document.getElementById('ofcPop').getBoundingClientRect(); return { l: r.left, w: r.width }; });
  ok(Math.abs(RL.l - R3.l) < 2 && Math.abs(RL.w - R3.w) < 2, '다시 열어도 옮긴 자리·크기 그대로', [R3, RL]);
  await p.dblclick('#ofcPh .grow'); const RD = await p.evaluate(() => { const r = document.getElementById('ofcPop').getBoundingClientRect(); return { l: r.left, w: r.width }; });
  ok(Math.abs(RD.w - R0.w) < 2 && Math.abs(RD.l - R0.l) < 2 && !(await p.evaluate(() => localStorage.getItem('sonik.ofc.box'))), '머리줄 두 번 누르면 처음 자리', [R0, RD]);
  await p.click('#ofcPx');
  // 가만히 있을 때는 다시 그리지 않는다(hong 11-22): 1초 동안 그린 장수가 거의 0, 확대 단추를 누르면 다시 그린다
  let idle = null;
  for (let i = 0; i < 12 && !idle; i++) { const a0 = (await p.evaluate(() => window.SonikOffice.stats())).frames; await p.waitForTimeout(1000); const a1 = (await p.evaluate(() => window.SonikOffice.stats())).frames; if (a1 - a0 <= 3) idle = a1 - a0; }
  ok(idle !== null, '가만히 있으면 1초에 3장 이하로 그린다', idle);
  const f0 = (await p.evaluate(() => window.SonikOffice.stats())).frames; await p.click('#ofcIn'); await p.waitForTimeout(300);
  ok((await p.evaluate(() => window.SonikOffice.stats())).frames > f0, '확대하면 다시 그린다');
  await p.click('#ofcOut');
  // 다른 담당도 연결(hong 11-22 「다음 담당자로 이어가자」): 구매담당 = Claude 앞, Codex 검증 = Codex 앞, 각자 새 대화
  xy = await labXY(p, '구매담당'); await p.mouse.click(xy[0], xy[1] + 45);
  await p.waitForFunction(() => /구매담당 와 대화/.test(document.getElementById('ofcPh').textContent), null, { timeout: 120000 });
  ok(!(await p.evaluate(() => document.getElementById('ofcIn2').disabled)), '구매담당도 말을 걸 수 있다');
  await p.fill('#ofcIn2', '1월 납사 구매가는?'); await p.press('#ofcIn2', 'Enter');
  await p.waitForFunction(() => document.querySelectorAll('#ofcChat .ofc-msg.me').length === 1, null, { timeout: 10000 });
  const s3 = DB.sk_channel[DB.sk_channel.length - 1];
  ok(s3.topic === '사무실 · 구매담당' && s3.recipient === 'Claude' && s3.reply_to === null && s3.quick === true, '구매담당 글 = 주제 「사무실 · 구매담당」 새 대화', s3);
  xy = await labXY(p, 'Codex 검증'); await p.mouse.click(xy[0], xy[1] + 45);
  await p.waitForFunction(() => /Codex 검증 와 대화/.test(document.getElementById('ofcPh').textContent), null, { timeout: 120000 });
  await p.fill('#ofcIn2', 'v409 재현 확인해 줘'); await p.press('#ofcIn2', 'Enter');
  await p.waitForFunction(() => document.querySelectorAll('#ofcChat .ofc-msg.me').length === 1, null, { timeout: 10000 });
  const s4 = DB.sk_channel[DB.sk_channel.length - 1];
  ok(s4.topic === '사무실 · Codex 검증' && s4.recipient === 'Codex' && s4.reply_to === null, 'Codex 검증 글은 Codex 앞으로', s4);
  ok(await p.evaluate(() => document.querySelectorAll('.ofc-lab.off').length) === 0, '연결 안 된(흐린) 담당이 없다');
  // 오간 일
  await p.click('#ofcLog'); ok(/hong → 손익담당/.test(await p.textContent('#ofcPb')) && /Codex 검증 → hong/.test(await p.textContent('#ofcPb')), '오간 일에 담당 이름으로 나온다', await p.textContent('#ofcPb'));
  // 실행 중인 글 → 그 담당이 일하는 표시
  s2.run_state = '실행중'; s2.run_note = 'Claude'; s2.updated_at = new Date().toISOString(); await p.evaluate(() => window.SonikChannel.reload());
  ok(await p.evaluate(() => [...document.querySelectorAll('.ofc-lab.work')].map((e) => e.textContent.trim()).join()) === '손익담당', '중계가 실행 중이면 그 담당만 일하는 표시', await p.evaluate(() => [...document.querySelectorAll('.ofc-lab.work')].map((e) => e.textContent.trim()).join()));
  // 새 대기 글 → 창구 숫자
  DB.sk_channel.push(row({ id: 120, at: new Date().toISOString(), sender: 'Claude', recipient: 'hong', topic: '확인 요청', status: '대기', body: '확인 부탁드립니다.' })); await p.evaluate(() => window.SonikChannel.reload());
  await p.waitForFunction(() => document.getElementById('ofcCnt').textContent === '3', null, { timeout: 10000 }); ok(true, '새 대기 글이 오면 창구 숫자가 는다');
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  // 기존 챗봇은 그대로: 창구 단추 → 챗봇 팝업
  await p.click('#ofcCount'); await p.waitForFunction(() => !document.getElementById('chCard').hidden, null, { timeout: 5000 });
  ok(/내 대기 3/.test(await p.textContent('#chMine')), '창구 단추가 기존 챗봇을 연다', await p.textContent('#chMine'));
  ok(await p.evaluate(() => /사무실 · 손익담당/.test(document.getElementById('chRows').textContent)), '사무실에서 보낸 말이 기존 챗봇에도 보인다');
  await p.click('#chClose'); await p.click('#ofcClose');
  ok(await p.evaluate(() => document.getElementById('ofc').hidden && !document.getElementById('vList').hidden), '닫으면 원래 목록 화면');
  ok(!p.errs.length, 'hong 화면 오류 없음', p.errs);
  await br.close(); server.close();
  console.log('통과 ' + pass + ' / 실패 ' + fail); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
