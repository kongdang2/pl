// 소통 채널 — hong · Codex · Claude 가 주고받는 글(sk_channel)을 채팅 형태로 보여준다. 관리자(hong)와 에이전트 계정은 모든 글을 읽고 쓴다.
// 담당자(작성자·조회자, hong 11/03): 자기 대화(owner = 내 이메일)만 보고, ⚡ 읽기 전용 질의응답으로만 묻는다(첨부·중계 조작 없음). DB 정책(migration 014)이 막고, 화면은 그에 맞춰 숨긴다.
// 상태: 대기(받는이가 답해야 함) → 답변 → 완료, 알림만이면 안내. hong 이 「모두」로 보내면 Claude → Codex 순서로 둘 다 답한다(셋이 대화). 글 내용은 고치지 않고 상태만 바꾼다.
// 화면 오른쪽 아래 💬 버튼으로 여닫는 팝업이라 목록·시스템 화면 어디서나 쓴다. 닫혀 있으면 새 글 수를 버튼에 표시한다.
// PC 중계(소통\중계.cjs)가 Codex·Claude 앞 「대기」 글을 실행하고 답을 올린다(sk_relay: 신호·멈춤).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = (s) => new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const day = (s) => new Date(s).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  let ME = 'hong';
  const MINE = (m) => m.sender !== ME && (m.recipient === ME || m.recipient === '모두');
  // 담당자 글·담당자에게 온 답은 그 사람 이메일 앞부분으로 보여 준다(관리자 화면)
  const NAME = (who, m) => who === '담당' ? '담당 ' + String((m && m.owner) || '').split('@')[0] : who;
  const RUN = { 실행중: '⏳ 작업 중', 완료: '✓ 자동 처리', 실패: '✗ 자동 실패', 건너뜀: '⏸ 왕복 한도' };
  // 화면 글자(ctx.screen)는 크므로 목록에서는 자료 이름·위치만 읽는다(내려받기 용량)
  const COLS = 'id,at,sender,recipient,topic,status,reply_to,body,author_email,updated_at,run_state,run_note,files,request_id,quick,live,owner,ctx_memo:ctx->>snap_memo,ctx_loc:ctx->>loc,ctx_snap:ctx->>snap_id,ctx_base:ctx->>base_ym,ctx_ver:ctx->>engine_ver';
  const ch = { fullAt: 0, live: null, ctxFn: null, sb: null, rows: [], replyTo: null, timer: null, onlyMine: false, to: 'Claude', relay: null, lastTop: 0, open: false, tick: 0, pending: [], urls: {}, quick: false, stopAsked: 0, liveOpen: {}, filed: {}, onDraft: null, moreOpen: {}, foldOpen: {}, sysOpen: {}, pick: {}, reqs: {}, reqAt: 0, maxUpd: '' };
  const BUCKET = 'sonik-channel', MAXB = 20 * 1024 * 1024; // 첨부: 비공개 버킷, 파일당 20MB
  // 마지막으로 본 글 번호(이 브라우저에만 저장). 저장이 막혀 있으면 배지만 덜 정확하다
  const seen = { get() { try { return +localStorage.getItem('sonik.ch.seen') || 0; } catch (_) { return 0; } }, set(v) { try { localStorage.setItem('sonik.ch.seen', String(v)); } catch (_) { /* 무시 */ } } };

  // 전송량(hong 11-06, Supabase 무료 한도 초과): 최근 150글(약 0.5MB)을 통째로 다시 읽는 일은 처음 열 때와 몇 분에 한 번(예비)만 한다.
  // 그 사이 새 글·바뀐 글은 Realtime 알림에 실려 온 행을 그대로 합친다(apply). Realtime 이 끊겨 있으면 예전처럼 주기적으로 다시 읽는다.
  const sig = (r) => r.map((m) => m.id + m.status + (m.run_state || '') + (m.run_note || '') + ':' + (m.live || []).length).join();
  // full = 최근 150글 통째로. 아니면 마지막으로 읽은 뒤 바뀐 글만 받아 합친다(hong 11-11 전송량: 팝업을 열거나 예비로 다시 읽을 때마다 0.5MB 를 받지 않게).
  // 바뀐 글만 읽기는 Realtime 이 이어져 있을 때만 쓴다(끊겨 있으면 놓친 변경이 있을 수 있어 통째로). 지워진 글은 1시간마다 통째로 읽을 때 빠진다.
  const stampOf = (rows) => rows.reduce((a, m) => (m.updated_at && Date.parse(m.updated_at) > (Date.parse(a) || 0) ? m.updated_at : a), '');
  async function load(full) {
    const part = !full && ch.live && ch.rows.length && ch.maxUpd && Date.now() - (ch.fullAt || 0) < 3600000;
    let q = ch.sb.from('sk_channel').select(COLS);
    q = part ? q.gt('updated_at', ch.maxUpd).order('at', { ascending: false }).limit(150) : q.order('at', { ascending: false }).limit(150);
    const { data, error } = await q;
    if (error) { if (!part) $('chRows').innerHTML = '<p class="hint">채널을 읽지 못했습니다: ' + esc(error.message) + '</p>'; return; }
    let rows = (data || []).reverse();
    if (part) {
      ch.partAt = Date.now();
      if (!rows.length) return;
      const by = new Map(ch.rows.map((m) => [m.id, m]));
      rows.forEach((m) => by.set(m.id, m));
      rows = [...by.values()].sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id - b.id)).slice(-150);
    } else { ch.fullAt = ch.partAt = Date.now(); }
    await after(rows);
  }
  // Realtime 행(전체 열) → 목록 열 모양. 바뀌지 않은 큰 열은 알림에서 빠질 수 있어(TOAST) 들어온 값만 덮는다
  function apply(p) {
    const rows = ch.rows.slice();
    if (p.eventType === 'DELETE') {
      const id = p.old && p.old.id; if (id == null) return;
      return after(rows.filter((m) => m.id !== id));
    }
    const n = p.new || {}; if (n.id == null) return;
    const v = {};
    COLS.split(',').forEach((c) => { const k = c.split(':')[0]; if (k in n && n[k] !== undefined) v[k] = n[k]; });
    ['at', 'updated_at'].forEach((k) => { if (typeof v[k] === 'string') v[k] = v[k].replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'); }); // 시각 표기를 목록과 같게
    if (n.ctx && typeof n.ctx === 'object') { const x = n.ctx; v.ctx_memo = x.snap_memo ?? null; v.ctx_loc = x.loc ?? null; v.ctx_snap = x.snap_id ?? null; v.ctx_base = x.base_ym ?? null; v.ctx_ver = x.engine_ver ?? null; }
    const i = rows.findIndex((m) => m.id === n.id);
    if (i >= 0) rows[i] = Object.assign({}, rows[i], v);
    else { rows.push(v); rows.sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id - b.id)); }
    return after(rows.slice(-150));
  }
  async function after(rows) {
    const before = ch.rows.length && ch.rows[ch.rows.length - 1].id;
    const changed = sig(ch.rows) !== sig(rows);
    ch.rows = rows;
    ch.maxUpd = stampOf(rows) || ch.maxUpd;
    loadReqs();
    if (await loadFiled()) render(false);
    if (changed) render(before !== (ch.rows.length && ch.rows[ch.rows.length - 1].id));
    if (ch.open) sign();
    badge();
    if (ch.open) loadRelay();
  }
  // 챗봇 답의 수정요청 초안(hong 11/04): 답 본문 안 <<<요청초안 … 요청초안>>> 블록 → 카드 + 「수정요청으로 올리기」
  const DRAFT_RE = /<<<요청초안[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*요청초안>>>/;
  const KINDS = ['계산', '표시·서식', '기능 추가', '기타'];
  function parseDraft(body) {
    const x = String(body || '').match(DRAFT_RE);
    if (!x) return null;
    const t = x[1], get = (k) => { const y = t.match(new RegExp('^[ \\t]*' + k + '[ \\t]*:[ \\t]*(.*)$', 'm')); return y ? y[1].trim() : ''; };
    const at = t.search(/^[ \t]*내용[ \t]*:/m);
    let kind = get('구분'); if (!KINDS.includes(kind)) kind = '기타';
    return { title: get('제목').slice(0, 80), kind, body: at < 0 ? '' : t.slice(at).replace(/^[ \t]*내용[ \t]*:[ \t]*/, '').trim(), rest: String(body).replace(DRAFT_RE, '').trim() };
  }
  // 이미 올린 초안: sk_requests.chat_id 로 찾는다(담당자는 자기 요청만 보인다). 새로 알게 된 것이 있으면 true
  async function loadFiled() {
    const ids = ch.rows.filter((m) => !(m.id in ch.filed) && DRAFT_RE.test(m.body || '')).map((m) => m.id);
    if (!ids.length) return false;
    const { data, error } = await ch.sb.from('sk_requests').select('id,chat_id').in('chat_id', ids);
    if (error) return false;
    ids.forEach((id) => { ch.filed[id] = 0; });
    (data || []).forEach((r) => { ch.filed[r.chat_id] = r.id; });
    return (data || []).length > 0;
  }
  function draftCard(m, d) {
    const done = ch.filed[m.id];
    return '<div class="rqd"><div class="rqd-h">📝 수정요청 초안</div><div class="rqd-t"><b>' + esc(d.title || '(제목 없음)') + '</b> <span class="hint">· ' + esc(d.kind) + '</span></div>'
      + (d.body ? '<div class="rqd-b">' + esc(d.body) + '</div>' : '')
      + (done ? '<div class="rqd-ok">✔ 수정요청 #' + done + '(으)로 올렸습니다</div>'
        : ch.onDraft ? '<button class="pri rqd-go" data-rqd="' + m.id + '">수정요청으로 올리기…</button>' : '<div class="hint">추정자료 목록 화면에서 올릴 수 있습니다.</div>')
      + '</div>';
  }
  async function fileDraft(id) {
    const m = ch.rows.find((x) => x.id === id), d = m && parseDraft(m.body);
    if (!d || !ch.onDraft) return;
    const q = m.reply_to ? ch.rows.find((x) => x.id === m.reply_to) : null;
    const reqId = await ch.onDraft({ chat_id: m.id, title: d.title, kind: d.kind, body: d.body,
      question: q ? { id: q.id, body: q.body, snap_id: q.ctx_snap || null, base_ym: q.ctx_base || null, engine_ver: q.ctx_ver || null, memo: q.ctx_memo || '', loc: q.ctx_loc || '' } : null });
    if (reqId) { ch.filed[m.id] = reqId; render(false); }
  }
  // 닫혀 있을 때: 내가 마지막으로 본 뒤 Codex·Claude 가 올린 글 수
  function badge() {
    const last = ch.rows.length ? ch.rows[ch.rows.length - 1].id : 0;
    if (ch.open) { seen.set(last); $('chBadge').hidden = true; return; }
    const n = ch.rows.filter((m) => m.sender !== ME && m.id > seen.get()).length;
    $('chBadge').hidden = !n; $('chBadge').textContent = n > 99 ? '99+' : String(n);
  }
  // 팝업 크기·위치: 가장자리 4곳과 모서리 4곳을 끌어 크기를, 머리줄을 끌어 위치를 바꾼다. 내 브라우저에 기억(sonik.ch.box), 손잡이 두 번 누르면 처음 크기로
  const box = {
    get() { try { return JSON.parse(localStorage.getItem('sonik.ch.box') || 'null'); } catch (_) { return null; } },
    set(v) { try { if (v) localStorage.setItem('sonik.ch.box', JSON.stringify(v)); else localStorage.removeItem('sonik.ch.box'); } catch (_) { /* 무시 */ } },
  };
  const MIN_W = 340, MIN_H = 320, wide = () => window.innerWidth > 600;
  // 휴대폰(좁은 화면)은 폭은 화면 가득, 높이만 위쪽 손잡이로 조절(sonik.ch.mh)
  const mh = { get() { try { return +localStorage.getItem('sonik.ch.mh') || 0; } catch (_) { return 0; } }, set(v) { try { if (v) localStorage.setItem('sonik.ch.mh', String(v)); else localStorage.removeItem('sonik.ch.mh'); } catch (_) { /* 무시 */ } } };
  function place(b) {
    const st = $('chCard').style;
    if (!wide()) { st.left = st.top = st.width = st.right = st.bottom = ''; const h = mh.get(); st.height = h ? Math.min(Math.max(h, 220), window.innerHeight - 90) + 'px' : ''; return; }
    if (!b) { st.left = st.top = st.width = st.height = st.right = st.bottom = ''; return; }
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(Math.max(b.w, MIN_W), vw - 16), h = Math.min(Math.max(b.h, MIN_H), vh - 16);
    const l = Math.min(Math.max(b.l, 8), vw - w - 8), t = Math.min(Math.max(b.t, 8), vh - h - 8);
    Object.assign(st, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px', right: 'auto', bottom: 'auto' });
  }
  function resizable() {
    const card = $('chCard');
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const g = document.createElement('div');
      g.className = 'ch-rz ch-rz-' + d;
      g.ondblclick = () => { box.set(null); mh.set(0); place(null); };
      g.onpointerdown = (e) => {
        if (e.button !== 0) return;
        if (!wide()) { // 휴대폰: 위쪽 손잡이로 높이만(손가락은 touchGrip 이 맡는다)
          if (d !== 'n' || e.pointerType === 'touch') return;
          e.preventDefault(); g.setPointerCapture(e.pointerId);
          const bottom = card.getBoundingClientRect().bottom;
          const mv = (ev) => { const h = Math.min(Math.max(bottom - ev.clientY, 220), window.innerHeight - 90); card.style.height = h + 'px'; };
          const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); mh.set(Math.round(card.getBoundingClientRect().height)); };
          g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
          return;
        }
        e.preventDefault(); g.setPointerCapture(e.pointerId);
        const r = card.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
        document.body.classList.add('ch-resizing'); document.body.style.cursor = getComputedStyle(g).cursor;
        const mv = (ev) => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0, b = { l: r.left, t: r.top, w: r.width, h: r.height };
          // 끄는 쪽 가장자리만 움직이고 반대쪽은 그대로 둔다(화면 밖으로는 늘리지 않음)
          if (d.includes('e')) b.w = Math.min(r.width + dx, window.innerWidth - 8 - r.left);
          if (d.includes('s')) b.h = Math.min(r.height + dy, window.innerHeight - 8 - r.top);
          if (d.includes('w')) { b.w = Math.min(Math.max(r.width - dx, MIN_W), r.right - 8); b.l = r.right - b.w; }
          if (d.includes('n')) { b.h = Math.min(Math.max(r.height - dy, MIN_H), r.bottom - 8); b.t = r.bottom - b.h; }
          place(b);
        };
        const up = () => {
          g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
          document.body.classList.remove('ch-resizing'); document.body.style.cursor = '';
          const q = card.getBoundingClientRect();
          box.set({ l: Math.round(q.left), t: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) });
        };
        g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
      };
      card.appendChild(g);
    }
    window.addEventListener('resize', () => { if (ch.open) place(box.get()); });
    // 머리줄을 잡고 끌면 창 전체를 옮긴다(버튼·입력칸 위에서는 끌지 않음). 위치는 크기와 함께 기억
    const head = card.querySelector('.chat-head');
    head.classList.add('ch-drag');
    head.ondblclick = (e) => { if (!e.target.closest('button,select,input,textarea,a,label')) { box.set(null); place(null); } };
    // 휴대폰: 머리줄을 위아래로 끌면 높이가 바뀐다(위쪽 얇은 손잡이만으로는 손가락이 잘 안 잡혀서, hong 11/03)
    const phoneDrag = (e, el) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const bottom = card.getBoundingClientRect().bottom;
      const mv = (ev) => { card.style.height = Math.min(Math.max(bottom - ev.clientY, 220), window.innerHeight - 90) + 'px'; };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); mh.set(Math.round(card.getBoundingClientRect().height)); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    // 휴대폰 예비 경로: 일부 휴대폰 브라우저는 손가락 끌기를 화면 스크롤로 가로채 pointer 이벤트를 끊는다(pointercancel).
    // touch 이벤트로 직접 받아 스크롤을 막고 높이를 바꾼다(hong 11/03 「휴대폰은 챗창이 안 잡힘」)
    const touchGrip = (el) => {
      let y0 = null, bottom = 0;
      el.addEventListener('touchstart', (e) => {
        if (wide() || e.touches.length !== 1 || e.target.closest('button,select,input,textarea,a,label')) { y0 = null; return; }
        y0 = e.touches[0].clientY; bottom = card.getBoundingClientRect().bottom;
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (y0 == null) return;
        e.preventDefault();
        card.style.height = Math.min(Math.max(bottom - e.touches[0].clientY, 220), window.innerHeight - 90) + 'px';
      }, { passive: false });
      const end = () => { if (y0 == null) return; y0 = null; mh.set(Math.round(card.getBoundingClientRect().height)); };
      el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    };
    touchGrip(head); touchGrip(card.querySelector('.ch-rz-n'));
    head.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest('button,select,input,textarea,a,label')) return;
      if (e.pointerType === 'touch' && !wide()) return; // 휴대폰 손가락은 위 touch 경로가 맡는다
      if (!wide()) return phoneDrag(e, head);
      e.preventDefault(); head.setPointerCapture(e.pointerId);
      const r = card.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      document.body.classList.add('ch-resizing'); document.body.style.cursor = 'move';
      const mv = (ev) => place({ l: r.left + ev.clientX - x0, t: r.top + ev.clientY - y0, w: r.width, h: r.height });
      const up = () => {
        head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
        document.body.classList.remove('ch-resizing'); document.body.style.cursor = '';
        const q = card.getBoundingClientRect();
        box.set({ l: Math.round(q.left), t: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) });
      };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    };
  }
  // ⤢ 크기 단추(hong 11/03): 터치 화면에서 끌기가 어려우면 한 번 눌러 크게, 다시 누르면 원래대로
  function toggleSize() {
    const card = $('chCard');
    if (!wide()) {
      const big = mh.get() >= window.innerHeight - 100;
      mh.set(big ? 0 : window.innerHeight - 90); place(null);
    } else {
      const r = card.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      const big = r.width >= vw * 0.85 && r.height >= vh * 0.85;
      if (big) { const prev = box.get(); box.set(prev && prev.prev ? prev.prev : null); place(box.get()); }
      else { const now = box.get(); const b = { l: 8, t: 8, w: vw - 16, h: vh - 16, prev: now && !now.prev ? now : null }; box.set(b); place(b); }
    }
    sizeLabel();
  }
  function sizeLabel() {
    const card = $('chCard'), r = card.getBoundingClientRect();
    const big = wide() ? r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85 : r.height >= window.innerHeight - 100;
    $('chSize').textContent = big ? '⤡' : '⤢'; $('chSize').title = big ? '원래 크기로' : '크게 보기';
  }
  // 자료를 열어 둔 상태면 「📄 지금 화면 기준」 체크를 보인다(기본 켬)
  function refreshCtx() {
    let c = null;
    try { c = ch.ctxFn ? ch.ctxFn(false) : null; } catch (_) { c = null; }
    $('chCtxBox').hidden = !c;
    if (c) $('chCtxTxt').textContent = (c.snap_memo || '열린 자료') + (c.loc ? ' · ' + c.loc : '') + ' 기준';
  }
  function setOpen(v) {
    ch.open = v;
    if (v) { place(box.get()); setTimeout(sizeLabel, 0); }
    $('chCard').hidden = !v;
    $('chFab').classList.toggle('open', v);
    if (v) refreshCtx();
    badge(); // 열면 지금 목록 끝까지 본 것으로 기록(바뀐 글이 없어 load 가 일찍 끝나도 — hong 11-13 숫자 안 없어짐), 닫으면 숫자 다시 계산
    if (v) { ch.lastTop = 0; load().then(() => { render(true); $('chBody').focus(); }); }
  }

  // PC 중계 상태: 마지막 신호가 90초 안이면 작동 중
  async function loadRelay() {
    const { data: r } = await ch.sb.from('sk_relay').select('*').eq('id', 1).maybeSingle();
    ch.relay = r;
    if (!r) { $('chRelay').textContent = ''; return; }
    const alive = r.heartbeat && Date.now() - new Date(r.heartbeat).getTime() < 90000;
    $('chRelay').className = 'ch-relay ' + (r.paused ? 'warn' : alive ? 'ok' : 'off');
    $('chRelay').textContent = r.paused ? 'PC 중계 멈춤' : alive ? 'PC 중계 작동 중' : 'PC 중계 꺼짐';
    $('chRelay').title = r.heartbeat ? '마지막 신호 ' + new Date(r.heartbeat).toLocaleString('ko-KR') : '';
    $('chPause').textContent = r.paused ? '▶ 재개' : '⏸ 멈춤';
    // ⚙ 모델: 입력 중이 아니면 저장된 값으로 맞춘다
    [['chClaudeModel', 'claude_model'], ['chCodexModel', 'codex_model'], ['chCodexEffort', 'codex_effort']].forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = r[k] || ''; });
  }
  async function saveModels() {
    const v = { claude_model: $('chClaudeModel').value, codex_model: $('chCodexModel').value.trim(), codex_effort: $('chCodexEffort').value, updated_at: new Date().toISOString() };
    const { error } = await ch.sb.from('sk_relay').update(v).eq('id', 1);
    alertMsg(error ? '모델 설정을 저장하지 못했습니다: ' + error.message : '');
    if (!error) loadRelay();
  }
  // ■ 중지: 실행 중인 글 번호를 적으면 PC 중계가 5초 안에 그 실행을 끊는다
  async function askStop(id) {
    const { error } = await ch.sb.from('sk_relay').update({ stop_id: id, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) { alertMsg('중지 요청을 보내지 못했습니다: ' + error.message); return; }
    ch.stopAsked = id; render(false);
  }
  async function togglePause() {
    if (!ch.relay) return;
    const { error } = await ch.sb.from('sk_relay').update({ paused: !ch.relay.paused, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) { alertMsg('바꾸지 못했습니다: ' + error.message); return; }
    loadRelay();
  }

  // 말풍선 서식: 글자는 먼저 이스케이프하고, 앱처럼 문단·목록·굵게·코드·제목·「라벨:」만 살린다
  function inline(t) {
    return t.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function md(src) {
    const lines = esc(src).replace(/\r/g, '').split('\n');
    let html = '', list = null, para = [], code = null;
    const endPara = () => { if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
    const endList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const raw of lines) {
      if (code !== null) { if (/^\s*```/.test(raw)) { html += '<pre>' + code.join('\n') + '</pre>'; code = null; } else code.push(raw); continue; }
      if (/^\s*```/.test(raw)) { endPara(); endList(); code = []; continue; }
      const line = raw.trimEnd();
      let x;
      if (!line.trim()) { endPara(); endList(); continue; }
      if ((x = /^\s*#{1,4}\s+(.+)$/.exec(line))) { endPara(); endList(); html += '<h5>' + inline(x[1]) + '</h5>'; continue; }
      if ((x = /^\s*(?:[-*•·]|\d+[.)]|[①-⑳])\s+(.+)$/.exec(line))) {
        const kind = /^\s*(?:\d+[.)]|[①-⑳])/.test(line) ? 'ol' : 'ul';
        endPara(); if (list !== kind) { endList(); html += '<' + kind + '>'; list = kind; }
        const num = /^\s*([①-⑳])/.exec(line);
        html += '<li' + (num ? ' class="cn" data-n="' + num[1] + '"' : '') + '>' + label(inline(x[1])) + '</li>'; continue;
      }
      endList(); para.push(label(line));
    }
    if (code !== null) html += '<pre>' + code.join('\n') + '</pre>';
    endPara(); endList();
    return html;
  }
  // 줄머리 「검사: …」 같은 짧은 라벨은 굵게
  function label(t) { return t.replace(/^([^\s:<>]{1,14}(?: [^\s:<>]{1,8})?):\s/, '<b class="lb">$1</b> '); }

  // 작업 과정(중계가 올린 live): 아이콘 + 한 줄. 작업 중이면 마지막 몇 줄, 펼치면 전체
  const LIVE_ICON = { read: '📄', edit: '✏️', run: '⌨️', search: '🔍', text: '💬', think: '💭', tool: '🔧' };
  function liveList(items, all) {
    const xs = all ? items : items.slice(-5);
    return '<ul class="live-list">' + xs.map((x) => '<li class="k-' + esc(x.k) + '"><span class="ic">' + (LIVE_ICON[x.k] || '•') + '</span>'
      + (x.a ? '<span class="la">' + esc(x.a) + '</span>' : '') + '<span class="ls">' + esc(x.s) + '</span></li>').join('') + '</ul>';
  }

  // ── 읽기 쉽게(hong 11-11): 답을 「결론 / 선택 / 자세히」로 나누고, Claude·Codex 가 서로 주고받은 글과 시스템 알림은 한 줄로 접는다 ──
  const AGENTS = ['Claude', 'Codex'];
  const isA2A = (m) => AGENTS.includes(m.sender) && AGENTS.includes(m.recipient);
  const isSys = (m) => m.sender !== ME && m.status === '안내' && /^\s*\[(중계|웹 엔진 자동 갱신)\]/.test(m.body || '');
  const fold = { on: null, get() { if (this.on === null) { try { this.on = localStorage.getItem('sonik.ch.fold') !== '0'; } catch (_) { this.on = true; } } return this.on; }, set(v) { this.on = !!v; try { localStorage.setItem('sonik.ch.fold', v ? '1' : '0'); } catch (_) { /* 무시 */ } } };
  const MORE_RE = /<<<자세히[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*자세히>>>/g;
  const PICK_RE = /<<<선택[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*선택>>>/g;
  const plain = (t) => String(t || '').replace(/<<<[\s\S]*$/, '').replace(/[*`#>]/g, '').replace(/^\s*\[[^\]]{1,14}\]\s*/, '').trim();
  const firstLine = (t, n) => { const x = (plain(t).split(/\r?\n/).find((l) => l.trim()) || '').trim(); return x.length > n ? x.slice(0, n) + '…' : x; };
  // 본문 → { head: 늘 보이는 글, more: 접어 두는 글, picks: [{q, opts}] }
  // 중계가 블록으로 나눠 준 답은 그대로, 블록이 없는 긴 답(옛 글)은 첫 문단(+ 맨 끝 번호 목록)만 남기고 가운데를 접는다
  function splitBody(body) {
    let t = String(body || '');
    const picks = [], more = [];
    t = t.replace(PICK_RE, (_, b) => {
      const ls = b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const q = (ls.find((l) => /^질문\s*:/.test(l)) || '').replace(/^질문\s*:\s*/, '');
      const opts = ls.filter((l) => /^[-*•]\s+/.test(l)).map((l) => l.replace(/^[-*•]\s+/, '').slice(0, 60)).slice(0, 4);
      if (opts.length >= 2) picks.push({ q, opts });
      return '';
    });
    t = t.replace(MORE_RE, (_, b) => { more.push(b.trim()); return ''; }).trim();
    if (more.length) return { head: t, more: more.join('\n\n'), picks };
    if (t.length <= 700) return { head: t, more: '', picks };
    const blocks = t.split(/\r?\n[ \t]*\r?\n/).filter((b) => b.trim());
    if (blocks.length < 3) return { head: t, more: '', picks };
    const last = blocks[blocks.length - 1], ask = last.split(/\r?\n/).every((l) => /^\s*(\d+[.)]|[①-⑳])\s/.test(l));
    const mid = blocks.slice(1, ask ? -1 : undefined);
    if (!mid.length) return { head: t, more: '', picks };
    return { head: blocks[0] + (ask ? '\n\n' + last : ''), more: mid.join('\n\n'), picks };
  }
  // 선택 카드: 선택지를 누르면 「선택: …」 글이 그 답에 이어 올라가고(= hong 의 답), 무엇을 골랐는지가 카드에 남는다
  const pickedOf = (m) => ch.rows.find((r) => r.reply_to === m.id && r.sender === ME && /^선택\s*:/.test(r.body || ''));
  function pickCard(m, picks) {
    const done = pickedOf(m);
    if (done) return '<div class="pick done"><div class="pick-ok">✔ ' + esc(done.body.replace(/^선택\s*:\s*/, '').replace(/\n선택\s*:\s*/g, ' · ')) + ' <span class="hint">' + esc(hm(done.at)) + '</span></div></div>';
    const can = !ch.member && MINE(m), sel = ch.pick[m.id] || {};
    return '<div class="pick">' + picks.map((p, i) => (p.q ? '<div class="pick-q">' + esc(p.q) + '</div>' : '')
      + '<div class="pick-b">' + p.opts.map((o, j) => '<button' + (can ? '' : ' disabled') + ' class="' + (sel[i] === o ? 'on' : j === 0 ? 'pri' : '') + '" data-pick="' + m.id + ':' + i + ':' + j + '">' + esc(o) + '</button>').join('') + '</div>').join('')
      + (picks.length > 1 && can ? '<button class="pri pick-go" data-pickgo="' + m.id + '"' + (picks.every((_, i) => sel[i]) ? '' : ' disabled') + '>고른 대로 보내기</button>' : '')
      + (can ? '<div class="hint">다르게 답하려면 아래에 직접 쓰면 됩니다.</div>' : '') + '</div>';
  }
  async function sendPick(m, answers) {
    const { data: s } = await ch.sb.auth.getSession();
    const row = { sender: ME, recipient: m.recipient === '모두' ? '모두' : m.sender, topic: m.topic || '', status: '대기', reply_to: m.id,
      body: answers.join('\n'), files: [], quick: false, author_email: (s.session.user.email || '').toLowerCase() };
    const { error } = await ch.sb.from('sk_channel').insert(row);
    if (error) { alertMsg('보내지 못했습니다: ' + error.message); return; }
    delete ch.pick[m.id];
    if (m.status === '대기') await setStatus(m.id, '답변'); else await load();
    render(true);
  }
  function onPick(id, i, j) {
    const m = ch.rows.find((x) => x.id === id); if (!m) return;
    const picks = splitBody(m.body).picks, p = picks[i]; if (!p || !p.opts[j]) return;
    if (picks.length === 1) return sendPick(m, ['선택: ' + p.opts[j]]);
    (ch.pick[id] = ch.pick[id] || {})[i] = p.opts[j]; render(false);
  }
  function onPickGo(id) {
    const m = ch.rows.find((x) => x.id === id); if (!m) return;
    const picks = splitBody(m.body).picks, sel = ch.pick[id] || {};
    if (!picks.every((_, i) => sel[i])) return;
    return sendPick(m, picks.map((p, i) => '선택: ' + (p.q ? p.q + ' → ' : '') + sel[i]));
  }
  // 수정요청 단계(접수 › 작업중 › 완료): 글에 달린 요청 번호로 한 번에 읽어 둔다(30초에 한 번까지)
  async function loadReqs() {
    if (ch.member) return;
    const ids = [...new Set(ch.rows.map((m) => m.request_id).filter(Boolean))];
    if (!ids.length || Date.now() - ch.reqAt < 30000) return;
    ch.reqAt = Date.now();
    const { data, error } = await ch.sb.from('sk_requests').select('id,title,stage,status').in('id', ids);
    if (error || !data) return;
    const sigOf = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k].stage, o[k].status]));
    const next = {}; data.forEach((r) => { next[r.id] = r; });
    const changed = sigOf(next) !== sigOf(ch.reqs);
    ch.reqs = next;
    if (changed) render(false);
  }
  function stageChip(reqId) {
    const r = ch.reqs[reqId]; if (!r) return '';
    if (['취소', '반려', '승인대기'].includes(r.status)) return '<span class="stgc"><b>' + esc(r.status) + '</b></span>';
    const n = r.status === '완료' || r.stage >= 4 ? 2 : r.stage >= 1 ? 1 : 0;
    return '<span class="stgc">' + ['접수', '작업중', '완료'].map((t, i) => (i === n ? '<b>' + t + '</b>' : '<i>' + t + '</i>')).join(' › ') + '</span>';
  }
  // 맨 위 한 줄: 지금 누가 무엇을 몇 분째 하는지, 그 뒤에 기다리는 글이 몇 건인지
  function nowLine() {
    const el = $('chNow'); if (!el) return;
    if (ch.member) { el.hidden = true; return; }
    const run = ch.rows.filter((m) => m.run_state === '실행중');
    const queued = ch.rows.filter((m) => m.status === '대기' && !m.run_state && !m.quick && [...AGENTS, '모두'].includes(m.recipient)).length;
    el.hidden = !run.length && !queued;
    if (el.hidden) return;
    el.innerHTML = (run.length ? run.map((m) => {
      const who = m.run_note || (m.recipient === '모두' ? 'Claude' : m.recipient);
      const t0 = ((m.live || []).find((x) => !x.a || x.a === who) || {}).at || m.updated_at || m.at;
      const min = Math.max(0, Math.round((Date.now() - Date.parse(t0)) / 60000));
      return '⏳ <b>' + esc(who) + '</b> 작업 중 · ' + (min < 1 ? '방금 시작' : min + '분째') + (m.topic ? ' · ' + esc(m.topic) : '') + (m.quick ? ' ⚡' : '');
    }).join('<br>') : '⏸ 실행 중인 작업 없음') + (queued ? ' <span class="hint">· 다음 차례 ' + queued + '건</span>' : '');
  }
  // 「내 차례」 띠: hong 이 답해야 하는 글만 한 줄씩(누르면 그 글로)
  function turnStrip() {
    const el = $('chTurn'); if (!el) return;
    const mine = ch.member ? [] : ch.rows.filter((m) => MINE(m) && m.status === '대기');
    el.hidden = !mine.length || ch.onlyMine;
    if (el.hidden) return;
    el.innerHTML = '<b>내 차례 ' + mine.length + '건</b>' + mine.slice(-4).reverse().map((m) => '<a href="#ch' + m.id + '" data-go="' + m.id + '"><span class="tw">' + esc(m.sender) + '</span>'
      + (m.topic ? '<span class="tt">' + esc(m.topic) + '</span>' : '') + '<span class="ts">' + esc(firstLine(m.body, 46)) + '</span></a>').join('') + (mine.length > 4 ? '<span class="hint">… 나머지는 「내 대기」에서</span>' : '');
    el.querySelectorAll('[data-go]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); const t = document.getElementById('ch' + a.getAttribute('data-go')); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1500); } }; });
  }
  // 시스템 알림(중계·웹 엔진 자동 갱신): 한 줄 배지, 누르면 전문
  function sysLine(m, byId) {
    const open = ch.sysOpen[m.id];
    return '<div class="cm sys" id="ch' + m.id + '"><button class="sys-tg" data-sys="' + m.id + '">🔧 ' + esc(firstLine(m.body, 70)) + ' <span class="hint">' + esc(hm(m.at)) + '</span> ' + (open ? '▾' : '▸') + '</button></div>'
      + (open ? bubble(m, byId, true) : '');
  }
  // Claude ↔ Codex 사이 글 묶음: 한 줄(몇 개 · 주제 · 마지막 글 첫 줄), 누르면 펼침
  function foldLine(run, byId) {
    const k = run[0].id, open = ch.foldOpen[k], last = run[run.length - 1];
    const req = run.map((m) => m.request_id).filter(Boolean).pop();
    return '<div class="cm a2a"><button class="a2a-tg" data-fold="' + k + '">' + (open ? '▾' : '▸') + ' Claude ↔ Codex 글 ' + run.length + '개'
      + (last.topic ? ' · <span class="tt">' + esc(last.topic) + '</span>' : '') + (req ? ' ' + stageChip(req) : '')
      + (open ? '' : '<span class="ts">' + esc(last.sender) + ': ' + esc(firstLine(last.body, 60)) + '</span>') + '</button></div>'
      + (open ? '<div class="a2a-box">' + run.map((m) => bubble(m, byId)).join('') + '</div>' : '');
  }

  function bubble(m, byId, noId) {
    const mine = m.sender === ME, re = m.reply_to && byId.get(m.reply_to);
    const wait = MINE(m) && m.status === '대기';
    const sp = mine ? null : splitBody(m.body), dOpen = ch.moreOpen[m.id];
    const txt = (t) => { const d = parseDraft(t); return d ? (d.rest ? '<div class="txt">' + md(d.rest) + '</div>' : '') + draftCard(m, d) : (t ? '<div class="txt">' + md(t) + '</div>' : ''); };
    return '<div class="cm ' + (mine ? 'me' : 'them s-' + esc(m.sender)) + (wait ? ' wait' : '') + '"' + (noId ? '' : ' id="ch' + m.id + '"') + '>'
      + (mine ? '' : '<div class="who">' + esc(NAME(m.sender, m)) + (m.recipient !== ME ? ' <span class="hint">→ ' + esc(NAME(m.recipient, m)) + '</span>' : '') + '</div>')
      + '<div class="line">'
      + '<div class="bub">'
      + (mine ? '<div class="to">→ ' + esc(NAME(m.recipient, m)) + (m.topic ? ' · ' + esc(m.topic) : '') + '</div>' : m.topic ? '<div class="to">' + esc(m.topic) + '</div>' : '')
      + (re ? '<a class="quote" href="#ch' + re.id + '">' + esc(NAME(re.sender, re)) + ': ' + esc(firstLine(re.body, 50)) + '</a>' : '')
      + (m.body ? (mine ? '<div class="txt">' + esc(m.body) + '</div>' : txt(sp.head) + (sp.picks.length ? pickCard(m, sp.picks) : '')
        + (sp.more ? '<button class="more-tg" data-more="' + m.id + '">' + (dOpen ? '▾ 자세히 접기' : '▸ 자세히') + '</button>' + (dOpen ? '<div class="more-box">' + txt(sp.more) + '</div>' : '') : '')) : '') + atts(m)
      + (!mine && m.request_id && stageChip(m.request_id) ? '<div class="ctxline">수정요청 #' + m.request_id + ' ' + stageChip(m.request_id) + '</div>' : '')
      + (m.ctx_memo || m.ctx_loc ? '<div class="ctxline">📄 ' + esc([m.ctx_memo, m.ctx_loc].filter(Boolean).join(' · ')) + ' 기준</div>' : '') + '</div>'
      + '<div class="meta">' + (m.status !== '안내' ? '<span class="st st-' + esc(m.status) + '">' + esc(m.status) + '</span>' : '')
      + (!ch.member && (m.status === '대기' || m.status === '답변') ? '<button class="done-btn" data-done="' + m.id + '" title="이 글을 완료로 바꿉니다">✓ 완료</button>' : '')
      + (m.quick ? '<span class="q">⚡ 빠른 질문</span>' : '')
      + (m.run_state ? '<span class="run" title="' + esc(m.run_note || '') + '">' + (/^중지/.test(m.run_note || '') ? '■ 중지됨' : RUN[m.run_state]) + '</span>' : '')
      + '<span>' + esc(hm(m.at)) + '</span></div></div></div>'
      // 끝난 작업: 「작업 과정 N단계」를 눌러 펼친다
      + ((m.live || []).length && m.run_state !== '실행중' ? '<div class="cm them live-done"><button class="live-tg" data-live="' + m.id + '">' + (ch.liveOpen[m.id] ? '▾' : '▸') + ' 작업 과정 ' + m.live.length + '단계</button>'
        + (ch.liveOpen[m.id] ? '<div class="live-box">' + liveList(m.live, true) + '</div>' : '') + '</div>' : '');
  }
  // 첨부: 이미지는 미리보기(누르면 원본), 나머지는 내려받기 링크. 주소는 1시간짜리 서명 주소
  function atts(m) {
    const fs = m.files || [];
    if (!fs.length) return '';
    return '<div class="atts">' + fs.map((f) => {
      const u = ch.urls[f.path];
      const kb = f.size ? ' (' + (f.size < 1048576 ? Math.ceil(f.size / 1024) + 'KB' : (f.size / 1048576).toFixed(1) + 'MB') + ')' : '';
      if (/^image\//.test(f.type || '') && u) return '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="' + esc(f.name) + '" loading="lazy"></a>';
      // 다른 출처 주소라 download 속성이 안 먹으므로, 저장소에 원래 이름으로 내려받게 한다(download 매개변수)
      const du = u ? u + (u.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(f.name || '') : '';
      return u ? '<a class="att-dl" href="' + esc(du) + '" target="_blank" rel="noopener" download="' + esc(f.name) + '">⬇ ' + esc(f.name) + kb + '</a>' : '<span>📄 ' + esc(f.name) + kb + (ch.gone && ch.gone[f.path] ? ' <i class="hint">(정리됨)</i>' : '') + '</span>';
    }).join('') + '</div>';
  }
  async function sign() {
    if (Date.now() - (ch.signedAt || 0) > 50 * 60000) { ch.urls = {}; ch.signedAt = Date.now(); } // 1시간 만료 전에 새로 받는다
    const need = [];
    ch.rows.forEach((m) => (m.files || []).forEach((f) => { if (!ch.urls[f.path]) need.push(f.path); }));
    if (!need.length) return;
    const { data } = await ch.sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    ch.gone = ch.gone || {};
    (data || []).forEach((d) => { if (d.signedUrl) ch.urls[d.path] = d.signedUrl; else if (d.error) ch.gone[d.path] = 1; }); // 저장소 정리로 지운 첨부
    render(false);
  }
  function render(scroll) {
    const byId = new Map(ch.rows.map((m) => [m.id, m]));
    const waiting = ch.rows.filter((m) => MINE(m) && m.status === '대기').length;
    $('chMine').textContent = '내 대기 ' + waiting;
    $('chMine').classList.toggle('on', ch.onlyMine);
    const list = ch.onlyMine ? ch.rows.filter((m) => MINE(m) && m.status === '대기') : ch.rows;
    let lastDay = '', html = '', run = [];
    const folding = !ch.member && !ch.onlyMine && fold.get();
    if ($('chFold')) { $('chFold').hidden = !!ch.member; $('chFold').classList.toggle('on', fold.get()); }
    const flush = () => { if (run.length) { html += foldLine(run, byId); run = []; } };
    list.forEach((m) => {
      const d = day(m.at);
      if (d !== lastDay) { flush(); html += '<div class="day">' + esc(d) + '</div>'; lastDay = d; }
      if (folding && isA2A(m)) { run.push(m); return; }
      flush();
      html += folding && isSys(m) ? sysLine(m, byId) : bubble(m, byId);
    });
    flush();
    nowLine(); turnStrip();
    // 중계가 실행 중인 글이 있으면 받는이가 「작업 중」인 말풍선
    ch.rows.filter((m) => m.run_state === '실행중').forEach((m) => {
      const who = m.run_note || (m.recipient === '모두' ? 'Claude' : m.recipient); // 지금 답하는 담당(run_note)
      const stop = m.quick ? '' : ch.stopAsked === m.id ? '<span class="hint"> · 중지 요청함</span>' : '<button class="stop" data-stop="' + m.id + '" title="이 작업을 끊습니다">■ 중지</button>';
      const lv = (m.live || []).filter((x) => !x.a || x.a === who), open = ch.liveOpen[m.id];
      html += '<div class="cm them s-' + esc(who) + '"><div class="who">' + esc(who) + (m.quick ? ' <span class="hint">⚡</span>' : '') + '</div><div class="line"><div class="bub typing">'
        + '<div class="typing-head">작업 중<i>.</i><i>.</i><i>.</i>' + stop + '</div>'
        + (lv.length ? '<div class="live-box' + (open ? ' all' : '') + '">' + liveList(lv, open) + '</div>'
          + (lv.length > 5 ? '<button class="live-tg" data-live="' + m.id + '">' + (open ? '▾ 최근만' : '▸ 전체 ' + lv.length + '단계') + '</button>' : '') : '')
        + '</div></div></div>';
    });
    const box = $('chRows'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = html || '<p class="hint center">' + (ch.onlyMine ? '나에게 온 대기 글이 없습니다.' : '아직 대화가 없습니다. 아래에서 첫 글을 보내 보세요.') + '</p>';
    box.querySelectorAll('[data-more]').forEach((b) => { b.onclick = () => { const id = +b.getAttribute('data-more'); ch.moreOpen[id] = !ch.moreOpen[id]; render(false); }; });
    box.querySelectorAll('[data-fold]').forEach((b) => { b.onclick = () => { const id = +b.getAttribute('data-fold'); ch.foldOpen[id] = !ch.foldOpen[id]; render(false); }; });
    box.querySelectorAll('[data-sys]').forEach((b) => { b.onclick = () => { const id = +b.getAttribute('data-sys'); ch.sysOpen[id] = !ch.sysOpen[id]; render(false); }; });
    box.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { const [id, i, j] = b.getAttribute('data-pick').split(':').map(Number); box.querySelectorAll('[data-pick^="' + id + ':"]').forEach((x) => { x.disabled = splitBody((ch.rows.find((r) => r.id === id) || {}).body).picks.length === 1; }); onPick(id, i, j); }; });
    box.querySelectorAll('[data-pickgo]').forEach((b) => { b.onclick = () => { b.disabled = true; onPickGo(+b.getAttribute('data-pickgo')); }; });
    box.querySelectorAll('[data-rqd]').forEach((b) => { b.onclick = () => fileDraft(+b.getAttribute('data-rqd')); });
    box.querySelectorAll('[data-live]').forEach((b) => { b.onclick = () => { const id = +b.getAttribute('data-live'); ch.liveOpen[id] = !ch.liveOpen[id]; render(false); }; });
    box.querySelectorAll('.live-box.all').forEach((x) => { x.scrollTop = x.scrollHeight; });
    box.querySelectorAll('[data-stop]').forEach((b) => { b.onclick = () => askStop(+b.getAttribute('data-stop')); });
    // hong 11-09 #704: 관리자는 대기·답변 글을 「완료」로 직접 바꾼다
    box.querySelectorAll('[data-done]').forEach((b) => { b.onclick = async () => { b.disabled = true; await setStatus(+b.getAttribute('data-done'), '완료'); render(false); }; });
    if (scroll || atBottom || !ch.lastTop) box.scrollTop = box.scrollHeight;
    ch.lastTop = 1;
  }
  function setTo(to) {
    if (ch.member) to = 'Claude'; // 담당자 챗봇은 Claude 로 일원화, Codex 는 hong 의 개발 교차검증 전용(hong 11/06)
    ch.to = to;
    document.querySelectorAll('#chTo button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-to') === to));
    $('chBody').placeholder = ch.member ? 'Claude에게 질문 (캡처 붙여넣기 가능 · 「파일로 줘」하면 CSV로 받습니다)' : ch.quick ? '⚡ 빠른 질문: 진행 중인 작업과 따로, 파일을 고치지 않고 바로 답합니다' : to === '모두' ? 'Claude·Codex 모두에게 (Claude → Codex 순서로 답합니다)' : to + '에게 보내기 (Shift+Enter 줄바꿈)';
  }
  function setQuick(v) {
    ch.quick = v;
    $('chQuick').classList.toggle('on', v);
    setTo(ch.to);
  }
  function setReply(id) {
    const m = ch.rows.find((x) => x.id === id);
    ch.replyTo = m || null;
    $('chReply').hidden = !m;
    if (m) {
      $('chReplyTxt').textContent = '↩ ' + m.sender + ': ' + m.body.slice(0, 60);
      if (m.recipient === '모두') setTo('모두'); // 셋이 하던 대화는 셋이 이어 간다
      else if (m.sender !== ME) setTo(m.sender);
      $('chBody').focus();
    }
  }
  async function setStatus(id, status) {
    const { error } = await ch.sb.from('sk_channel').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alertMsg('상태를 바꾸지 못했습니다: ' + error.message); return; }
    await load();
  }
  function addFiles(list) {
    for (const f of list) {
      if (f.size > MAXB) { alertMsg(f.name + ' : 20MB 를 넘어 올릴 수 없습니다'); continue; }
      ch.pending.push(f);
    }
    showPending();
  }
  function showPending() {
    const box = $('chFiles');
    box.hidden = !ch.pending.length;
    box.innerHTML = ch.pending.map((f, i) => '<span><b>' + esc(f.name || '붙여넣은 이미지') + '</b><button data-x="' + i + '" title="빼기">×</button></span>').join('');
    box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { ch.pending.splice(+b.getAttribute('data-x'), 1); showPending(); }; });
  }
  // 저장 이름은 영문·숫자만(한글 이름은 저장소 키로 쓸 수 없다). 원래 이름은 글의 files 에 남긴다
  async function upload(f) {
    const ext = ((f.name || '').match(/\.([A-Za-z0-9]{1,8})$/) || [, (f.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '')])[1].toLowerCase();
    const path = (ch.member ? 'member/' + ch.email.replace(/[^a-z0-9._-]/g, '_') : ME) + '/' + new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await ch.sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
    if (error) throw new Error((f.name || '이미지') + ' 올리기 실패: ' + error.message);
    return { path, name: f.name || ('붙여넣은 이미지.' + ext), size: f.size, type: f.type || '' };
  }
  function alertMsg(t) { $('chMsg').textContent = t; $('chMsg').hidden = !t; }
  function grow() { const t = $('chBody'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
  async function send() {
    const body = $('chBody').value.trim();
    if (!body && !ch.pending.length) return;
    alertMsg('');
    $('chSend').disabled = true;
    let files = [];
    try { for (const f of ch.pending) files.push(await upload(f)); } catch (e) { $('chSend').disabled = false; alertMsg(e.message); return; }
    const { data: s } = await ch.sb.auth.getSession();
    // 답글 단추는 없앴다(hong 10/30). 보내는 상대가 나에게 남긴 대기 글 중 마지막 것에 이어 쓰고, 그 대기 글들은 「답변」으로 바꾼다
    const owed = ch.rows.filter((m) => MINE(m) && m.status === '대기' && m.sender !== ME && (ch.to === '모두' || m.sender === ch.to));
    const re = ch.replyTo || owed[owed.length - 1] || null;
    const row = { sender: ME, recipient: ch.to, topic: re && re.topic ? re.topic : '', status: '대기',
      reply_to: re ? re.id : null, body, files, quick: ch.member || ch.quick, author_email: (s.session.user.email || '').toLowerCase() };
    // 열어 둔 자료 기준 질문(hong 11/03): 자료가 열려 있으면 늘 그 자료(id·저장본)와 보이는 표를 붙인다
    if (!$('chCtxBox').hidden && ch.ctxFn) { try { const c = ch.ctxFn(true); if (c) row.ctx = c; } catch (e) { console.warn('화면 읽기 실패', e); } }
    if (ch.member) row.owner = row.author_email; // 담당자 대화: 내 대화로 표시(답도 나에게만 보인다)
    const { error } = await ch.sb.from('sk_channel').insert(row);
    $('chSend').disabled = false;
    if (error) { alertMsg('보내지 못했습니다: ' + error.message); return; }
    // 나에게 온 대기 글에 답하면 원글은 「답변」
    for (const m of (re && MINE(re) && re.status === '대기' && !owed.includes(re) ? owed.concat(re) : owed)) await setStatus(m.id, '답변');
    $('chBody').value = ''; grow(); setReply(null); ch.pending = []; showPending(); setQuick(ch.member);
    await load(); render(true);
  }

  window.SonikChannel = {
    // app.js 가 자료를 열고 닫을 때 부른다. fn(full) → ctx 객체 또는 null
    setContext(fn) { ch.ctxFn = fn || null; if (ch.open) refreshCtx(); },
    // app.js 가 「수정요청 초안 → 올리기」 창을 넘겨준다. fn(draft) → 올린 요청 번호 또는 null
    setDraftHandler(fn) { ch.onDraft = fn || null; if (ch.open) render(false); },
    // app.js 가 목록 화면을 그릴 때 부른다. 관리자가 아니면 카드를 숨긴다.
    mount(sb, me) {
      ch.sb = sb;
      const ok = !!(me && me.role);
      $('chFab').hidden = !ok;
      clearInterval(ch.timer);
      if (!ok) { $('chCard').hidden = true; return; }
      // 담당자: 내 대화만, 읽기 전용 질의응답. 첨부·⚡ 전환·중계 멈춤/모델 설정은 숨긴다
      ch.member = me.role !== 'admin'; ME = ch.member ? '담당' : 'hong';
      ['chQuick', 'chPause', 'chSet', 'chTo'].forEach((id) => { $(id).hidden = ch.member; }); // 담당자도 캡처·파일 첨부 가능(hong 11/03)
      ch.email = String(me.email || '').toLowerCase();
      if (ch.member) $('chSetBox').hidden = true;
      $('chWho').textContent = ch.member ? '나 · Claude (읽기 전용 질의응답)' : 'hong · Claude · Codex';
      ch.quick = ch.member;
      $('chFab').onclick = () => setOpen(!ch.open);
      $('chClose').onclick = () => setOpen(false);
      $('chSize').onclick = toggleSize;
      if (!ch.keyed) { ch.keyed = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ch.open && $('modal').hidden) setOpen(false); }); }
      $('chSend').onclick = send;
      $('chPause').onclick = togglePause;
      $('chSet').onclick = () => { $('chSetBox').hidden = !$('chSetBox').hidden; };
      $('chClaudeModel').onchange = $('chCodexModel').onchange = $('chCodexEffort').onchange = saveModels;
      $('chQuick').onclick = () => setQuick(!ch.quick);
      $('chMine').onclick = () => { ch.onlyMine = !ch.onlyMine; render(true); };
      if ($('chFold')) $('chFold').onclick = () => { fold.set(!fold.get()); render(false); };
      clearInterval(ch.nowTimer); ch.nowTimer = setInterval(() => { if (ch.open && !document.hidden) nowLine(); }, 30000);
      $('chReplyX').onclick = () => setReply(null);
      document.querySelectorAll('#chTo button').forEach((b) => { b.onclick = () => setTo(b.getAttribute('data-to')); });
      setTo(ch.to);
      $('chBody').oninput = grow;
      $('chBody').onfocus = refreshCtx;
      $('chAttach').onclick = () => $('chFile').click();
      $('chFile').onchange = () => { addFiles($('chFile').files); $('chFile').value = ''; };
      // 캡처 이미지 붙여넣기(Ctrl+V)와 끌어놓기
      $('chBody').onpaste = (e) => { const fs = [...(e.clipboardData && e.clipboardData.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } };
      const card = $('chCard');
      resizable();
      card.ondragover = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); card.classList.add('drop'); } };
      card.ondragleave = (e) => { if (e.target === card) card.classList.remove('drop'); };
      card.ondrop = (e) => { e.preventDefault(); card.classList.remove('drop'); addFiles(e.dataTransfer.files); };
      // 한글 입력 중(조합 중) Enter 는 글자 확정이므로 보내지 않는다
      $('chBody').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } };
      if (ch.rows.length) render(false); // 역할이 바뀌면(관리자 ↔ 담당자) 접기·상황·내 차례를 그 역할에 맞게 다시 그린다
      load(true);
      // 열려 있으면 10초마다, 닫혀 있으면 30초마다(배지용) 새로 읽는다
      // Realtime 연결 중: 열려 있으면 5분, 닫혀 있으면 15분마다 예비로 다시 읽는다. 끊겨 있으면 예전처럼 10초·30초
      ch.timer = setInterval(() => {
        ch.tick++;
        if (document.hidden) return;
        const age = Date.now() - (ch.partAt || ch.fullAt || 0);
        if (ch.live ? age > (ch.open ? 300000 : 900000) : (ch.open || ch.tick % 3 === 0)) load(!ch.live);
      }, 10000);
      // 새 글·답·작업 과정이 생기면 Realtime 알림에 실린 행을 바로 합친다(migration 012). 다시 읽지 않는다
      if (!ch.rt) {
        ch.rt = sb.channel('sk_channel_web').on('postgres_changes', { event: '*', schema: 'public', table: 'sk_channel' }, (p) => {
          try { apply(p); } catch (_) { load(); }
        }).subscribe((status) => {
          const was = ch.live; ch.live = status === 'SUBSCRIBED';
          if (ch.live && was === false) load(true); // 다시 연결되면 끊긴 사이 놓친 글을 한 번 통째로 읽는다
        });
      }
    },
  };
})();
