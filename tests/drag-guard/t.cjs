// node tests/drag-guard/t.cjs — 칸 글자 끌어 옮기기 막기(hong 11-27 「재발방지도」) Playwright 조작 시험. 가짜 엔진, 실데이터 없음
// 사고: 표 칸의 글자가 선택된 채로 끌어 다른 칸에 놓으면 브라우저가 글자를 옮긴다(원래 칸 0, 놓인 칸은 이어 붙음).
//  엔진 표는 칸을 누르는 순간 그 칸 글자를 모두 선택하므로, 범위를 잡으려고 칸을 누른 채 다른 칸까지 끌기만 해도 난다.
// A) 막지 않은 문서(가짜 엔진을 그냥 연 것)에서는 실제로 옮겨지는지 먼저 확인(= 이 시험의 조작이 사고를 재현함)
// B) 웹이 엔진을 띄우는 길(SonikEngine.mount)로 연 문서에서는 같은 조작에 값이 그대로인지
// LOADER=<파일> 을 주면 그 engine-loader.js 로 시험한다(이전 판으로 돌리면 B 가 실패해야 한다)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../..'), PORT = 8811;
const LOADER = process.env.LOADER ? path.resolve(process.env.LOADER) : path.join(REPO, 'engine-loader.js');
const ENG = fs.readFileSync(path.join(__dirname, 'engine.html'), 'utf8');
const HOST = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}.engine-frame{width:1200px;height:420px;border:0;margin:40px 0 0 25px}</style></head>'
  + '<body><div id="c"></div><script src="/engine-loader.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const send = (ct, body) => { res.writeHead(200, { 'content-type': ct + '; charset=utf-8' }); res.end(body); };
  if (u === '/host.html') return send('text/html', HOST);
  if (u === '/engine.html') return send('text/html', ENG);
  if (u === '/engine-loader.js') return send('text/javascript', fs.readFileSync(LOADER));
  res.writeHead(404); res.end();
}).listen(PORT);
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m, x !== undefined ? JSON.stringify(x) : ''); } };

// f = 엔진 문서(그냥 연 쪽은 page.mainFrame(), 웹으로 띄운 쪽은 iframe). 좌표는 늘 맨 바깥 화면 기준(boundingBox)
const box = (f, sel) => f.locator(sel).boundingBox();
const state = (f) => f.evaluate(() => ({ q: T.q(), v: T.v() }));
const blur = async (p) => { await p.mouse.click(5, 5); await p.waitForTimeout(150); };
// 칸 글자를 모두 선택한 채(두 번 눌러 고치는 상태 + Ctrl+A) 끌어서 다른 칸 끝에 놓는다
async function dragCellText(p, f, from, to, how) {
  const a = await box(f, from); const y = a.y + a.height / 2, x = a.x + a.width - 30;
  await p.mouse.dblclick(x, y);
  await p.keyboard.press(how === 'shiftHome' ? 'End' : 'Control+a'); if (how === 'shiftHome') await p.keyboard.press('Shift+Home');
  await p.waitForTimeout(150);
  const b = await box(f, to);
  await p.mouse.move(x, y); await p.mouse.down();
  await p.mouse.move(x + 8, y, { steps: 3 }); await p.mouse.move(a.x + a.width + 30, y, { steps: 4 });
  await p.mouse.move(b.x + b.width - 6, b.y + b.height / 2, { steps: 15 }); await p.mouse.up(); await p.waitForTimeout(250);
  await blur(p);
}
// 범위 선택 동작: 처음 누르는 칸에서 바로 다른 칸까지 끈다(엔진 표처럼 누르는 순간 글자 전체 선택 = SEL)
async function pressDrag(p, f, from, to) {
  await f.evaluate(() => { window.SEL = 1; });
  const a = await box(f, from), b = await box(f, to); const y = a.y + a.height / 2, x = a.x + a.width - 30;
  await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(b.x + b.width - 6, b.y + b.height / 2, { steps: 15 }); await p.mouse.up(); await p.waitForTimeout(250);
  await blur(p);
}
// 칸 밖 글자(세 번 눌러 선택)를 끌어 칸에 놓는다
async function dragOutsideText(p, f, to) {
  const a = await box(f, '#txt'); const y = a.y + a.height / 2, x = a.x + 20;
  await p.mouse.click(x, y, { clickCount: 3 }); await p.waitForTimeout(150);
  const b = await box(f, to);
  await p.mouse.move(x, y); await p.mouse.down();
  await p.mouse.move(x + 10, y + 3, { steps: 3 }); await p.mouse.move(b.x + b.width - 6, b.y + b.height / 2, { steps: 15 }); await p.mouse.up(); await p.waitForTimeout(250);
  await blur(p);
}

(async () => {
  const br = await chromium.launch();
  const mk = async () => { const p = await br.newPage({ viewport: { width: 1300, height: 600 } }); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); return p; };
  const plain = async () => { const p = await mk(); await p.goto('http://127.0.0.1:' + PORT + '/engine.html'); return [p, p.mainFrame()]; };
  const web = async () => {
    const p = await mk(); await p.goto('http://127.0.0.1:' + PORT + '/host.html');
    await p.evaluate(async () => { const html = await (await fetch('/engine.html')).text(); window.M = await SonikEngine.mount(document.getElementById('c'), html, () => {}, 20000); });
    return [p, p.frames().find((x) => x !== p.mainFrame())];
  };
  const SAME = { q: { jan: 13374.825, oct: 9463.525 }, v: { jan: '13374.825', oct: '9463.525' } };
  const same = (s) => JSON.stringify(s) === JSON.stringify(SAME);

  // A) 막지 않은 문서: 사고가 그대로 난다
  let [p, f] = await plain();
  await dragCellText(p, f, '#jan', '#oct');
  let s = await state(f);
  ok(s.q.jan === 0 && s.v.oct === '9463.52513374.825' && s.q.oct === 9463.52513374, 'A① 막지 않으면 1월 글자가 10월 칸으로 옮겨진다 (1월 0, 10월 9463.52513374)', s);
  await p.close();
  [p, f] = await plain();
  await dragOutsideText(p, f, '#oct');
  s = await state(f);
  ok(s.v.oct !== '9463.525' && /77777\.5/.test(s.v.oct), 'A② 막지 않으면 칸 밖 글자도 칸에 놓인다', s);
  await p.close();
  [p, f] = await plain();
  await pressDrag(p, f, '#jan', '#oct');
  s = await state(f);
  ok(s.q.jan === 0 && s.q.oct === 9463.52513374, 'A③ 막지 않으면 칸을 누른 채 다른 칸까지 끌기만 해도(범위 선택 동작) 옮겨진다', s);
  await p.close();

  // B) 웹이 띄운 엔진(SonikEngine.mount): 같은 조작에 값이 그대로
  for (const how of ['ctrlA', 'shiftHome']) {
    [p, f] = await web();
    await dragCellText(p, f, '#jan', '#oct', how);
    s = await state(f);
    ok(same(s), 'B① 칸 글자를 선택한 채 끌어 놓아도 두 칸 그대로 (' + how + ')', s);
    ok(p.errs.length === 0, 'B① 화면 오류 없음 (' + how + ')', p.errs);
    await p.close();
  }
  [p, f] = await web();
  await pressDrag(p, f, '#jan', '#oct');
  s = await state(f);
  ok(same(s), 'B① 칸을 누른 채 다른 칸까지 끌어도(범위 선택 동작) 두 칸 그대로', s);
  await p.close();
  [p, f] = await web();
  await dragOutsideText(p, f, '#oct');
  s = await state(f);
  ok(same(s), 'B② 칸 밖 글자를 끌어 칸에 놓아도 그대로', s);

  // B③ 파일 끌어 놓기는 막지 않는다 / 글자 놓기만 막는다 (놓기 사건을 직접 만들어 확인)
  const drops = await f.evaluate(() => {
    const mkDt = (file) => { const dt = new DataTransfer(); if (file) dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' })); else dt.setData('text/plain', '123'); return dt; };
    const fire = (el, dt) => el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); // false = 누가 막음
    const zone = document.getElementById('drop'), cell = document.getElementById('oct');
    fire(zone, mkDt(true));
    return { zoneFiles: window.__FILES || 0, fileOnCell: fire(cell, mkDt(true)), textOnCell: fire(cell, mkDt(false)), textOnDiv: fire(document.getElementById('txt'), mkDt(false)) };
  });
  ok(drops.zoneFiles === 1, 'B③ 업로드 칸의 파일 놓기는 그대로 받는다', drops);
  ok(drops.fileOnCell === true, 'B③ 파일 놓기는 입력 칸 위에서도 막지 않는다', drops);
  ok(drops.textOnCell === false, 'B③ 입력 칸에 글자 놓기는 막는다', drops);
  ok(drops.textOnDiv === true, 'B③ 입력 칸이 아닌 곳은 건드리지 않는다', drops);

  // B④ 평소 조작은 그대로: 칸 고쳐 쓰기, 칸 안에서 마우스로 글자 선택, 복사·붙여넣기
  let a = await box(f, '#jan');
  await p.mouse.dblclick(a.x + a.width - 30, a.y + a.height / 2); await p.keyboard.press('Control+a'); await p.keyboard.type('100.5'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  s = await state(f);
  ok(s.q.jan === 100.5 && s.q.oct === 9463.525, 'B④ 칸에 직접 쓰기', s);
  const b = await box(f, '#oct');
  await p.mouse.click(b.x + b.width - 6, b.y + b.height / 2); await p.keyboard.press('End');
  await p.mouse.move(b.x + b.width - 6, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width - 50, b.y + b.height / 2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150);
  const sel = await f.evaluate(() => { const el = document.getElementById('oct'); return { n: el.selectionEnd - el.selectionStart, v: el.value }; });
  ok(sel.n > 0 && sel.v === '9463.525', 'B④ 칸 안에서 마우스로 끌어 글자 선택', sel);
  await p.keyboard.press('Control+a'); await p.keyboard.press('Control+c');
  a = await box(f, '#jan');
  await p.mouse.click(a.x + a.width - 30, a.y + a.height / 2); await p.keyboard.press('Control+a'); await p.keyboard.press('Control+v'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  s = await state(f);
  ok(s.q.jan === 9463.525 && s.q.oct === 9463.525, 'B④ 복사·붙여넣기', s);

  // B⑤ 두 번 걸어도 한 번만 건다
  const again = await p.evaluate(() => SonikEngine.guardTextDrag(window.M.win));
  ok(again === false, 'B⑤ 이미 건 문서에는 다시 걸지 않는다', again);
  ok(p.errs.length === 0, '화면 오류 없음', p.errs);
  await p.close();

  await br.close(); server.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
