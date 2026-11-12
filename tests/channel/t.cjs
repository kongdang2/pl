// 챗봇 화면 시험(가짜 Supabase, 실데이터 없음): 자세히 접기 · 선택 단추 · 에이전트 글 묶음 · 시스템 알림 · 내 차례 띠 · 상황 한 줄 · 바뀐 글만 읽기
// 실행: node tests/channel/t.cjs   (화면 그림을 남기려면 SHOT=경로)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const chat = idx.slice(idx.indexOf('<button id="chFab"'), idx.indexOf('</section>', idx.indexOf('id="chCard"')) + 10);
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'channel.js'), 'utf8');
const T = (min) => new Date(Date.now() - (60 - min) * 60000).toISOString();
const long = '예전 형식의 긴 답입니다.\n\n' + Array.from({ length: 12 }, (_, i) => '- **항목' + i + '**: `검증자료/v900/파일' + i + '.md` 설명 글자를 길게 늘여 쓴 줄입니다 abcdef0' + i).join('\n') + '\n\n1. 진행할까요?\n2. 묶을까요?';
const rows = [
  { id: 1, at: T(0), sender: 'hong', recipient: 'Claude', topic: '수정요청 #7', status: '답변', body: '왼쪽 열 넓혀줘', request_id: 7 },
  { id: 2, at: T(1), sender: 'Claude', recipient: 'Codex', topic: '수정요청 #7', status: '답변', reply_to: 1, body: 'v900 을 만들었습니다. 교차검증을 부탁드립니다.\n\n- **엔진**: `a.html` 1234abcd', request_id: 7 },
  { id: 3, at: T(2), sender: 'Codex', recipient: 'Claude', topic: '수정요청 #7', status: '답변', reply_to: 2, body: '보류했습니다. 결함 1건.', request_id: 7 },
  { id: 4, at: T(3), sender: 'Claude', recipient: 'Codex', topic: '수정요청 #7', status: '대기', reply_to: 3, body: '고쳤습니다. 다시 봐 주세요.', request_id: 7, run_state: '실행중', run_note: 'Codex', live: [{ at: T(48), a: 'Codex', k: 'run', s: 'node runner' }] },
  { id: 5, at: T(4), sender: 'Claude', recipient: 'hong', topic: '웹 엔진 자동 갱신', status: '안내', body: '[웹 엔진 자동 갱신] 웹 엔진을 **v899-1** 로 바꿨습니다.\n\n- **기록**: `웹테스트`' },
  { id: 6, at: T(5), sender: 'Claude', recipient: 'hong', topic: '수정요청 #8', status: '대기', request_id: 8,
    body: '검증을 통과했습니다. 운영본으로 올릴까요?\n\n- **바뀐 점**: 왼쪽 열이 넓어집니다\n\n<<<선택\n질문: 운영본으로 올릴까요?\n- 운영 반영\n- 보류\n선택>>>\n\n<<<자세히\n- **파일**: `손익추정_시험_v900.html` deadbeef\n- **시험**: 새 시험 PASS\n자세히>>>' },
  { id: 7, at: T(6), sender: 'Codex', recipient: 'hong', topic: 'v901', status: '대기', body: long },
  { id: 8, at: T(7), sender: 'Claude', recipient: 'hong', topic: 'v902', status: '대기',
    body: '두 가지를 정해 주세요.\n\n<<<선택\n질문: 묶을까요?\n- 묶음\n- 따로\n선택>>>\n\n<<<선택\n질문: 교차검증은?\n- 정식\n- 생략\n선택>>>' },
].map((r) => Object.assign({ reply_to: null, files: [], quick: false, live: [], run_state: null, run_note: null, owner: null, author_email: 'x@y', updated_at: r.at }, r));

const fake = `
window.__db = { sk_channel: ${JSON.stringify(rows)}, sk_relay: [{ id: 1, heartbeat: new Date().toISOString(), paused: false }], sk_requests: [{ id: 7, title: 'a', stage: 1, status: '진행' }, { id: 8, title: 'b', stage: 0, status: '접수' }] };
window.__calls = [];
function q(table) {
  const st = { table, f: [], op: 'select', lim: 1e9, v: null };
  const run = () => {
    let rs = window.__db[table] || [];
    window.__calls.push({ table, op: st.op, f: st.f.map((x) => x[0] + ':' + x[1]) });
    if (st.op === 'insert') { const r = Object.assign({ id: Math.max(0, ...rs.map((x) => x.id)) + 1, at: new Date().toISOString(), updated_at: new Date().toISOString(), live: [], run_state: null }, st.v); rs.push(r); return { data: [r], error: null }; }
    for (const [k, c, v] of st.f) rs = rs.filter((r) => k === 'eq' ? r[c] === v : k === 'gt' ? r[c] > v : k === 'in' ? v.includes(r[c]) : true);
    if (st.op === 'update') { rs.forEach((r) => Object.assign(r, st.v)); return { data: rs, error: null }; }
    rs = rs.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, st.lim);
    return { data: st.one ? rs[0] || null : rs, error: null };
  };
  const p = { select() { return p; }, order() { return p; }, limit(n) { st.lim = n; return p; }, eq(c, v) { st.f.push(['eq', c, v]); return p; }, gt(c, v) { st.f.push(['gt', c, v]); return p; }, in(c, v) { st.f.push(['in', c, v]); return p; },
    insert(v) { st.op = 'insert'; st.v = v; return p; }, update(v) { st.op = 'update'; st.v = v; return p; }, maybeSingle() { st.one = true; return p; }, then(a, b) { return Promise.resolve(run()).then(a, b); } };
  return p;
}
window.__sb = { from: q, auth: { getSession: async () => ({ data: { session: { user: { email: 'h@x' } } } }) }, storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  channel() { const c = { on() { return c; }, subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 5); return c; } }; return c; } };
`;
const html = '<!doctype html><meta charset="utf-8"><style>' + css + '</style><div id="modal" hidden></div>' + chat + '<script>' + fake + '</script><script>' + js + '</script>';

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: process.env.SHOT ? 2 : 1 });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  // 브라우저 저장소(본 위치)를 쓰려고 빈 문서 대신 가짜 주소로 연다
  await pg.route('http://chat.test/', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await pg.goto('http://chat.test/');
  let fail = 0;
  const ok = (name, c, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : ' ' + JSON.stringify(extra))); if (!c) fail++; };
  const txt = (s) => pg.$$eval(s, (xs) => xs.map((x) => x.textContent));
  await pg.evaluate(() => window.SonikChannel.mount(window.__sb, { role: 'admin', email: 'h@x' }));
  await pg.click('#chFab'); await pg.waitForSelector('.cm'); await pg.waitForTimeout(150);

  if (process.env.SHOT) { await pg.click('#chSize'); await pg.waitForTimeout(100); await pg.screenshot({ path: process.env.SHOT }); await pg.click('#chSize'); }
  const folds = await txt('.a2a-tg');
  ok('에이전트 글 3개가 한 줄로 묶임(주제·단계·마지막 글 첫 줄)', folds.length === 1 && /글 3개/.test(folds[0]) && /고쳤습니다/.test(folds[0]) && /작업중/.test(folds[0]), folds);
  ok('묶인 글 본문은 안 보임', !(await pg.$eval('#chRows', (x) => x.textContent)).includes('1234abcd'));
  await pg.click('.a2a-tg');
  ok('묶음을 누르면 펼쳐짐', (await pg.$$('.a2a-box > .cm.them')).length === 3 && (await pg.$eval('#chRows', (x) => x.textContent)).includes('1234abcd'));
  await pg.click('.a2a-tg');

  const sys = await txt('.sys-tg');
  ok('시스템 알림은 한 줄', sys.length === 1 && /웹 엔진을 v899-1 로 바꿨습니다/.test(sys[0]) && !/기록/.test(sys[0]), sys);

  ok('자세히 블록은 접혀 있음', !(await pg.$eval('#chRows', (x) => x.textContent)).includes('deadbeef') && (await pg.$$('#ch6 .more-tg')).length === 1);
  ok('블록 표시 글자(<<< >>>)가 화면에 안 나옴', !/<<<|>>>/.test(await pg.$eval('#chRows', (x) => x.textContent)));
  await pg.click('#ch6 .more-tg');
  ok('자세히를 누르면 펼쳐짐', (await pg.$eval('#ch6', (x) => x.textContent)).includes('deadbeef'));

  const old = await pg.$eval('#ch7 .bub', (x) => x.textContent);
  ok('옛 형식 긴 글: 첫 문단과 끝 번호 목록만 보임', /예전 형식의 긴 답/.test(old) && /진행할까요/.test(old) && !/항목5/.test(old) && (await pg.$$('#ch7 .more-tg')).length === 1, old.slice(0, 200));

  const turn = await pg.$eval('#chTurn', (x) => (x.hidden ? '' : x.textContent));
  ok('내 차례 3건', /내 차례 3건/.test(turn) && /두 가지를 정해/.test(turn), turn);
  const now = await pg.$eval('#chNow', (x) => (x.hidden ? '' : x.textContent));
  ok('상황 한 줄: 누가 · 몇 분째 · 주제', /Codex 작업 중/.test(now) && /1[12]분째/.test(now) && /수정요청 #7/.test(now), now);
  ok('요청 단계 표시', /접수/.test(await pg.$eval('#ch6 .stgc b', (x) => x.textContent)));

  ok('선택 단추 2개', (await pg.$$('#ch6 .pick-b button')).length === 2);
  await pg.click('#ch6 .pick-b button:first-child'); await pg.waitForSelector('#ch6 .pick.done');
  const db = await pg.evaluate(() => window.__db.sk_channel);
  const sent = db[db.length - 1];
  ok('누르면 「선택: 운영 반영」 글이 그 답에 이어 올라감', sent.body === '선택: 운영 반영' && sent.reply_to === 6 && sent.recipient === 'Claude' && sent.topic === '수정요청 #8' && sent.status === '대기' && sent.sender === 'hong', sent);
  ok('원글은 답변으로 바뀌고 카드에 고른 것이 남음', db.find((r) => r.id === 6).status === '답변' && /✔ 운영 반영/.test(await pg.$eval('#ch6 .pick', (x) => x.textContent)));

  const before = db.length;
  await pg.click('#ch8 [data-pick="8:0:1"]');
  ok('선택이 여럿이면 다 고를 때까지 보내지 않음', (await pg.evaluate(() => window.__db.sk_channel.length)) === before && (await pg.$eval('#ch8 .pick-go', (x) => x.disabled)));
  await pg.click('#ch8 [data-pick="8:1:0"]'); await pg.click('#ch8 .pick-go'); await pg.waitForSelector('#ch8 .pick.done');
  const s2 = (await pg.evaluate(() => window.__db.sk_channel)).pop();
  ok('선택이 여럿이면 한 글로 보냄', s2.body === '선택: 묶을까요? → 따로\n선택: 교차검증은? → 정식' && s2.reply_to === 8, s2);

  await pg.evaluate(() => { window.__calls.length = 0; });
  await pg.click('#chClose'); await pg.click('#chFab'); await pg.waitForTimeout(200);
  const calls = (await pg.evaluate(() => window.__calls)).filter((c) => c.table === 'sk_channel' && c.op === 'select');
  ok('다시 열 때는 바뀐 글만 읽음(updated_at 조건)', calls.length >= 1 && calls.every((c) => c.f.some((f) => /^gt:updated_at/.test(f))), calls);

  // hong 11-13: 말풍선을 눌러 열어도 숫자가 안 없어짐 — 바뀐 글이 없으면 바뀐 글만 읽기가 일찍 끝나 「본 위치」를 안 바꿨다
  await pg.evaluate(() => localStorage.setItem('sonik.ch.seen', '0'));
  await pg.click('#chClose'); await pg.waitForTimeout(50);
  const shown = await pg.$eval('#chBadge', (x) => (x.hidden ? '' : x.textContent));
  await pg.click('#chFab'); await pg.waitForTimeout(200); await pg.click('#chClose'); await pg.waitForTimeout(50);
  const after = await pg.$eval('#chBadge', (x) => (x.hidden ? '' : x.textContent));
  ok('바뀐 글이 없어도 열었다 닫으면 숫자가 없어짐', !!shown && after === '', { shown, after });
  await pg.click('#chFab'); await pg.waitForTimeout(200);

  await pg.click('#chFold');
  ok('접기를 끄면 모든 글이 그대로 보임', (await pg.$$('.a2a-tg')).length === 0 && (await pg.$$('.sys-tg')).length === 0 && (await pg.$$('#ch2')).length === 1);
  await pg.click('#chFold');

  await pg.evaluate(() => window.SonikChannel.mount(window.__sb, { role: 'writer', email: 'm@x' }));
  await pg.waitForTimeout(200);
  ok('담당자 화면: 접기 단추·상황·내 차례 없음', (await pg.$eval('#chFold', (x) => x.hidden)) && (await pg.$eval('#chNow', (x) => x.hidden)) && (await pg.$eval('#chTurn', (x) => x.hidden)) && (await pg.$$('.a2a-tg')).length === 0);
  ok('화면 오류 없음', !errs.length, errs);

  await b.close();
  console.log(fail ? 'FAIL ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
