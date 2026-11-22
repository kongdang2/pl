// 사무실 — hong(관리자)에게만 보이는 시험 메뉴(hong 11-22). 기존 화면·기능은 건드리지 않고 덧붙인다.
// 챗봇(sk_channel)에 이미 읽어 둔 글로 그린다: 따로 주기 조회를 하지 않는다(SonikChannel.watch).
//  - 주황 상자 = hong 이 답해야 하는 「대기」 글. 누르면 기존 💬 챗봇이 열린다.
//  - 담당은 평소 자리에 있고, 실제로 일할 때(중계 실행 중)만 손을 움직이고, 답이 오면 말풍선이 뜬다.
//  - hong 캐릭터: 바닥을 누르면 걸어가고, 담당을 누르면 다가가 대화창이 열린다.
//  - 대화창에 적은 말은 주제 「사무실 · <담당>」 인 ⚡ 빠른 질문 글로 올라가고, PC 중계가 답한다(LIVE 인 담당만, 11-22 부터 9 모두).
// 3D 는 열 때만 vendor/three-r128.min.js 를 받는다(담당자에게는 내려가지 않는다).
(function () {
  const AG = [
    { id: 'sales', name: '판매담당', role: '온산·울산 판매정보, 판매 포뮬러와 판가 (부서 업로드 원자료)', menu: '판매정보 · 판가' },
    { id: 'buy', name: '구매담당', role: '온산·울산 구매정보, 구매 포뮬러와 구매가 (부서 업로드 원자료)', menu: '구매정보 · 구매가' },
    { id: 'sup', name: '수급담당', role: '온산·울산 생산월보, 수급밸런스, 재고 수량', menu: '생산월보 · 수급밸런스' },
    { id: 'dev', name: '개발담당', role: '엔진과 웹 수정 총괄 (반영은 hong 승인 뒤)', menu: '수정요청 목록' },
    { id: 'mkt', name: '시황담당', role: '국제가격 기준치와 스프레드 설정', menu: '기준가격' },
    { id: 'cost', name: '원가담당', role: '본사 판관비, 온산·울산 원가, 제조원가명세서, 예산', menu: '원가 · 예산' },
    { id: 'pnl', name: '손익담당', role: '재무손익·관리손익 전체 메뉴, 차이분석 등 분석, 재고평가, 공제부 등가계수', menu: '전사요약 · 재무/관리손익 · 차이분석' },
    { id: 'codex', name: 'Codex 검증', role: '교차검증, 숫자 재현, 코드 검토. 필요하면 다른 담당 일을 나눠 맡음', menu: '챗봇 · 검증자료', col: 0x3f74c9, cls: 'cx', by: 'Codex' },
    { id: 'head', name: '총괄', role: '전체 담당 관리, 보고서 초안, hong 소통', menu: '챗봇 · 자료 목록' },
  ];
  // 실제 답에 연결한 담당. 11-22 손익담당 → hong 「다음 담당자로 이어가자」로 Claude 담당 8 모두와 Codex 연결
  const LIVE = { pnl: true, head: true, dev: true, sales: true, buy: true, sup: true, mkt: true, cost: true, codex: true };
  const TOPIC = '사무실 · ';
  const byId = Object.fromEntries(AG.map((a) => [a.id, a])); byId.hong = { id: 'hong', name: 'hong', col: 0xe8590c, cls: 'hg' };
  const byName = Object.fromEntries(AG.map((a) => [a.name, a]));
  const POS = { sales: [-8, -5], buy: [-3.5, -5], sup: [1, -5], dev: [5.5, -5], mkt: [-8, 5], cost: [-3.5, 5], pnl: [1, 5], codex: [5.5, 5] };
  const HUB = [5.8, 0], COUNTER = [11, 4.6], SHELF = [11.6, -5.2], MEET = [-3.5, -0.2];
  const P = { bg: 0xe9e4dc, floor: 0xdcc7a4, table: 0xffffff, trim: 0x3a3f47, box: 0xd9c9b0, dark: 0x3a3f47, wall: 0xfbf7ef, top: 1.06 };
  const ACC = 0xe8590c, ROBOT = 0xfbfbf8, JOINT = 0xc6cad1, EYE = 0x23272e;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const clip = (s, n) => { s = String(s || '').replace(/<<<[\s\S]*?>>>/g, ' ').replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  const CSS = `
#btnOffice{white-space:nowrap}
.ofc{position:fixed;inset:0;z-index:30;background:#e9e4dc;color:#22262d;font-size:14px;line-height:1.5;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.ofc[hidden]{display:none}
.ofc.drag{cursor:grabbing}
.ofc canvas{display:block;width:100%;height:100%}
.ofc button{font:inherit;cursor:pointer}
.ofc-top{position:absolute;left:16px;right:16px;top:14px;display:flex;gap:10px;align-items:flex-start;justify-content:space-between;z-index:5;pointer-events:none}
.ofc-top>*{pointer-events:auto}
.ofc-brand{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.ofc-brand h1{margin:0;font-size:17px;font-weight:700}
.ofc-brand h1 span{font-size:11px;font-weight:600;color:#666e7a;margin-left:6px}
.ofc-count{display:flex;align-items:baseline;gap:8px;border:0;background:#fffffff2;color:#22262d;border-radius:16px;padding:8px 18px 10px;font-weight:700;font-size:15px;box-shadow:0 2px 10px #0000001a}
.ofc-count b{font-size:38px;line-height:1;color:#d9480f}
.ofc-count small{font-size:12px;font-weight:500;color:#666e7a}
.ofc-x{border:0;background:#fffffff2;color:#22262d;border-radius:14px;padding:8px 14px;font-weight:700;min-height:40px;box-shadow:0 2px 10px #0000001a}
.ofc-bot{position:absolute;left:16px;right:96px;bottom:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;z-index:5;pointer-events:none}
.ofc-bot>*{pointer-events:auto}
.ofc-chip{border:0;background:#fffffff2;color:#22262d;border-radius:999px;padding:7px 14px;font-weight:600;font-size:13px;min-height:38px;box-shadow:0 2px 8px #00000014}
.ofc-hint{font-size:12px;color:#4d5560;background:#ffffffb8;border-radius:999px;padding:3px 12px;pointer-events:none}
.ofc-lab{position:absolute;transform:translate(-50%,-100%);background:#ffffffeb;border-radius:999px;padding:1px 9px 1px 7px;font-size:11.5px;font-weight:700;color:#22262d;white-space:nowrap;pointer-events:none;line-height:1.5;z-index:2;display:flex;align-items:center;gap:5px;box-shadow:0 1px 4px #00000022}
.ofc-lab i{width:7px;height:7px;border-radius:50%;background:#b6bcc6}
.ofc-lab.work i{background:#22262d;animation:ofcled .6s steps(2) infinite}
.ofc-lab.off{opacity:.6}
.ofc-lab.cx{background:#3f74c9;color:#fff}.ofc-lab.cx i{background:#cfe0fa}.ofc-lab.cx.work i{background:#fff}
.ofc-lab.hg{background:#d9480f;color:#fff}.ofc-lab.hg i{background:#ffd9c2}
.ofc-lab.sel{box-shadow:0 0 0 2px #22262d}
@keyframes ofcled{50%{opacity:.25}}
.ofc-sign{position:absolute;transform:translate(-50%,-50%);font-weight:700;font-size:13px;border-radius:999px;padding:3px 13px;pointer-events:none;white-space:nowrap;z-index:1;line-height:1.5;background:#22262d;color:#fff}
.ofc-sign.w{background:#d9480f;font-size:15px;padding:4px 16px}
.ofc-sign.p{background:#fff;color:#22262d;border:1.5px solid #d9480f;font-size:11.5px;padding:0 9px;z-index:3}
.ofc-say{position:absolute;transform:translate(-50%,-100%);background:#22262d;color:#fff;border-radius:12px;padding:7px 12px 8px;font-size:12.5px;line-height:1.45;width:max-content;max-width:240px;z-index:4;pointer-events:none;box-shadow:0 4px 14px #00000033;white-space:normal}
.ofc-say b{display:block;font-size:11.5px;color:#ffb98a}
.ofc-say::after{content:"";position:absolute;left:50%;bottom:-6px;width:12px;height:12px;background:#22262d;transform:translateX(-50%) rotate(45deg)}
.ofc-pop{position:absolute;right:16px;top:74px;width:360px;max-width:calc(100% - 32px);max-height:calc(100% - 170px);display:flex;flex-direction:column;background:#fff;color:#22262d;border-radius:16px;box-shadow:0 10px 34px #00000038;z-index:6;cursor:default;user-select:text;-webkit-user-select:text}
.ofc-pop[hidden]{display:none}
@media (max-width:640px){.ofc-pop{top:auto;bottom:64px;left:16px;right:16px;width:auto;max-height:60%}.ofc-hint{display:none}.ofc-rz{display:none}}
.ofc-rz{position:absolute;z-index:2;touch-action:none}
.ofc-rz-n,.ofc-rz-s{left:12px;right:12px;height:6px;cursor:ns-resize}.ofc-rz-n{top:-3px}.ofc-rz-s{bottom:-3px}
.ofc-rz-e,.ofc-rz-w{top:12px;bottom:12px;width:6px;cursor:ew-resize}.ofc-rz-e{right:-3px}.ofc-rz-w{left:-3px}
.ofc-rz-ne,.ofc-rz-nw,.ofc-rz-se,.ofc-rz-sw{width:14px;height:14px}.ofc-rz-ne{top:-3px;right:-3px;cursor:nesw-resize}.ofc-rz-sw{bottom:-3px;left:-3px;cursor:nesw-resize}.ofc-rz-nw{top:-3px;left:-3px;cursor:nwse-resize}.ofc-rz-se{bottom:-3px;right:-3px;cursor:nwse-resize}
@media (min-width:641px){.ofc-ph{cursor:move;user-select:none;touch-action:none}}
.ofc-pop.sized{max-height:none;max-width:none}.ofc-pop.sized .ofc-pb{flex:1}
body.ofc-moving{user-select:none;-webkit-user-select:none}
.ofc-ph{display:flex;gap:10px;align-items:center;padding:14px 14px 12px;border-bottom:1px solid #e3e6ea}
.ofc-ph b{font-size:15px}.ofc-ph .sub{font-size:12px;color:#666e7a}.ofc-ph .grow{flex:1;min-width:0}
.ofc-ph button{border:0;background:#f1f3f6;color:#22262d;width:36px;height:36px;border-radius:50%;font-size:16px;line-height:1;flex:none}
.ofc-pb{padding:14px;display:flex;flex-direction:column;gap:12px;overflow:auto;min-height:0}
.ofc-chat{display:flex;flex-direction:column;gap:6px;min-height:64px}
.ofc-msg{max-width:88%;padding:7px 11px;border-radius:12px;font-size:13px;background:#f1f3f6;align-self:flex-start;white-space:pre-wrap;overflow-wrap:anywhere}
.ofc-msg.me{align-self:flex-end;background:#d9480f;color:#fff}
.ofc-msg.wait{color:#666e7a;font-style:italic}
.ofc-talk{display:flex;gap:6px;padding:0 14px 12px}
.ofc-talk input{flex:1;min-width:0;font:inherit;border:1px solid #d5d9e0;background:#fff;color:#22262d;border-radius:10px;padding:8px 10px;min-height:40px}
.ofc-btn{border:0;background:#d9480f;color:#fff;border-radius:10px;padding:8px 14px;font-weight:700;min-height:40px}
.ofc-btn:disabled{opacity:.5;cursor:default}
.ofc-btn.ghost{background:#fff;color:#22262d;border:1px solid #d5d9e0;font-weight:600;margin:0 14px 14px}
.ofc-note{font-size:12px;color:#666e7a;margin:0}
.ofc-pop dl{margin:0;display:grid;grid-template-columns:76px minmax(0,1fr);gap:6px 10px;font-size:13px}
.ofc-pop dt{color:#666e7a;font-weight:600}.ofc-pop dd{margin:0}
.ofc-rep{padding:9px 10px;border-radius:10px;background:#f1f3f6;display:flex;flex-direction:column;gap:3px;font-size:13px;border:0;text-align:left;width:100%}
.ofc-rep span{color:#666e7a}
.ofc-pill{font-size:11px;font-weight:700;border-radius:5px;padding:1px 7px;background:#ffe3cc;color:#c2410c}
.ofc-nogl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;padding:20px;text-align:center}
@media (prefers-reduced-motion:reduce){.ofc *{animation:none!important}}`;

  const st = { sb: null, me: null, rows: [], seen: null, open: false, world: null, cur: null, pop: null, said: {}, loading: null, dirty: 3, frames: 0 };
  let el = null;

  // ── 챗봇 글 → 사무실 상태 ──
  const agentOfTopic = (t) => { t = String(t || ''); return t.startsWith(TOPIC) ? byName[t.slice(TOPIC.length).trim()] || null : null; };
  // 담당별 대화: hong 이 「사무실 · 담당」 주제로 보낸 글과 그 글에 이어진 답
  function threads() {
    const of = new Map(), out = {};
    for (const m of st.rows) {
      let a = null;
      if (m.reply_to != null && of.has(m.reply_to)) a = of.get(m.reply_to);
      else if (m.sender === 'hong' || ((m.sender === 'Claude' || m.sender === 'Codex') && m.recipient === 'hong')) { const g = agentOfTopic(m.topic); if (g) a = g.id; } // 담당이 먼저 건 말(예: 판매담당 자동 점검)도 그 담당 대화로
      if (a) { of.set(m.id, a); (out[a] = out[a] || []).push(m); }
    }
    return { of, out };
  }
  const waitingRows = () => st.rows.filter((m) => m.sender !== 'hong' && (m.recipient === 'hong' || m.recipient === '모두') && m.status === '대기');
  function busyAgents(th) {
    const b = {};
    for (const m of st.rows) {
      if (m.run_state !== '실행중') continue;
      const who = m.run_note || (m.recipient === '모두' ? 'Claude' : m.recipient);
      const a = th.of.get(m.id);
      b[a || (who === 'Codex' ? 'codex' : /수정요청|v\d{3}/.test(m.topic || '') ? 'dev' : 'head')] = m;
    }
    return b;
  }
  function onRows(rows) {
    st.rows = rows || [];
    const first = !st.seen; if (first) st.seen = new Set();
    const th = threads(), fresh = [];
    for (const m of st.rows) { if (!st.seen.has(m.id)) { st.seen.add(m.id); if (!first) fresh.push(m); } }
    if (st.cur) st.cur.sync(th, fresh);
    refreshUi(th);
  }

  // ── 화면 틀 ──
  function ensureDom() {
    if (el) return;
    const css = document.createElement('style'); css.id = 'ofcCss'; css.textContent = CSS; document.head.appendChild(css);
    el = document.createElement('section'); el.className = 'ofc'; el.id = 'ofc'; el.hidden = true;
    el.innerHTML = '<div class="ofc-top"><div class="ofc-brand"><h1>손익 사무실 <span>hong 전용 · 시험 중</span></h1>'
      + '<button class="ofc-count" id="ofcCount" type="button">hong 을 기다리는 일 <b id="ofcCnt">0</b><small>눌러서 챗봇 열기</small></button></div>'
      + '<button class="ofc-x" id="ofcClose" type="button">닫기 ×</button></div>'
      + '<div class="ofc-bot"><button class="ofc-chip" id="ofcLog" type="button">오간 일</button>'
      + '<button class="ofc-chip" id="ofcIn" type="button" aria-label="확대">＋</button><button class="ofc-chip" id="ofcOut" type="button" aria-label="축소">－</button>'
      + '<span class="ofc-hint">바닥을 누르면 hong 이 걸어갑니다 · 담당을 누르면 다가가 말을 겁니다</span></div>'
      + '<div class="ofc-pop" id="ofcPop" hidden><div class="ofc-ph" id="ofcPh"></div><div class="ofc-pb" id="ofcPb"></div><div id="ofcPf"></div></div>';
    document.body.appendChild(el);
    popDrag();
    $('ofcClose').onclick = () => setOpen(false);
    $('ofcCount').onclick = openChat;
    $('ofcLog').onclick = () => ui.open('log');
  }
  // 대화창 크기·위치(hong 11-22 「기존 챗봇창처럼 드래그로 자유롭게」): 가장자리·모서리를 끌어 크기, 머리줄을 끌어 위치. 내 브라우저에 기억(sonik.ofc.box), 머리줄 두 번 누르면 처음 자리로. 좁은 화면은 그대로
  const pbox = {
    get() { try { return JSON.parse(localStorage.getItem('sonik.ofc.box') || 'null'); } catch (_) { return null; } },
    set(v) { try { if (v) localStorage.setItem('sonik.ofc.box', JSON.stringify(v)); else localStorage.removeItem('sonik.ofc.box'); } catch (_) { /* 무시 */ } },
  };
  const P_MIN_W = 300, P_MIN_H = 260, pwide = () => window.innerWidth > 640;
  function placePop(b) {
    const pop = $('ofcPop'); if (!pop) return; const ps = pop.style;
    if (!b || !pwide()) { ps.left = ps.top = ps.width = ps.height = ps.right = ''; pop.classList.remove('sized'); return; }
    const R = el.getBoundingClientRect(), vw = R.width, vh = R.height;
    const w = Math.min(Math.max(b.w, P_MIN_W), vw - 16), h = Math.min(Math.max(b.h, P_MIN_H), vh - 16);
    const l = Math.min(Math.max(b.l, 8), vw - w - 8), t = Math.min(Math.max(b.t, 8), vh - h - 8);
    Object.assign(ps, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px', right: 'auto' }); pop.classList.add('sized');
  }
  function popRect() { const pop = $('ofcPop'), R = el.getBoundingClientRect(), r = pop.getBoundingClientRect(); return { l: r.left - R.left, t: r.top - R.top, w: r.width, h: r.height, R }; }
  function dragWith(g, e, cursor, move) {
    e.preventDefault(); try { g.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
    const r = popRect(), x0 = e.clientX, y0 = e.clientY;
    document.body.classList.add('ofc-moving'); document.body.style.cursor = cursor;
    const mv = (ev) => placePop(move(r, ev.clientX - x0, ev.clientY - y0));
    const up = () => {
      g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
      document.body.classList.remove('ofc-moving'); document.body.style.cursor = '';
      const q = popRect(); pbox.set({ l: Math.round(q.l), t: Math.round(q.t), w: Math.round(q.w), h: Math.round(q.h) });
    };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  }
  function popDrag() {
    const pop = $('ofcPop'), ph = $('ofcPh');
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const g = document.createElement('div'); g.className = 'ofc-rz ofc-rz-' + d;
      g.ondblclick = () => { pbox.set(null); placePop(null); };
      g.onpointerdown = (e) => {
        if (e.button !== 0 || !pwide()) return;
        dragWith(g, e, getComputedStyle(g).cursor, (r, dx, dy) => {
          const b = { l: r.l, t: r.t, w: r.w, h: r.h }, W = r.R.width, H = r.R.height;
          if (d.includes('e')) b.w = Math.min(r.w + dx, W - 8 - r.l);
          if (d.includes('s')) b.h = Math.min(r.h + dy, H - 8 - r.t);
          if (d.includes('w')) { b.w = Math.min(Math.max(r.w - dx, P_MIN_W), r.l + r.w - 8); b.l = r.l + r.w - b.w; }
          if (d.includes('n')) { b.h = Math.min(Math.max(r.h - dy, P_MIN_H), r.t + r.h - 8); b.t = r.t + r.h - b.h; }
          return b;
        });
      };
      pop.appendChild(g);
    }
    ph.ondblclick = (e) => { if (!e.target.closest('button,input,a')) { pbox.set(null); placePop(null); } };
    ph.onpointerdown = (e) => {
      if (e.button !== 0 || !pwide() || e.target.closest('button,input,a')) return;
      dragWith(ph, e, 'move', (r, dx, dy) => ({ l: r.l + dx, t: r.t + dy, w: r.w, h: r.h }));
    };
    window.addEventListener('resize', () => { if (st.pop) placePop(pbox.get()); });
  }
  function openChat() { if (window.SonikChannel && window.SonikChannel.open) window.SonikChannel.open(); }
  function loadThree() {
    if (window.THREE) return Promise.resolve();
    if (!st.loading) st.loading = new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'vendor/three-r128.min.js'; s.onload = ok; s.onerror = () => { st.loading = null; bad(new Error('three')); }; document.body.appendChild(s); });
    return st.loading;
  }
  async function setOpen(v) {
    ensureDom(); st.open = v; el.hidden = !v;
    if (!v) { ui.close(); return; }
    if (!st.world) {
      try { await loadThree(); st.world = make3D(); } catch (e) { console.warn('사무실 3D', e); }
      if (!st.world) { if (!el.querySelector('.ofc-nogl')) { const d = document.createElement('div'); d.className = 'ofc-nogl'; d.textContent = '이 환경에서는 3D 사무실을 그릴 수 없습니다.'; el.appendChild(d); } return; }
      st.world.build();
    }
    st.world.resize();
    if (window.SonikChannel && window.SonikChannel.rows) onRows(window.SonikChannel.rows());
  }

  // ── 3D ──
  function make3D() {
    const T = window.THREE; if (!T) return null;
    let renderer; try { renderer = new T.WebGLRenderer({ antialias: true }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    el.insertBefore(renderer.domElement, el.firstChild);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, -200, 400);
    let az = 0.34, zf = 1; const elv = 0.5, target = new T.Vector3(-0.9, 1.2, -0.2);
    function placeCam() {
      const w = el.clientWidth || 1, h = el.clientHeight || 1, asp = w / h, z = Math.max(16.6 / asp, 8.6) * zf;
      cam.left = -z * asp; cam.right = z * asp; cam.top = z; cam.bottom = -z; cam.updateProjectionMatrix();
      cam.position.set(target.x + 90 * Math.sin(az) * Math.cos(elv), target.y + 90 * Math.sin(elv), target.z + 90 * Math.cos(az) * Math.cos(elv)); cam.lookAt(target); renderer.setSize(w, h, false); st.dirty = 3;
    }
    let down = null, moved = 0; const ray = new T.Raycaster(), v2 = new T.Vector2(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('.ofc-top,.ofc-bot,.ofc-pop')) return; down = { x: e.clientX, az }; moved = 0; el.classList.add('drag'); });
    window.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - down.x; moved = Math.max(moved, Math.abs(dx)); az = Math.max(-0.5, Math.min(1.1, down.az - dx * 0.005)); placeCam(); });
    window.addEventListener('pointerup', (e) => {
      if (!down) return; el.classList.remove('drag'); down = null;
      if (moved >= 6 || !st.cur || !st.open) return;
      const r = renderer.domElement.getBoundingClientRect(); v2.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(v2, cam);
      const h = ray.intersectObjects(st.cur.picks)[0];
      if (h) ui.pick(h.object.userData.id);
      else { ui.close(); const pt = new T.Vector3(); if (ray.ray.intersectPlane(ground, pt)) st.cur.moveHong(pt.x, pt.z); }
    });
    $('ofcIn').onclick = () => { zf = Math.max(0.5, zf - 0.12); placeCam(); };
    $('ofcOut').onclick = () => { zf = Math.min(1.5, zf + 0.12); placeCam(); };
    window.addEventListener('resize', () => { if (st.open) placeCam(); });

    function build() {
      const scene = new T.Scene(); scene.background = new T.Color(P.bg);
      const M = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.9, metalness: 0 }, o || {}));
      function mesh(geo, m, x, y, z, p) { const k = new T.Mesh(geo, m); k.position.set(x, y, z); k.castShadow = true; k.receiveShadow = true; (p || scene).add(k); return k; }
      const B = (w, h, d, c, x, y, z, p) => mesh(new T.BoxGeometry(w, h, d), M(c), x, y, z, p);
      const S = (r, c, x, y, z, p) => mesh(new T.SphereGeometry(r, 20, 14), M(c, { roughness: 0.6 }), x, y, z, p);
      const C = (rt, rb, h, c, x, y, z, p, seg) => mesh(new T.CylinderGeometry(rt, rb, h, seg || 20), M(c), x, y, z, p);
      const invis = () => new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const picks = []; function pickBox(w, h, d, x, y, z, id, p) { const m = mesh(new T.BoxGeometry(w, h, d), invis(), x, y, z, p); m.castShadow = m.receiveShadow = false; m.userData.id = id; picks.push(m); return m; }
      scene.add(new T.HemisphereLight(0xffffff, 0xe8dcc8, 0.72));
      const sun = new T.DirectionalLight(0xfff6e8, 0.55); sun.position.set(10, 24, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 90; sun.shadow.bias = -0.0006; scene.add(sun);
      const crate = (s, c) => { const m = B(s, s * 0.8, s, c == null ? P.box : c, 0, 0, 0); const t = B(s * 1.02, s * 0.1, s * 0.3, 0xffffff, 0, s * 0.2, 0, m); t.material.opacity = 0.55; t.material.transparent = true; t.castShadow = false; return m; };
      // 방
      const f = mesh(new T.BoxGeometry(33, 0.3, 22), M(P.floor), -0.6, -0.15, -0.4); f.castShadow = false;
      B(33.3, 6, 0.3, P.wall, -0.6, 3, -11.5); B(0.3, 6, 22, P.wall, -17.2, 3, -0.4); B(33, 0.9, 0.08, 0xe7dcc8, -0.6, 0.45, -11.3);
      const win = mesh(new T.PlaneGeometry(20, 2.6), new T.MeshBasicMaterial({ color: 0xd3e2ea }), 0, 3.9, -11.33); win.castShadow = false;
      for (let i = 0; i <= 5; i++) B(0.14, 2.8, 0.1, 0xffffff, -10 + i * 4, 3.9, -11.3); B(20.3, 0.14, 0.1, 0xffffff, 0, 5.25, -11.3); B(20.3, 0.18, 0.3, 0xffffff, 0, 2.55, -11.25);
      [[-15.6, -9.8], [14.4, -9.8], [14.6, 9]].forEach((p) => { C(0.45, 0.34, 0.8, 0xffffff, p[0], 0.4, p[1]); const l = S(0.75, 0x8fae8b, p[0], 1.5, p[1]); l.scale.y = 1.35; });
      const rug = C(3.6, 3.6, 0.04, 0xefe6d6, HUB[0], 0.02, HUB[1] - 0.4, null, 40); rug.castShadow = false;
      B(0.14, 3.6, 2.2, 0xffffff, -17, 1.8, 0); B(0.1, 3.2, 1.8, 0xc9a878, -16.95, 1.6, 0);
      const signs = []; function sign(cls, txt, x, y, z) { const e = document.createElement('div'); e.className = 'ofc-sign ' + cls; e.textContent = txt; el.appendChild(e); const s = { el: e, x, y, z }; signs.push(s); return s; }
      function desk(x, z, w) {
        B(w, 0.1, 1.3, P.table, x, 1.01, z); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((p) => B(0.1, 0.96, 0.1, P.trim, x + p[0] * (w / 2 - 0.12), 0.48, z + p[1] * 0.55));
        B(0.95, 0.62, 0.07, P.trim, x - w / 2 + 0.75, 1.6, z - 0.35); B(0.1, 0.26, 0.1, P.trim, x - w / 2 + 0.75, 1.18, z - 0.35);
      }
      AG.forEach((a) => { if (a.id === 'head') return; const p = POS[a.id]; desk(p[0], p[1], 2.6); pickBox(3, 3.4, 3, p[0], 1.7, p[1] - 0.5, a.id); });
      desk(HUB[0], HUB[1], 3.4);
      C(1.9, 1.9, 0.1, P.table, MEET[0], 0.92, MEET[1], null, 48); C(1.94, 1.94, 0.05, P.trim, MEET[0], 0.85, MEET[1], null, 48); C(0.2, 0.34, 0.84, P.trim, MEET[0], 0.42, MEET[1]);
      B(4.2, 0.12, 1.5, 0xffffff, COUNTER[0], 1.02, COUNTER[1]); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((p) => B(0.12, 0.96, 0.12, P.trim, COUNTER[0] + p[0] * 1.9, 0.48, COUNTER[1] + p[1] * 0.6));
      B(4.2, 0.5, 0.1, ACC, COUNTER[0], 0.6, COUNTER[1] - 0.78); pickBox(5, 2.2, 2.4, COUNTER[0], 1.1, COUNTER[1], 'hongdesk');
      const ring = mesh(new T.TorusGeometry(3.3, 0.09, 8, 56), new T.MeshBasicMaterial({ color: ACC }), COUNTER[0], 0.08, COUNTER[1] + 0.3); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
      const sHong = sign('w', 'hong 창구 0', COUNTER[0], 0.1, COUNTER[1] + 3.6);
      B(3.6, 0.1, 1, P.table, SHELF[0], 0.8, SHELF[1]); B(3.6, 0.1, 1, P.table, SHELF[0], 1.9, SHELF[1]); B(0.12, 2.4, 1, P.dark, SHELF[0] - 1.8, 1.2, SHELF[1]); B(0.12, 2.4, 1, P.dark, SHELF[0] + 1.8, 1.2, SHELF[1]);

      const standOf = (id) => id === 'head' ? [HUB[0], HUB[1] - 1.2] : [POS[id][0], POS[id][1] - 1.15];
      function robot(a) {
        const RC = a.col || ROBOT, g = new T.Group(), u = { blinkT: 1 + Math.random() * 4, blink: 0, hop: 0, path: [], speed: 4.6, id: a.id, carry: false, tap: false, talk: false };
        u.legs = [-0.2, 0.2].map((x) => { const p = new T.Group(); p.position.set(x, 0.62, 0); g.add(p); C(0.11, 0.11, 0.5, JOINT, 0, -0.25, 0, p); const ft = S(0.17, RC, 0, -0.52, 0.06, p); ft.scale.set(1, 0.6, 1.4); return p; });
        const body = C(0.36, 0.46, 0.82, RC, 0, 1.03, 0, g); body.material.roughness = 0.6; S(0.46, RC, 0, 0.66, 0, g).scale.y = 0.5; C(0.2, 0.2, 0.14, JOINT, 0, 1.5, 0, g);
        const H = new T.Group(); H.position.set(0, 2.02, 0); g.add(H); u.H = H; const hd = S(0.6, RC, 0, 0, 0, H); hd.scale.set(1, 0.93, 0.96);
        u.eyes = [-0.21, 0.21].map((x) => { const e = S(0.085, a.col ? 0xffffff : EYE, x, 0.02, 0.54, H); e.castShadow = false; return e; });
        u.arms = [-0.5, 0.5].map((x) => { const p = new T.Group(); p.position.set(x, 1.32, 0); g.add(p); S(0.12, JOINT, 0, 0, 0, p); C(0.085, 0.085, 0.5, RC, 0, -0.3, 0, p); S(0.13, RC, 0, -0.6, 0, p); return p; });
        g.userData = u; scene.add(g); pickBox(1.5, 3, 1.5, 0, 1.5, 0, a.id, g);
        const l = document.createElement('div'); l.innerHTML = '<i></i>' + esc(a.name); el.appendChild(l); u.lab = l; u.base = 'ofc-lab' + (a.cls ? ' ' + a.cls : '') + (a.id !== 'hong' && !LIVE[a.id] ? ' off' : ''); l.className = u.base; return g;
      }
      const R = {}; AG.forEach((a) => { const r = robot(a); R[a.id] = r; const p = standOf(a.id); r.position.set(p[0], 0, p[1]); });
      const HST = [COUNTER[0] + 0.4, COUNTER[1] + 1.5]; R.hong = robot(byId.hong); R.hong.position.set(HST[0], 0, HST[1]); R.hong.rotation.y = -0.5;
      const ALL = AG.concat([byId.hong]);
      const X = { scene, picks, R, sel: null, busy: {}, boxes: [], speak: [] };
      const labCls = (id) => { const u = R[id].userData; u.lab.className = u.base + (X.busy[id] ? ' work' : '') + (X.sel === id ? ' sel' : ''); };
      function go(r, pts, face) { const u = r.userData; return new Promise((res) => { u.path = pts.map((p) => new T.Vector3(p[0], 0, p[1])); u.face = face; u.res = res; }); }
      // 말풍선: 한 사람에 하나
      function say(id, txt, ms) {
        let s = X.speak.find((x) => x.id === id);
        if (!s) { const e = document.createElement('div'); e.className = 'ofc-say'; el.appendChild(e); s = { id, el: e, tok: 0 }; X.speak.push(s); }
        s.el.innerHTML = '<b>' + esc(byId[id].name) + '</b>' + esc(txt); s.el.hidden = false; const tok = ++s.tok, u = R[id].userData; u.talk = true;
        return wait(ms).then(() => { if (s.tok === tok) { s.el.hidden = true; u.talk = false; } });
      }
      // hong 걷기: 책상·탁자를 피해 간다
      const GX0 = -16.5, GZ0 = -10.5, GS = 0.5, GW = 64, GH = 41;
      const RECTS = Object.values(POS).map((p) => [p[0] - 1.55, p[0] + 1.55, p[1] - 1.9, p[1] + 1.1]).concat([[HUB[0] - 2.15, HUB[0] + 2.15, HUB[1] - 1.9, HUB[1] + 1.1], [COUNTER[0] - 2.55, COUNTER[0] + 2.55, COUNTER[1] - 1.2, COUNTER[1] + 1.2], [SHELF[0] - 2.25, SHELF[0] + 2.25, SHELF[1] - 1, SHELF[1] + 1]]);
      const blocked = (x, z) => x < -16.3 || x > 15.2 || z < -10.3 || z > 9.8 || Math.hypot(x - MEET[0], z - MEET[1]) < 2.4 || RECTS.some((r) => x > r[0] && x < r[1] && z > r[2] && z < r[3]);
      const los = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / 0.25); for (let i = 1; i < n; i++) { const t = i / n; if (blocked(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; } return true; };
      function findPath(from, to) {
        if (los(from, to)) return [to];
        const ci = (x, z) => [Math.round((x - GX0) / GS), Math.round((z - GZ0) / GS)], key = (i, j) => j * GW + i, cx = (i) => GX0 + i * GS, cz = (j) => GZ0 + j * GS;
        const s0 = ci(from[0], from[1]), e = ci(to[0], to[1]), prev = new Map(), q = [s0]; prev.set(key(s0[0], s0[1]), null); let found = false;
        while (q.length) {
          const c = q.shift(); if (c[0] === e[0] && c[1] === e[1]) { found = true; break; }
          for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const i = c[0] + d[0], j = c[1] + d[1]; if (i < 0 || j < 0 || i >= GW || j >= GH) continue; const k = key(i, j); if (prev.has(k)) continue;
            if (blocked(cx(i), cz(j)) && !(i === e[0] && j === e[1])) continue;
            if (d[0] && d[1] && (blocked(cx(c[0] + d[0]), cz(c[1])) || blocked(cx(c[0]), cz(c[1] + d[1])))) continue;
            prev.set(k, c); q.push([i, j]);
          }
        }
        if (!found) return null;
        const cells = []; let c = e; while (c) { cells.unshift([cx(c[0]), cz(c[1])]); c = prev.get(key(c[0], c[1])); }
        cells[cells.length - 1] = to; const out = []; let a = from, i = 0;
        while (i < cells.length) { let j = cells.length - 1; while (j > i && !los(a, cells[j])) j--; out.push(cells[j]); a = cells[j]; i = j + 1; }
        return out;
      }
      let hTok = 0, hFace = null; const mark = mesh(new T.TorusGeometry(0.45, 0.07, 6, 32), new T.MeshBasicMaterial({ color: ACC }), 0, 0.06, 0); mark.rotation.x = Math.PI / 2; mark.castShadow = mark.receiveShadow = false; mark.visible = false;
      async function hongGo(x, z, face) {
        const r = R.hong, tok = ++hTok; if (hFace) { R[hFace].rotation.y = 0; hFace = null; }
        let t = [x, z];
        if (blocked(x, z)) { let best = null, bd = 1e9; for (let i = 0; i < GW; i++) for (let j = 0; j < GH; j++) { const px = GX0 + i * GS, pz = GZ0 + j * GS; if (blocked(px, pz)) continue; const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = [px, pz]; } } if (!best) return false; t = best; }
        const pts = findPath([r.position.x, r.position.z], t); if (!pts) return false;
        mark.position.set(t[0], 0.06, t[1]); mark.visible = true;
        await go(r, pts, face); if (tok !== hTok) return false; mark.visible = false; return true;
      }
      const nearP = (b) => b === 'head' ? { p: [5.4, 1.8], face: Math.PI } : POS[b][1] < 0 ? { p: [POS[b][0] + 0.9, -3.3], face: Math.PI } : { p: [POS[b][0] + 1.9, 3.85], face: -Math.PI / 2 };
      X.moveHong = (x, z) => { hongGo(x, z, null); };
      X.approach = async (b) => { const n = nearP(b); if (!await hongGo(n.p[0], n.p[1], n.face)) return; if (POS[b] && POS[b][1] > 0) { R[b].rotation.y = Math.PI / 2; hFace = b; } ui.open('chat', b); };
      X.say = say;
      X.select = (id) => { st.dirty = 3; const old = X.sel; X.sel = id; if (old && R[old]) labCls(old); if (id && R[id]) labCls(id); };
      // 창구 상자: hong 이 답해야 하는 글(최근 3건). 새로 생기면 총괄이 들고 온다
      const slotX = (k) => COUNTER[0] - 1.2 + k * 1.2;
      function mkBox(m) { const b = crate(0.78, ACC); scene.remove(b); pickBox(1, 1, 1, 0, 0, 0, 'hongdesk', b); const e = document.createElement('div'); e.className = 'ofc-sign p'; e.textContent = clip(m.topic || m.body, 14) || '확인할 일'; e.hidden = true; el.appendChild(e); return { id: m.id, box: b, el: e, placed: false }; }
      function setBox(o, k) { scene.add(o.box); o.box.position.set(slotX(k), 1.04 + 0.31 + 0.02, COUNTER[1]); o.box.rotation.set(0, 0, 0); o.el.hidden = false; o.placed = true; o.k = k; }
      function dropBox(o) { if (o.box.parent) o.box.parent.remove(o.box); const i = picks.indexOf(o.box.children.find((c) => c.userData && c.userData.id)); if (i >= 0) picks.splice(i, 1); o.el.remove(); }
      let headQ = Promise.resolve();
      function deliver(o) {
        headQ = headQ.then(async () => {
          if (!X.boxes.includes(o)) return; const r = R.head, u = r.userData;
          r.add(o.box); o.box.position.set(0, 1.0, 0.78); u.carry = true;
          await go(r, [[7.9, -1.2], [8.3, 3.4]], Math.PI / 2);
          u.carry = false; if (!X.boxes.includes(o)) { dropBox(o); } else { const used = X.boxes.filter((b) => b.placed).map((b) => b.k); let k = 0; while (used.includes(k)) k++; setBox(o, k); say('head', '확인 부탁드립니다.', 2400); }
          await wait(900); await go(r, [[7.9, -1.2], standOf('head')], 0);
        }).catch(() => {});
      }
      X.sync = (th, fresh) => {
        st.dirty = 3;
        // 일하는 담당
        const b = busyAgents(th); X.busy = b; AG.forEach((a) => { R[a.id].userData.tap = !!b[a.id]; labCls(a.id); });
        // 창구 상자
        const w = waitingRows(), want = w.slice(-3), ids = new Set(want.map((m) => m.id)), first = !X.synced; X.synced = true;
        X.boxes = X.boxes.filter((o) => { if (ids.has(o.id)) return true; dropBox(o); return false; });
        for (const m of want) { if (X.boxes.some((o) => o.id === m.id)) continue; const o = mkBox(m); X.boxes.push(o); if (first || !fresh.some((x) => x.id === m.id)) { const used = X.boxes.filter((x) => x.placed).map((x) => x.k); let k = 0; while (used.includes(k)) k++; setBox(o, k); } else deliver(o); }
        sHong.el.textContent = 'hong 창구 ' + w.length; X.nWait = w.length;
        // 새로 온 답 → 그 담당 말풍선
        for (const m of fresh) { if (m.sender === 'hong') continue; const a = th.of.get(m.id); if (a && R[a]) { R[a].userData.hop = 0.5; say(a, clip(m.body, 90), 5200); } }
      };
      const pv = new T.Vector3(), wp = new T.Vector3();
      function place(e, x, y, z) { pv.set(x, y, z).project(cam); const w = el.clientWidth, h = el.clientHeight; e.style.left = ((pv.x + 1) / 2 * w) + 'px'; e.style.top = ((1 - pv.y) / 2 * h) + 'px'; }
      let t = 0;
      X.tick = (dt) => {
        t += dt; let act = false;
        ALL.forEach((a) => {
          const r = R[a.id], u = r.userData, mv = u.path.length > 0;
          if (mv || u.talk || u.tap || u.hop > 0) act = true;
          if (mv) {
            const p = u.path[0]; let dx = p.x - r.position.x, dz = p.z - r.position.z; const d = Math.hypot(dx, dz), stp = u.speed * dt;
            if (d <= stp) { r.position.x = p.x; r.position.z = p.z; u.path.shift(); if (!u.path.length) { r.position.y = 0; if (u.face != null) r.rotation.y = u.face; const fn = u.res; u.res = null; if (fn) fn(); } }
            else {
              dx /= d; dz /= d; r.position.x += dx * stp; r.position.z += dz * stp; let dr = Math.atan2(dx, dz) - r.rotation.y; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI; r.rotation.y += dr * Math.min(1, dt * 12);
              const ph = t * u.speed * 2.6; u.legs[0].rotation.x = Math.sin(ph) * 0.7; u.legs[1].rotation.x = -Math.sin(ph) * 0.7; r.position.y = Math.abs(Math.sin(ph)) * 0.1;
              if (!u.carry) { u.arms[0].rotation.x = -Math.sin(ph) * 0.6; u.arms[1].rotation.x = Math.sin(ph) * 0.6; }
            }
          } else u.legs.forEach((l) => { l.rotation.x = 0; });
          if (u.carry) u.arms.forEach((m) => { m.rotation.x = -1.35; });
          else if (!mv) u.arms.forEach((m, k) => { m.rotation.x = u.talk ? -1.1 + 0.5 * Math.sin(t * 9 + k * 2.4) : u.tap ? -0.95 + 0.2 * Math.sin(t * 16 + k * 1.7) : 0; });
          u.blinkT -= dt; if (u.blinkT < 0) { u.blink = 0.13; u.blinkT = 2 + Math.random() * 4; } u.blink -= dt; u.eyes.forEach((e) => { e.scale.y = u.blink > 0 ? 0.12 : 1; });
          u.H.rotation.x = u.tap && !mv ? 0.16 + 0.04 * Math.sin(t * 6) : 0;
          if (u.hop > 0) { u.hop -= dt; u.H.position.y = 2.02 + Math.abs(Math.sin(u.hop * 10)) * 0.28; } else u.H.position.y = 2.02;
        });
        // 가만히 있을 때는 다시 그리지 않는다(hong 11-22). 움직임이 끝난 뒤 몇 장만 더 그려 마지막 자세를 맞춘다
        if (act) st.dirty = Math.max(st.dirty, 3);
        if (!act && st.dirty <= 0) return false;
        ALL.forEach((a) => { const r = R[a.id]; place(r.userData.lab, r.position.x, r.position.y + 3.05, r.position.z); });
        signs.forEach((s) => place(s.el, s.x, s.y, s.z));
        X.boxes.forEach((o) => { if (!o.placed) return; o.box.getWorldPosition(wp); place(o.el, wp.x, wp.y + 0.85, wp.z); });
        X.speak.forEach((s) => { if (s.el.hidden) return; const r = R[s.id]; place(s.el, r.position.x, r.position.y + 3.75, r.position.z); });
        ring.visible = (X.nWait || 0) > 0; ring.scale.setScalar(act ? 1 + 0.05 * Math.sin(t * 3) : 1);
        return true;
      };
      st.cur = X;
    }
    const clk = new T.Clock();
    (function frame() { const dt = Math.min(clk.getDelta(), 0.05); if (st.cur && st.open && st.cur.tick(dt)) { renderer.render(st.cur.scene, cam); st.frames = (st.frames || 0) + 1; if (st.dirty > 0) st.dirty--; } requestAnimationFrame(frame); })();
    return { build, resize: placeCam };
  }

  // ── 팝업: 대화창 · 명함 · 오간 일 ──
  const head = (title, sub) => '<div class="grow"><b>' + esc(title) + '</b><div class="sub">' + esc(sub) + '</div></div><button type="button" id="ofcPx" aria-label="닫기">×</button>';
  const nameOf = (who, m, th) => { const a = th.of.get(m.id); if (a && who !== 'hong') return byId[a].name; if (who === 'hong' || who === '모두') return who; return who === 'Codex' ? 'Codex 검증' : who === 'Claude' ? '총괄' : who; };
  const ui = {
    close() { st.pop = null; if ($('ofcPop')) $('ofcPop').hidden = true; if (st.cur) st.cur.select(null); },
    pick(id) { if (id === 'hongdesk' || id === 'hong') { openChat(); return; } ui.close(); st.cur.approach(id); },
    open(kind, id) { st.pop = { kind, id }; $('ofcPb').innerHTML = ''; $('ofcPf').innerHTML = ''; $('ofcPb').dataset.key = ''; if (st.cur) st.cur.select(kind === 'log' ? null : id); ui.render(threads()); },
    render(th) {
      const s = st.pop, pop = $('ofcPop'); if (!s) { if (pop) pop.hidden = true; return; } if (pop.hidden) { pop.hidden = false; placePop(pbox.get()); }
      const ph = $('ofcPh'), pb = $('ofcPb'), pf = $('ofcPf');
      if (s.kind === 'chat') {
        const a = byId[s.id], list = th.out[s.id] || [], live = !!LIVE[s.id], last = list[list.length - 1];
        const pend = last && last.sender === 'hong' && last.status === '대기';
        const key = 'chat:' + s.id + ':' + list.map((m) => m.id + (m.run_state || '') + m.status).join(',');
        if (pb.dataset.key !== key) {
          pb.dataset.key = key;
          pb.innerHTML = '<div class="ofc-chat" id="ofcChat">' + (list.length ? list.map((m) => '<div class="ofc-msg' + (m.sender === 'hong' ? ' me' : '') + '">' + esc(String(m.body || '').replace(/<<<[\s\S]*?>>>/g, '').trim()).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>') + '</div>').join('')
            : '<p class="ofc-note">' + (live ? esc(a.name) + ' 옆에 왔습니다. 아래 칸에 적어 말을 걸어 보세요. 챗봇의 ⚡ 빠른 질문으로 올라가고, PC 중계가 켜져 있으면 답이 옵니다.' : '이 담당은 아직 실제 답에 연결하지 않았습니다.') + '</p>')
            + (pend ? '<div class="ofc-msg wait">' + (last.run_state === '실행중' ? '답을 쓰는 중…' : '답을 기다리는 중…') + '</div>' : '') + '</div>';
          pb.scrollTop = pb.scrollHeight;
        }
        if (!$('ofcTalk') || pf.dataset.id !== s.id) {
          ph.innerHTML = head(a.name + ' 와 대화', a.role);
          pf.dataset.id = s.id;
          pf.innerHTML = '<form class="ofc-talk" id="ofcTalk"><input id="ofcIn2" type="text" autocomplete="off" aria-label="말 걸기" placeholder="' + (live ? '예: 11월 재무손익이 얼마야?' : '아직 연결 전') + '"' + (live ? '' : ' disabled') + '><button class="ofc-btn" type="submit"' + (live ? '' : ' disabled') + '>보내기</button></form>'
            + '<button class="ofc-btn ghost" type="button" id="ofcCard">명함 보기</button><p class="ofc-note" id="ofcErr" style="padding:0 14px 12px" hidden></p>';
          $('ofcTalk').onsubmit = (e) => { e.preventDefault(); const i = $('ofcIn2'), v = i.value.trim(); if (!v) return; i.value = ''; sendTo(s.id, v); };
          $('ofcCard').onclick = () => ui.open('card', s.id);
        }
      } else if (s.kind === 'card') {
        const a = byId[s.id];
        ph.innerHTML = head(a.name + ' 명함', a.role);
        pb.innerHTML = '<dl><dt>하는 일</dt><dd>' + esc(a.role) + '</dd><dt>잇는 메뉴</dt><dd>' + esc(a.menu) + '</dd><dt>맡는 쪽</dt><dd>' + esc(a.by || 'Claude') + '</dd><dt>연결</dt><dd>' + (LIVE[s.id] ? '대화가 실제 답으로 이어짐' : '아직 자리만 있음') + '</dd></dl>';
        pf.dataset.id = ''; pf.innerHTML = '<button class="ofc-btn ghost" type="button" id="ofcBack" style="margin-top:0">대화로 돌아가기</button>';
        $('ofcBack').onclick = () => ui.open('chat', s.id);
      } else {
        ph.innerHTML = head('오간 일', '챗봇에 올라온 최근 글');
        const L = st.rows.slice(-12).reverse();
        pb.innerHTML = L.length ? L.map((m) => '<button type="button" class="ofc-rep" data-row="' + m.id + '"><b>' + esc(nameOf(m.sender, m, th)) + ' → ' + esc(nameOf(m.recipient, m, th))
          + (m.status === '대기' && m.sender !== 'hong' && (m.recipient === 'hong' || m.recipient === '모두') ? ' <span class="ofc-pill">hong 확인</span>' : '') + '</b><span>' + esc(clip((m.topic ? m.topic + ' · ' : '') + m.body, 80)) + '</span></button>').join('')
          : '<p class="ofc-note">아직 올라온 글이 없습니다.</p>';
        pf.dataset.id = ''; pf.innerHTML = '';
        pb.querySelectorAll('[data-row]').forEach((b) => { b.onclick = openChat; });
      }
      $('ofcPx').onclick = ui.close;
    },
  };
  function refreshUi(th) {
    if (!el) return;
    $('ofcCnt').textContent = waitingRows().length;
    $('ofcLog').textContent = '오간 일 ' + Math.min(12, st.rows.length);
    if (st.pop) ui.render(th);
  }
  // 담당에게 말 걸기 → 챗봇 ⚡ 빠른 질문 글(주제 「사무실 · 담당」). 앞선 대화가 있으면 그 글에 이어 쓴다
  async function sendTo(id, body) {
    const a = byId[id], err = $('ofcErr'); if (err) err.hidden = true;
    if (!LIVE[id] || !st.sb) return;
    if (st.cur) st.cur.say('hong', clip(body, 90), 2600);
    try {
      const { data: s } = await st.sb.auth.getSession();
      const list = threads().out[id] || [], last = list[list.length - 1];
      const row = { sender: 'hong', recipient: a.by || 'Claude', topic: TOPIC + a.name, status: '대기', reply_to: last ? last.id : null, body, files: [], quick: true, author_email: ((s && s.session && s.session.user.email) || '').toLowerCase() };
      const { error } = await st.sb.from('sk_channel').insert(row);
      if (error) throw new Error(error.message);
      if (window.SonikChannel && window.SonikChannel.reload) await window.SonikChannel.reload();
    } catch (e) { if (err) { err.textContent = '보내지 못했습니다: ' + e.message; err.hidden = false; } }
  }

  window.SonikOffice = {
    // app.js 가 목록 화면을 그릴 때 부른다. 관리자(hong)가 아니면 단추를 만들지 않는다
    mount(sb, me) {
      st.sb = sb; st.me = me;
      const ok = !!(me && me.role === 'admin');
      let b = $('btnOffice');
      if (!ok) { if (b) b.hidden = true; if (el && st.open) setOpen(false); return; }
      if (!b) {
        b = document.createElement('button'); b.id = 'btnOffice'; b.className = 'more'; b.title = '담당 에이전트 사무실 (hong 전용 · 시험 중)'; b.textContent = '🏢 사무실';
        const bar = $('bar'), who = $('who'); if (bar) bar.insertBefore(b, who || null);
        b.onclick = () => setOpen(!st.open);
      }
      b.hidden = false;
      if (window.SonikChannel && window.SonikChannel.watch) window.SonikChannel.watch(onRows);
    },
    close() { if (st.open) setOpen(false); },
    stats() { return { frames: st.frames, dirty: st.dirty }; },
  };
})();
