// 손익추정 웹 — 로그인 · 스냅샷 목록 · 엔진 열기/저장 · 관리자(빈 엔진 올리기, 명단)
(function () {
  const C = window.SONIK_CONFIG, E = window.SonikEngine;
  const sb = window.supabase.createClient(C.url, C.key);
  const $ = (id) => document.getElementById(id);
  const ROLE = { admin: '관리자', writer: '작성자', viewer: '열람자' };
  const st = { user: null, me: null, engine: null, snaps: [], open: null, mounted: null };

  // ── 화면 도우미 ─────────────────────────────────────
  const views = ['vLogin', 'vDenied', 'vList', 'vEngine'];
  function show(v) { views.forEach((x) => { $(x).hidden = x !== v; }); }
  function toast(t, ms) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, ms || 3500); }
  function busy(t) { $('busy').hidden = !t; $('busyText').textContent = t || ''; }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtT = (s) => { const d = new Date(s); return d.toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  function ask(title, bodyHtml) {
    return new Promise((res) => {
      $('mTitle').textContent = title; $('mBody').innerHTML = bodyHtml; $('modal').hidden = false;
      const done = (v) => { $('modal').hidden = true; $('mOk').onclick = $('mCancel').onclick = null; res(v); };
      $('mOk').onclick = () => done(true); $('mCancel').onclick = () => done(false);
    });
  }
  async function log(action, snapshotId, detail) {
    try { await sb.from('sk_log').insert({ email: st.me.email, action, snapshot_id: snapshotId || null, detail: detail || '' }); } catch (_) { /* 기록 실패는 무시 */ }
  }
  const canWrite = () => st.me && (st.me.role === 'admin' || st.me.role === 'writer');

  // ── 로그인 ─────────────────────────────────────────
  async function boot() {
    const { data } = await sb.auth.getSession();
    st.user = data.session ? data.session.user : null;
    if (!st.user) { renderBar(); return show('vLogin'); }
    const email = (st.user.email || '').toLowerCase();
    const { data: me } = await sb.from('sk_members').select('*').eq('email', email).maybeSingle();
    st.me = me;
    renderBar();
    if (!me) { $('deniedEmail').textContent = email; return show('vDenied'); }
    await loadList();
  }
  function renderBar() {
    $('who').textContent = st.user ? (st.user.email + (st.me ? ' · ' + ROLE[st.me.role] : '')) : '';
    $('btnLogout').hidden = !st.user;
    const inEngine = !$('vEngine').hidden;
    $('btnBack').hidden = !inEngine;
    $('btnSave').hidden = !(inEngine && canWrite());
    $('ctx').textContent = inEngine && st.open ? (st.open.base_ym + ' · ' + (st.open.engine_ver || '버전 미상') + ' · ' + (st.open.memo || '')) : '';
  }
  $('btnLogin').onclick = async () => {
    $('loginMsg').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
    if (error) { $('loginMsg').textContent = '로그인 실패: ' + error.message; return; }
    boot();
  };
  $('btnSignup').onclick = async () => {
    $('loginMsg').textContent = '';
    const email = $('email').value.trim(), password = $('pw').value;
    if (!email || password.length < 8) { $('loginMsg').textContent = '이메일과 8자 이상 비밀번호를 입력하세요.'; return; }
    const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    $('loginMsg').textContent = error ? ('가입 실패: ' + error.message) : '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 여기서 로그인하세요.';
  };
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnLogin').click(); });
  $('btnLogout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  // ── 목록 ───────────────────────────────────────────
  async function loadList() {
    unmount();
    show('vList'); renderBar();
    $('lblUpSnap').hidden = !canWrite();
    $('adminCard').hidden = st.me.role !== 'admin';
    const [{ data: eng }, { data: snaps, error }] = await Promise.all([
      sb.from('sk_engines').select('*').eq('is_current', true).maybeSingle(),
      sb.from('sk_snapshots').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    if (error) { toast('목록을 읽지 못했습니다: ' + error.message); return; }
    st.engine = eng; st.snaps = snaps || [];
    $('engineLine').innerHTML = eng
      ? '웹 엔진: <b>' + esc(eng.ver) + '</b> · ' + esc(fmtT(eng.uploaded_at)) + ' 올림'
      : '<span class="tag old">웹 엔진이 아직 없습니다</span> 관리자가 빈 엔진을 올려야 열 수 있습니다.';
    $('snapRows').innerHTML = st.snaps.length ? st.snaps.map((s) => {
      const old = eng && s.engine_ver && s.engine_ver !== eng.ver;
      return '<tr><td><b>' + esc(s.base_ym) + '</b></td><td>' + esc(s.engine_ver || '—') + (old ? ' <span class="tag old">엔진과 다름</span>' : '') + '</td>'
        + '<td><span class="tag ' + s.source + '">' + (s.source === 'pc' ? 'PC 원본' : '웹 저장') + '</span></td>'
        + '<td class="memo">' + esc(s.memo) + '</td><td>' + esc(s.author_name || s.author_email) + '</td><td>' + esc(fmtT(s.created_at)) + '</td>'
        + '<td><button data-open="' + s.id + '"' + (eng ? '' : ' disabled') + '>열기</button>'
        + ' <button data-dl="' + s.id + '">JSON</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="hint">아직 스냅샷이 없습니다.</td></tr>';
    $('snapRows').querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openSnap(b.getAttribute('data-open')); });
    $('snapRows').querySelectorAll('[data-dl]').forEach((b) => { b.onclick = () => downloadSnap(b.getAttribute('data-dl')); });
    if (st.me.role === 'admin') loadMembers();
  }

  async function fetchSnapDb(snap) {
    const { data, error } = await sb.storage.from(C.bucket).download(snap.storage_path);
    if (error) throw new Error('스냅샷을 받지 못했습니다: ' + error.message);
    return JSON.parse(await E.gunzipToText(data));
  }
  async function downloadSnap(id) {
    const s = st.snaps.find((x) => x.id === id); if (!s) return;
    busy('스냅샷 받는 중…');
    try {
      const db = await fetchSnapDb(s);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
      a.download = '손익추정DB_전체_' + s.base_ym + '_' + (s.source === 'pc' ? 'PC' : '웹') + '_' + s.created_at.slice(0, 16).replace(/[-:T]/g, '') + '.json';
      a.click(); URL.revokeObjectURL(a.href);
      log('download', s.id);
    } catch (e) { toast(e.message, 6000); }
    busy(null);
  }

  // ── 스냅샷 올리기(PC 원본 .json) ──────────────────
  async function putSnapshot(db, meta) {
    const id = crypto.randomUUID();
    const path = 'snapshots/' + id + '.json.gz';
    const gz = await E.gzip(JSON.stringify(db));
    const up = await sb.storage.from(C.bucket).upload(path, gz, { contentType: 'application/gzip', upsert: false });
    if (up.error) throw new Error('파일 올리기 실패: ' + up.error.message);
    const row = Object.assign({ id, base_ym: db.baseYm || '', engine_ver: db.sysVer || null, mode: db.mode || 'sonik', scope: 'all',
      author_email: st.me.email, author_name: st.me.name || '', storage_path: path, size_bytes: gz.size }, meta);
    const ins = await sb.from('sk_snapshots').insert(row);
    if (ins.error) { await sb.storage.from(C.bucket).remove([path]); throw new Error('목록 등록 실패: ' + ins.error.message); }
    return id;
  }
  $('upSnap').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    let db;
    try { db = JSON.parse(await f.text()); } catch (e) { toast('JSON을 읽지 못했습니다: ' + e.message); return; }
    const bad = E.checkSnapshot(db); if (bad) { toast(bad, 6000); return; }
    const ok = await ask('PC 파일 올리기', '<p>' + esc(f.name) + '</p><p class="hint">기준월 ' + esc(db.baseYm) + ' · ' + esc(db.author || '') + ' · 시스템 ' + esc(db.sysVer || '버전 표기 없음(v307 이전 내보내기)') + '</p><label>메모<textarea id="memoIn" placeholder="예: 10/29 가마감 반영"></textarea></label>');
    if (!ok) return;
    const memo = ($('memoIn') || {}).value || '';
    busy('올리는 중…');
    try { const id = await putSnapshot(db, { source: 'pc', memo }); log('upload_pc', id, f.name); toast('올렸습니다.'); await loadList(); }
    catch (e) { toast(e.message, 6000); }
    busy(null);
  };

  // ── 엔진 열기 ──────────────────────────────────────
  async function getEngineHtml() {
    const key = 'engine:' + st.engine.ver + ':' + st.engine.sha256;
    if (getEngineHtml.cache && getEngineHtml.cache.key === key) return getEngineHtml.cache.html;
    const { data, error } = await sb.storage.from(C.bucket).download(st.engine.storage_path);
    if (error) throw new Error('엔진을 받지 못했습니다: ' + error.message);
    const html = await E.gunzipToText(data);
    if (st.engine.sha256 && (await E.sha256(html)) !== st.engine.sha256) throw new Error('엔진 파일 해시가 목록과 다릅니다');
    getEngineHtml.cache = { key, html };
    return html;
  }
  function unmount() { if (st.mounted) { st.mounted.dispose(); st.mounted = null; } $('engineBox').innerHTML = ''; st.open = null; }
  async function openSnap(id) {
    const s = st.snaps.find((x) => x.id === id); if (!s || !st.engine) return;
    if (s.engine_ver && s.engine_ver !== st.engine.ver) {
      const go = await ask('엔진 버전이 다릅니다', '<p>이 스냅샷은 <b>' + esc(s.engine_ver) + '</b>에서 만들었고 웹 엔진은 <b>' + esc(st.engine.ver) + '</b>입니다.</p><p class="hint">계산 로직이 바뀐 버전이면 재현검증에서 차이가 표시될 수 있습니다. 열까요?</p>');
      if (!go) return;
    }
    busy('엔진과 스냅샷을 받는 중…');
    try {
      const [html, db] = await Promise.all([getEngineHtml(), fetchSnapDb(s)]);
      show('vEngine'); st.open = s; renderBar();
      busy('엔진 여는 중… (10~30초)');
      st.mounted = await E.mount($('engineBox'), html, onEngineMsg);
      busy('스냅샷 불러오는 중…');
      await new Promise((r) => setTimeout(r, 50));
      const r = st.mounted.bridge.applyDb(db);
      const n = r.verify ? r.verify.diffs.length : null;
      log('open', s.id, n == null ? 'verify 없음' : ('diffs=' + n));
    } catch (e) { toast(e.message, 8000); await loadList(); }
    busy(null);
  }
  function onEngineMsg(m) { if (m.type === 'sonik:save') saveFromEngine(); }
  async function saveFromEngine() {
    if (!st.mounted || !st.open) return;
    if (!canWrite()) { toast('열람 권한이라 저장할 수 없습니다.'); return; }
    const ok = await ask('스냅샷 저장', '<p class="hint">현재 화면의 작업을 새 스냅샷으로 저장합니다. 원래 스냅샷(' + esc(st.open.base_ym) + ', ' + esc(fmtT(st.open.created_at)) + ')은 그대로 남습니다.</p><label>메모<textarea id="memoIn" placeholder="무엇을 바꿨는지"></textarea></label>');
    if (!ok) return;
    const memo = ($('memoIn') || {}).value || '';
    busy('저장하는 중…');
    try {
      const db = st.mounted.bridge.buildDb();
      const id = await putSnapshot(db, { source: 'web', memo, parent_id: st.open.id });
      log('save_web', id, 'parent=' + st.open.id);
      st.open = Object.assign({}, st.open, { id, memo, created_at: new Date().toISOString(), source: 'web', engine_ver: db.sysVer });
      renderBar(); toast('새 스냅샷으로 저장했습니다.');
    } catch (e) { toast(e.message, 8000); }
    busy(null);
  }
  $('btnSave').onclick = saveFromEngine;
  $('btnBack').onclick = async () => {
    if (canWrite() && !(await ask('목록으로', '<p>저장하지 않은 작업은 사라집니다. 목록으로 갈까요?</p>'))) return;
    loadList();
  };
  window.addEventListener('beforeunload', (e) => { if (!$('vEngine').hidden && canWrite()) { e.preventDefault(); e.returnValue = ''; } });

  // ── 관리자: 빈 엔진 올리기 ─────────────────────────
  $('upEngine').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    const html = await f.text();
    const chk = E.checkEmptyEngine(html);
    if (!chk.ok) { toast('올릴 수 없습니다: ' + chk.errs.join(' / '), 8000); return; }
    const ok = await ask('빈 엔진 올리기', '<p>' + esc(f.name) + '</p><p>시스템 버전 <b>' + esc(chk.ver) + '</b> · ' + Math.round(html.length / 1048576 * 10) / 10 + 'MB · 데이터 블록 없음</p><p class="hint">올리면 웹에서 여는 엔진이 이 버전으로 바뀝니다. Codex 「통과」를 받은 버전만 올리세요.</p>');
    if (!ok) return;
    busy('엔진 올리는 중…');
    try {
      const sha = await E.sha256(html), path = 'engines/' + chk.ver + '_' + sha.slice(0, 8) + '.html.gz';
      const up = await sb.storage.from(C.bucket).upload(path, await E.gzip(html), { contentType: 'application/gzip', upsert: true });
      if (up.error) throw new Error(up.error.message);
      let r = await sb.from('sk_engines').update({ is_current: false }).eq('is_current', true);
      if (r.error) throw new Error(r.error.message);
      r = await sb.from('sk_engines').upsert({ ver: chk.ver, storage_path: path, size_bytes: html.length, sha256: sha, is_current: true, uploaded_by: st.me.email, uploaded_at: new Date().toISOString(), note: f.name });
      if (r.error) throw new Error(r.error.message);
      log('upload_engine', null, chk.ver + ' ' + sha.slice(0, 8));
      toast('웹 엔진을 ' + chk.ver + '(으)로 바꿨습니다.'); await loadList();
    } catch (e) { toast('엔진 올리기 실패: ' + e.message, 8000); }
    busy(null);
  };

  // ── 관리자: 명단 ──────────────────────────────────
  async function loadMembers() {
    const { data } = await sb.from('sk_members').select('*').order('created_at');
    $('memRows').innerHTML = (data || []).map((m) => '<tr><td>' + esc(m.email) + '</td><td>' + esc(m.name) + '</td><td>'
      + '<select data-role="' + esc(m.email) + '">' + Object.keys(ROLE).map((k) => '<option value="' + k + '"' + (k === m.role ? ' selected' : '') + '>' + ROLE[k] + '</option>').join('') + '</select></td>'
      + '<td>' + (m.email === st.me.email ? '' : '<button data-del="' + esc(m.email) + '">삭제</button>') + '</td></tr>').join('');
    $('memRows').querySelectorAll('[data-role]').forEach((s) => { s.onchange = async () => {
      if (s.getAttribute('data-role') === st.me.email && s.value !== 'admin') { toast('자기 자신의 관리자 권한은 내릴 수 없습니다.'); s.value = 'admin'; return; }
      const r = await sb.from('sk_members').update({ role: s.value }).eq('email', s.getAttribute('data-role'));
      toast(r.error ? r.error.message : '권한을 바꿨습니다.'); }; });
    $('memRows').querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
      if (!(await ask('명단에서 삭제', '<p>' + esc(b.getAttribute('data-del')) + ' 을(를) 명단에서 뺄까요?</p>'))) return;
      const r = await sb.from('sk_members').delete().eq('email', b.getAttribute('data-del'));
      toast(r.error ? r.error.message : '삭제했습니다.'); loadMembers(); }; });
  }
  $('btnAddMem').onclick = async () => {
    const email = $('mEmail').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('이메일을 확인하세요.'); return; }
    const r = await sb.from('sk_members').insert({ email, name: $('mName').value.trim(), role: $('mRole').value });
    toast(r.error ? r.error.message : '추가했습니다. 그 사람이 같은 이메일로 가입하면 들어올 수 있습니다.');
    $('mEmail').value = $('mName').value = ''; loadMembers();
  };

  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { st.user = st.me = null; } });
  boot();
})();
