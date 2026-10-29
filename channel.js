// 소통 채널 — hong · Codex · Claude 가 주고받는 글(sk_channel). 관리자(hong)와 에이전트 계정만 읽고 쓴다.
// 상태: 대기(받는이가 답해야 함) → 답변 → 완료. 글 내용은 고치지 않고 상태만 바꾼다.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtT = (s) => new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ME = 'hong', MINE = (m) => m.recipient === ME || m.recipient === '모두';
  const ch = { sb: null, rows: [], replyTo: null, timer: null, onlyMine: false };

  async function load() {
    const { data, error } = await ch.sb.from('sk_channel').select('*').order('at', { ascending: false }).limit(150);
    if (error) { $('chRows').innerHTML = '<p class="hint">채널을 읽지 못했습니다: ' + esc(error.message) + '</p>'; return; }
    ch.rows = (data || []).reverse();
    render();
  }
  function render() {
    const byId = new Map(ch.rows.map((m) => [m.id, m]));
    const waiting = ch.rows.filter((m) => MINE(m) && m.status === '대기').length;
    $('chMine').textContent = '나에게 온 대기 ' + waiting;
    $('chMine').classList.toggle('on', ch.onlyMine);
    const list = ch.onlyMine ? ch.rows.filter((m) => MINE(m) && m.status === '대기') : ch.rows;
    $('chRows').innerHTML = list.length ? list.map((m) => {
      const re = m.reply_to && byId.get(m.reply_to);
      return '<div class="ch-msg s-' + esc(m.sender) + (MINE(m) && m.status === '대기' ? ' wait' : '') + '" id="ch' + m.id + '">'
        + '<div class="ch-head"><b>' + esc(m.sender) + '</b> → ' + esc(m.recipient) + (m.topic ? ' · <span class="mono">' + esc(m.topic) + '</span>' : '')
        + ' <span class="tag ch-' + esc(m.status) + '">' + esc(m.status) + '</span> <span class="hint">#' + m.id + ' · ' + esc(fmtT(m.at)) + '</span>'
        + (m.reply_to ? ' <a class="hint" href="#ch' + m.reply_to + '">↩ #' + m.reply_to + (re ? ' ' + esc(re.sender) : '') + '</a>' : '') + '</div>'
        + '<div class="ch-body">' + esc(m.body) + '</div>'
        + '<div class="row ch-act"><button data-re="' + m.id + '">답글</button>'
        + (m.status !== '완료' && m.status !== '안내' ? '<button data-done="' + m.id + '">완료로</button>' : '') + '</div></div>';
    }).join('') : '<p class="hint">' + (ch.onlyMine ? '나에게 온 대기 글이 없습니다.' : '아직 글이 없습니다.') + '</p>';
    $('chRows').querySelectorAll('[data-re]').forEach((b) => { b.onclick = () => setReply(+b.getAttribute('data-re')); });
    $('chRows').querySelectorAll('[data-done]').forEach((b) => { b.onclick = () => setStatus(+b.getAttribute('data-done'), '완료'); });
    if (!ch.onlyMine) $('chRows').scrollTop = $('chRows').scrollHeight;
  }
  function setReply(id) {
    const m = ch.rows.find((x) => x.id === id);
    ch.replyTo = m || null;
    $('chReply').hidden = !m;
    if (m) {
      $('chReplyTxt').textContent = '↩ #' + m.id + ' ' + m.sender + ': ' + m.body.slice(0, 60);
      if (m.sender !== ME) $('chTo').value = m.sender;
      if (m.topic) $('chTopic').value = m.topic;
      $('chBody').focus();
    }
  }
  async function setStatus(id, status) {
    const { error } = await ch.sb.from('sk_channel').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alertMsg('상태를 바꾸지 못했습니다: ' + error.message); return; }
    await load();
  }
  function alertMsg(t) { $('chMsg').textContent = t; }
  async function send() {
    const body = $('chBody').value.trim();
    if (!body) { alertMsg('내용을 쓰세요.'); return; }
    alertMsg('');
    const { data: s } = await ch.sb.auth.getSession();
    const row = { sender: ME, recipient: $('chTo').value, topic: $('chTopic').value.trim(), status: $('chKind').value,
      reply_to: ch.replyTo ? ch.replyTo.id : null, body, author_email: (s.session.user.email || '').toLowerCase() };
    $('chSend').disabled = true;
    const { error } = await ch.sb.from('sk_channel').insert(row);
    $('chSend').disabled = false;
    if (error) { alertMsg('보내지 못했습니다: ' + error.message); return; }
    // 나에게 온 대기 글에 답하면 원글은 「답변」
    if (ch.replyTo && MINE(ch.replyTo) && ch.replyTo.status === '대기') await setStatus(ch.replyTo.id, '답변');
    $('chBody').value = ''; setReply(null);
    await load();
  }

  window.SonikChannel = {
    // app.js 가 목록 화면을 그릴 때 부른다. 관리자가 아니면 카드를 숨긴다.
    mount(sb, me) {
      ch.sb = sb;
      const ok = me && me.role === 'admin';
      $('chCard').hidden = !ok;
      clearInterval(ch.timer);
      if (!ok) return;
      $('chSend').onclick = send;
      $('chReload').onclick = load;
      $('chMine').onclick = () => { ch.onlyMine = !ch.onlyMine; render(); };
      $('chReplyX').onclick = () => setReply(null);
      $('chBody').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); };
      load();
      // 목록 화면이 보이는 동안 1분마다 새로 읽는다
      ch.timer = setInterval(() => { if (!$('vList').hidden && !document.hidden) load(); }, 60000);
    },
  };
})();
