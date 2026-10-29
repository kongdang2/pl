// 소통 채널 — hong · Codex · Claude 가 주고받는 글(sk_channel)을 채팅 형태로 보여준다. 관리자(hong)와 에이전트 계정만 읽고 쓴다.
// 상태: 대기(받는이가 답해야 함) → 답변 → 완료, 알림만이면 안내. hong 이 「모두」로 보내면 Claude → Codex 순서로 둘 다 답한다(셋이 대화). 글 내용은 고치지 않고 상태만 바꾼다.
// 화면 오른쪽 아래 💬 버튼으로 여닫는 팝업이라 목록·시스템 화면 어디서나 쓴다. 닫혀 있으면 새 글 수를 버튼에 표시한다.
// PC 중계(소통\중계.cjs)가 Codex·Claude 앞 「대기」 글을 실행하고 답을 올린다(sk_relay: 신호·멈춤).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = (s) => new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const day = (s) => new Date(s).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const ME = 'hong', MINE = (m) => m.sender !== ME && (m.recipient === ME || m.recipient === '모두');
  const RUN = { 실행중: '⏳ 작업 중', 완료: '✓ 자동 처리', 실패: '✗ 자동 실패', 건너뜀: '⏸ 왕복 한도' };
  const ch = { sb: null, rows: [], replyTo: null, timer: null, onlyMine: false, to: 'Claude', relay: null, lastTop: 0, open: false, tick: 0, pending: [], urls: {}, quick: false, stopAsked: 0, liveOpen: {} };
  const BUCKET = 'sonik-channel', MAXB = 20 * 1024 * 1024; // 첨부: 비공개 버킷, 파일당 20MB
  // 마지막으로 본 글 번호(이 브라우저에만 저장). 저장이 막혀 있으면 배지만 덜 정확하다
  const seen = { get() { try { return +localStorage.getItem('sonik.ch.seen') || 0; } catch (_) { return 0; } }, set(v) { try { localStorage.setItem('sonik.ch.seen', String(v)); } catch (_) { /* 무시 */ } } };

  async function load() {
    const { data, error } = await ch.sb.from('sk_channel').select('*').order('at', { ascending: false }).limit(150);
    if (error) { $('chRows').innerHTML = '<p class="hint">채널을 읽지 못했습니다: ' + esc(error.message) + '</p>'; return; }
    const before = ch.rows.length && ch.rows[ch.rows.length - 1].id;
    const sig = (r) => r.map((m) => m.id + m.status + (m.run_state || '') + (m.run_note || '') + ':' + (m.live || []).length).join();
    const changed = sig(ch.rows) !== sig((data || []).slice().reverse());
    ch.rows = (data || []).reverse();
    if (changed) render(before !== (ch.rows.length && ch.rows[ch.rows.length - 1].id));
    if (ch.open) sign();
    badge();
    if (ch.open) loadRelay();
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
  function place(b) {
    const st = $('chCard').style;
    if (!b || !wide()) { st.left = st.top = st.width = st.height = st.right = st.bottom = ''; return; }
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
      g.ondblclick = () => { box.set(null); place(null); };
      g.onpointerdown = (e) => {
        if (e.button !== 0 || !wide()) return;
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
    head.onpointerdown = (e) => {
      if (e.button !== 0 || !wide() || e.target.closest('button,select,input,textarea,a,label')) return;
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
  function setOpen(v) {
    ch.open = v;
    if (v) place(box.get());
    $('chCard').hidden = !v;
    $('chFab').classList.toggle('open', v);
    if (v) { ch.lastTop = 0; load().then(() => { render(true); $('chBody').focus(); }); } else badge();
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

  function bubble(m, byId) {
    const mine = m.sender === ME, re = m.reply_to && byId.get(m.reply_to);
    const wait = MINE(m) && m.status === '대기';
    return '<div class="cm ' + (mine ? 'me' : 'them s-' + esc(m.sender)) + (wait ? ' wait' : '') + '" id="ch' + m.id + '">'
      + (mine ? '' : '<div class="who">' + esc(m.sender) + (m.recipient !== ME ? ' <span class="hint">→ ' + esc(m.recipient) + '</span>' : '') + '</div>')
      + '<div class="line">'
      + '<div class="bub">'
      + (mine ? '<div class="to">→ ' + esc(m.recipient) + (m.topic ? ' · ' + esc(m.topic) : '') + '</div>' : m.topic ? '<div class="to">' + esc(m.topic) + '</div>' : '')
      + (re ? '<a class="quote" href="#ch' + re.id + '">' + esc(re.sender) + ': ' + esc(re.body.slice(0, 50)) + (re.body.length > 50 ? '…' : '') + '</a>' : '')
      + (m.body ? '<div class="txt">' + (mine ? esc(m.body) : md(m.body)) + '</div>' : '') + atts(m) + '</div>'
      + '<div class="meta">' + (m.status !== '안내' ? '<span class="st st-' + esc(m.status) + '">' + esc(m.status) + '</span>' : '')
      + (m.quick ? '<span class="q">⚡ 빠른 질문</span>' : '')
      + (m.run_state ? '<span class="run" title="' + esc(m.run_note || '') + '">' + (/^중지/.test(m.run_note || '') ? '■ 중지됨' : RUN[m.run_state]) + '</span>' : '')
      + '<span>' + esc(hm(m.at)) + '</span></div></div>'
      + '<div class="acts"><button data-re="' + m.id + '">답글</button>'
      + (m.status === '대기' || m.status === '답변' ? '<button data-done="' + m.id + '">완료</button>' : '') + '</div></div>'
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
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener" download="' + esc(f.name) + '">📄 ' + esc(f.name) + kb + '</a>' : '<span>📄 ' + esc(f.name) + kb + '</span>';
    }).join('') + '</div>';
  }
  async function sign() {
    if (Date.now() - (ch.signedAt || 0) > 50 * 60000) { ch.urls = {}; ch.signedAt = Date.now(); } // 1시간 만료 전에 새로 받는다
    const need = [];
    ch.rows.forEach((m) => (m.files || []).forEach((f) => { if (!ch.urls[f.path]) need.push(f.path); }));
    if (!need.length) return;
    const { data } = await ch.sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    (data || []).forEach((d) => { if (d.signedUrl) ch.urls[d.path] = d.signedUrl; });
    render(false);
  }
  function render(scroll) {
    const byId = new Map(ch.rows.map((m) => [m.id, m]));
    const waiting = ch.rows.filter((m) => MINE(m) && m.status === '대기').length;
    $('chMine').textContent = '내 대기 ' + waiting;
    $('chMine').classList.toggle('on', ch.onlyMine);
    const list = ch.onlyMine ? ch.rows.filter((m) => MINE(m) && m.status === '대기') : ch.rows;
    let lastDay = '', html = '';
    list.forEach((m) => {
      const d = day(m.at);
      if (d !== lastDay) { html += '<div class="day">' + esc(d) + '</div>'; lastDay = d; }
      html += bubble(m, byId);
    });
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
    box.querySelectorAll('[data-re]').forEach((b) => { b.onclick = () => setReply(+b.getAttribute('data-re')); });
    box.querySelectorAll('[data-live]').forEach((b) => { b.onclick = () => { const id = +b.getAttribute('data-live'); ch.liveOpen[id] = !ch.liveOpen[id]; render(false); }; });
    box.querySelectorAll('.live-box.all').forEach((x) => { x.scrollTop = x.scrollHeight; });
    box.querySelectorAll('[data-stop]').forEach((b) => { b.onclick = () => askStop(+b.getAttribute('data-stop')); });
    box.querySelectorAll('[data-done]').forEach((b) => { b.onclick = () => setStatus(+b.getAttribute('data-done'), '완료'); });
    if (scroll || atBottom || !ch.lastTop) box.scrollTop = box.scrollHeight;
    ch.lastTop = 1;
  }
  function setTo(to) {
    ch.to = to;
    document.querySelectorAll('#chTo button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-to') === to));
    $('chBody').placeholder = ch.quick ? '⚡ 빠른 질문: 진행 중인 작업과 따로, 파일을 고치지 않고 바로 답합니다' : to === '모두' ? 'Claude·Codex 모두에게 (Claude → Codex 순서로 답합니다)' : to + '에게 보내기 (Shift+Enter 줄바꿈)';
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
    const path = ME + '/' + new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
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
    const re = ch.replyTo;
    const row = { sender: ME, recipient: ch.to, topic: re && re.topic ? re.topic : '', status: '대기',
      reply_to: re ? re.id : null, body, files, quick: ch.quick, author_email: (s.session.user.email || '').toLowerCase() };
    const { error } = await ch.sb.from('sk_channel').insert(row);
    $('chSend').disabled = false;
    if (error) { alertMsg('보내지 못했습니다: ' + error.message); return; }
    // 나에게 온 대기 글에 답하면 원글은 「답변」
    if (re && MINE(re) && re.status === '대기') await setStatus(re.id, '답변');
    $('chBody').value = ''; grow(); setReply(null); ch.pending = []; showPending(); setQuick(false);
    await load(); render(true);
  }

  window.SonikChannel = {
    // app.js 가 목록 화면을 그릴 때 부른다. 관리자가 아니면 카드를 숨긴다.
    mount(sb, me) {
      ch.sb = sb;
      const ok = me && me.role === 'admin';
      $('chFab').hidden = !ok;
      clearInterval(ch.timer);
      if (!ok) { $('chCard').hidden = true; return; }
      $('chFab').onclick = () => setOpen(!ch.open);
      $('chClose').onclick = () => setOpen(false);
      if (!ch.keyed) { ch.keyed = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ch.open && $('modal').hidden) setOpen(false); }); }
      $('chSend').onclick = send;
      $('chPause').onclick = togglePause;
      $('chSet').onclick = () => { $('chSetBox').hidden = !$('chSetBox').hidden; };
      $('chClaudeModel').onchange = $('chCodexModel').onchange = $('chCodexEffort').onchange = saveModels;
      $('chQuick').onclick = () => setQuick(!ch.quick);
      $('chMine').onclick = () => { ch.onlyMine = !ch.onlyMine; render(true); };
      $('chReplyX').onclick = () => setReply(null);
      document.querySelectorAll('#chTo button').forEach((b) => { b.onclick = () => setTo(b.getAttribute('data-to')); });
      setTo(ch.to);
      $('chBody').oninput = grow;
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
      load();
      // 열려 있으면 10초마다, 닫혀 있으면 30초마다(배지용) 새로 읽는다
      ch.timer = setInterval(() => { ch.tick++; if (!document.hidden && (ch.open || ch.tick % 3 === 0)) load(); }, 10000);
    },
  };
})();
