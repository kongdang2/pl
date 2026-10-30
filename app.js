// 손익추정 웹 — 로그인 · 스냅샷 목록 · 엔진 열기/저장 · 관리자(빈 엔진 올리기, 명단)
(function () {
  const C = window.SONIK_CONFIG, E = window.SonikEngine;
  // 만료된 확인 메일 링크 등으로 주소 끝에 #error=… 가 남아 있으면, supabase-js 가 새로고침할 때마다
  // 저장된 로그인을 지운다. 클라이언트를 만들기 전에 그런 주소 조각을 걷어낸다.
  if (/(^#|&)error(_code)?=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
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
  // 웹 시험판(vNNN-n)과 오프라인(vNNN)은 같은 계산이므로 -n을 떼고 비교
  const sameBase = (v) => String(v || '').replace(/-\d+$/, '');
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
  // 덮어쓸 수 있는 스냅샷 = 내가 웹에서 저장한 것(PC 원본·남의 것·백업본은 첫 저장 때 새 스냅샷)
  const isOwnWeb = (s) => s && !s.backupOf && s.source === 'web' && s.author_email === (st.me && st.me.email);

  // ── 로그인 ─────────────────────────────────────────
  async function boot() {
    const { data } = await sb.auth.getSession();
    // 확인 메일로 들어온 #access_token=… 은 한 번 쓰고 나면 주소에서 지운다(새로고침·공유 때 다시 쓰이지 않게)
    if (/access_token=|refresh_token=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
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
    $('btnSave').hidden = $('btnSaveNew').hidden = !(inEngine && canWrite());
    $('btnReq').hidden = !inEngine;
    $('btnOffline').hidden = !inEngine;
    $('btnZoom').hidden = !inEngine;
    $('ctx').textContent = inEngine && st.open ? (st.open.base_ym + ' · ' + (st.open.engine_ver || '버전 미상') + ' · ' + (st.open.memo || '') + (st.open.backupOf ? ' · 백업본' : isOwnWeb(st.open) ? ' · 저장하면 이 스냅샷에 덮어씀' : ' · 첫 저장은 새 스냅샷')) : '';
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
      sb.from('sk_snapshots').select('*').order('updated_at', { ascending: false }).limit(200),
    ]);
    if (error) { toast('목록을 읽지 못했습니다: ' + error.message); return; }
    st.engine = eng; st.snaps = snaps || [];
    $('engineLine').innerHTML = eng
      ? '웹 엔진: <b>' + esc(eng.ver) + '</b> · ' + esc(fmtT(eng.uploaded_at)) + ' 올림'
      : '<span class="tag old">웹 엔진이 아직 없습니다</span> 관리자가 빈 엔진을 올려야 열 수 있습니다.';
    $('snapRows').innerHTML = st.snaps.length ? st.snaps.map((s) => {
      const old = eng && s.engine_ver && sameBase(s.engine_ver) !== sameBase(eng.ver);
      return '<tr><td><b>' + esc(s.base_ym) + '</b></td><td>' + esc(s.engine_ver || '—') + (old ? ' <span class="tag old">엔진과 다름</span>' : '') + '</td>'
        + '<td><span class="tag ' + s.source + '">' + (s.source === 'pc' ? 'PC 원본' : '웹 저장') + '</span></td>'
        + '<td class="memo">' + esc(s.memo) + '</td><td>' + esc(s.author_name || s.author_email) + '</td><td>' + esc(fmtT(s.updated_at || s.created_at)) + (s.rev > 1 ? ' <span class="hint">(' + s.rev + '회 저장)</span>' : '') + '</td>'
        + '<td><button data-open="' + s.id + '"' + (eng ? '' : ' disabled') + '>열기</button>'
        + ' <button data-dl="' + s.id + '" title="DB 내보내기 ▸ 전체와 같은 .json (PC에서 DB 불러오기)">JSON</button>'
        + ' <button data-html="' + s.id + '"' + (eng ? '' : ' disabled') + ' title="웹 엔진 + 이 스냅샷을 합친 HTML 한 파일. PC에서 바로 열립니다">오프라인 파일</button>' + (s.rev > 1 ? ' <button data-bk="' + s.id + '">이전 저장</button>' : '')
        + (st.me.role === 'admin' ? ' <button data-del="' + s.id + '" class="danger">삭제</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="hint">아직 스냅샷이 없습니다.</td></tr>';
    $('snapRows').querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openSnap(b.getAttribute('data-open')); });
    $('snapRows').querySelectorAll('[data-dl]').forEach((b) => { b.onclick = () => downloadSnap(b.getAttribute('data-dl')); });
    $('snapRows').querySelectorAll('[data-html]').forEach((b) => { b.onclick = () => offlineFromList(b.getAttribute('data-html')); });
    $('btnEngDl').disabled = !eng;
    $('snapRows').querySelectorAll('[data-bk]').forEach((b) => { b.onclick = () => showBackups(b.getAttribute('data-bk')); });
    $('snapRows').querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteSnap(b.getAttribute('data-del')); });
    if (st.me.role === 'admin') loadMembers();
    loadRequests();
    if (window.SonikChannel) window.SonikChannel.mount(sb, st.me);
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
      a.download = '손익추정DB_전체_' + s.base_ym + '_' + (s.source === 'pc' ? 'PC' : '웹') + '_' + (s.updated_at || s.created_at).slice(0, 16).replace(/[-:T]/g, '') + '.json';
      a.click(); URL.revokeObjectURL(a.href);
      log('download', s.id);
    } catch (e) { toast(e.message, 6000); }
    busy(null);
  }

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); };
  // 빈 엔진(데이터 없음) 받기 — 웹에 올라간 그대로
  async function downloadEngine() {
    if (!st.engine) return;
    busy('빈 엔진 받는 중…');
    try {
      const html = await getEngineHtml();
      saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), '손익추정_빈엔진_' + st.engine.ver + '.html');
      log('download_engine', null, st.engine.ver);
    } catch (e) { toast(e.message, 6000); }
    busy(null);
  }
  // 오프라인 파일: 열린 엔진이 자기 자신을 데이터째 HTML 로 만든다(엔진의 「HTML 저장」과 같은 함수, 빈 엔진 표시는 빠짐).
  // 결과는 PC 에서 그냥 열면 되는 손익추정 파일(웹 시험판 엔진 vNNN-n + 이 스냅샷 데이터).
  function offlineHtml(win) {
    if (typeof win.__buildEngineHtml !== 'function') throw new Error('이 엔진은 HTML 만들기 기능이 없습니다');
    try { if (typeof win.commitActiveEditBeforeSave === 'function') win.commitActiveEditBeforeSave(); } catch (_) { /* 무시 */ }
    const html = win.__buildEngineHtml({ embedData: true, emptyEngine: false, stripAdminBar: false });
    if (!/id=["']__SAVED_DATA__["']/.test(html)) throw new Error('데이터를 넣지 못했습니다');
    return html;
  }
  const offlineName = (s, ver) => '손익추정_웹받음_' + (ver || 'v') + '_' + (s.base_ym || '') + '_' + stamp() + '.html';
  async function downloadOffline() {
    if (!st.mounted || !st.open) return;
    busy('오프라인 파일 만드는 중…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const html = offlineHtml(st.mounted.win);
      saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), offlineName(st.open, st.engine && st.engine.ver));
      log('download_html', st.open.backupOf || st.open.id, '열린 화면(저장 안 한 작업 포함)');
      toast('오프라인 파일을 받았습니다. 저장하지 않은 작업도 들어 있습니다.', 5000);
    } catch (e) { toast(e.message, 8000); }
    busy(null);
  }
  // 목록에서 바로: 화면 밖에서 엔진을 열어 스냅샷을 넣고 HTML 로 만든 뒤 닫는다
  async function offlineFromList(id) {
    const s = st.snaps.find((x) => x.id === id); if (!s || !st.engine) return;
    const box = document.createElement('div');
    box.className = 'offscreen-engine';
    document.body.appendChild(box);
    let m = null;
    busy('엔진과 스냅샷을 받는 중…');
    try {
      const [html, db] = await Promise.all([getEngineHtml(), fetchSnapDb(s)]);
      busy('오프라인 파일 만드는 중… (10~30초)');
      m = await E.mount(box, html, () => {});
      m.bridge.applyDb(db);
      await new Promise((r) => setTimeout(r, 300));
      saveBlob(new Blob([offlineHtml(m.win)], { type: 'text/html;charset=utf-8' }), offlineName(s, st.engine.ver));
      log('download_html', s.id, '목록');
    } catch (e) { toast(e.message, 8000); }
    finally { if (m) m.dispose(); box.remove(); busy(null); }
  }

  // ── 스냅샷 올리기(PC 원본 .json) ──────────────────
  async function putSnapshot(db, meta) {
    const id = crypto.randomUUID();
    // 웹 저장본은 snapshots/<id>/ 아래(덮어쓸 때 옛 백업을 작성자가 정리), PC 원본은 snapshots/<id>.json.gz(관리자만 삭제)
    const path = meta.source === 'web' ? 'snapshots/' + id + '/r1.json.gz' : 'snapshots/' + id + '.json.gz';
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
    const ok = await ask('PC 파일 올리기', '<p>' + esc(f.name) + '</p><p class="hint">기준월 ' + esc(db.baseYm) + ' · ' + esc(db.author || '') + ' · 시스템 ' + esc(db.sysVer || '버전 표기 없음(오프라인 v307 이하 내보내기)') + '</p><label>메모<textarea id="memoIn" placeholder="예: 10/29 가마감 반영"></textarea></label>');
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
  function unmount() { rqClose(true); if (st.mounted) { st.mounted.dispose(); st.mounted = null; } $('engineBox').innerHTML = ''; st.open = null; }
  // 스냅샷 삭제(관리자만): 저장 파일·이전 저장(백업)까지 지운다. 되돌릴 수 없다
  async function deleteSnap(id) {
    const s = st.snaps.find((x) => x.id === id); if (!s) return;
    const go = await ask('스냅샷 삭제', '<p><b>' + esc(s.base_ym) + ' · ' + esc(s.memo || '') + '</b> (' + (s.source === 'pc' ? 'PC 원본' : '웹 저장') + ', ' + esc(s.author_name || s.author_email) + ')</p>'
      + '<p>이 스냅샷과 이전 저장(백업) ' + Math.max(0, (s.rev || 1) - 1) + '개까지 지웁니다. <b>되돌릴 수 없습니다.</b></p><p class="hint">PC 원본 파일은 PC에 그대로 있습니다. 이 스냅샷으로 접수한 수정요청은 남고 스냅샷 연결만 빠집니다.</p>');
    if (!go) return;
    busy('삭제 중…');
    try {
      const paths = new Set([s.storage_path]);
      const { data: revs } = await sb.from('sk_snapshot_revs').select('storage_path').eq('snapshot_id', id);
      (revs || []).forEach((r) => paths.add(r.storage_path));
      const { data: inDir } = await sb.storage.from('sonik').list('snapshots/' + id, { limit: 1000 });
      (inDir || []).forEach((f) => paths.add('snapshots/' + id + '/' + f.name));
      // 이 스냅샷에서 갈라져 나온 스냅샷은 남기고 연결만 끊는다
      let r = await sb.from('sk_snapshots').update({ parent_id: null }).eq('parent_id', id);
      if (r.error) throw r.error;
      r = await sb.from('sk_snapshots').delete().eq('id', id);
      if (r.error) throw r.error;
      const rm = await sb.storage.from('sonik').remove(Array.from(paths).filter(Boolean));
      if (rm.error) toast('스냅샷은 지웠지만 저장 파일 일부를 지우지 못했습니다: ' + rm.error.message, 7000);
      else toast('스냅샷을 삭제했습니다.');
      log('delete', null, id + ' ' + s.base_ym + ' ' + (s.memo || '') + ' files=' + paths.size);
    } catch (e) { toast('삭제하지 못했습니다: ' + (e.message || e), 7000); }
    busy(null);
    await loadList();
  }
  async function openSnap(id, backup) {
    const s0 = st.snaps.find((x) => x.id === id); if (!s0 || !st.engine) return;
    const s = backup ? Object.assign({}, s0, { storage_path: backup.storage_path, backupOf: s0.id, memo: s0.memo + ' (' + backup.rev + '번째 저장)', updated_at: backup.saved_at }) : s0;
    if (s.engine_ver && sameBase(s.engine_ver) !== sameBase(st.engine.ver)) {
      const go = await ask('엔진 버전이 다릅니다', '<p>이 스냅샷은 <b>' + esc(s.engine_ver) + '</b>에서 만들었고 웹 엔진은 <b>' + esc(st.engine.ver) + '</b>입니다.</p><p class="hint">계산 로직이 바뀐 버전이면 재현검증에서 차이가 표시될 수 있습니다. 열까요?</p>');
      if (!go) return;
    }
    busy('엔진과 스냅샷을 받는 중…');
    try {
      const [html, db] = await Promise.all([getEngineHtml(), fetchSnapDb(s)]);
      show('vEngine'); st.open = s; renderBar(); fitEngine();
      busy('엔진 여는 중… (10~30초)');
      st.mounted = await E.mount($('engineBox'), html, onEngineMsg);
      busy('스냅샷 불러오는 중…');
      await new Promise((r) => setTimeout(r, 50));
      const r = st.mounted.bridge.applyDb(db);
      const n = r.verify ? r.verify.diffs.length : null;
      log('open', s.id, (backup ? 'rev=' + backup.rev + ' ' : '') + (n == null ? 'verify 없음' : ('diffs=' + n)));
    } catch (e) { toast(e.message, 8000); await loadList(); }
    busy(null);
  }
  // ── 휴대폰 보기 ─────────────────────────────────
  // 엔진은 PC 화면 폭(1280px)으로 그린다. 좁은 화면에서는 폭에 맞춰 줄여 보거나(맞춤), 더 크게 키워 옆으로 밀어 본다(확대 60%·100%).
  const ENGINE_W = 1280, ZOOMS = [0, 0.6, 1]; // 0 = 화면 폭 맞춤
  st.zoom = 0;
  function fitEngine() {
    document.documentElement.style.setProperty('--barh', $('bar').offsetHeight + 'px');
    const box = $('engineBox'), f = box.querySelector('iframe');
    const narrow = window.innerWidth < 900, z = ZOOMS[st.zoom];
    box.classList.toggle('mob', narrow); box.classList.toggle('z1', narrow && z > 0);
    $('btnZoom').textContent = st.zoom === ZOOMS.length - 1 ? '🔍 맞춤' : st.zoom ? '🔍 더 확대' : '🔍 확대';
    if (!f) return;
    if (!narrow) { f.removeAttribute('style'); return; }
    const k = z || box.clientWidth / ENGINE_W;
    f.style.cssText = 'width:' + ENGINE_W + 'px;height:' + Math.floor(box.clientHeight / k) + 'px;zoom:' + k; // zoom은 배치 크기도 줄여 옆 스크롤이 실제 폭만큼만 생긴다
  }
  $('btnZoom').onclick = () => { st.zoom = (st.zoom + 1) % ZOOMS.length; fitEngine(); };
  new MutationObserver(fitEngine).observe($('engineBox'), { childList: true });
  window.addEventListener('resize', fitEngine);
  new MutationObserver(fitEngine).observe($('rqPanel'), { attributes: true, attributeFilter: ['hidden'] });
  // 좁은 화면에서 표는 줄마다 카드처럼 쌓는다: 칸마다 머리글 이름(data-l)을 달아 둔다
  function labelGrid(tb) {
    const heads = Array.from(tb.closest('table').querySelectorAll('thead th')).map((th) => th.textContent.trim());
    Array.from(tb.rows).forEach((tr) => Array.from(tr.cells).forEach((td, i) => { if (td.colSpan === 1 && heads[i]) td.setAttribute('data-l', heads[i]); }));
  }
  document.querySelectorAll('table.grid tbody').forEach((tb) => { new MutationObserver(() => labelGrid(tb)).observe(tb, { childList: true }); labelGrid(tb); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  function onEngineMsg(m) { if (m.type === 'sonik:save') saveFromEngine(false); }
  // 저장: 내 웹 스냅샷이면 덮어쓰기(직전 3개는 숨은 백업으로 남음), 아니면 첫 저장만 새 스냅샷. asNew = 「새 버전으로 저장」
  async function saveFromEngine(asNew) {
    if (!st.mounted || !st.open || saveFromEngine.busy) return;
    if (!canWrite()) { toast('열람 권한이라 저장할 수 없습니다.'); return; }
    let memo = null;
    if (asNew || !isOwnWeb(st.open)) {
      const why = asNew ? '현재 작업을 새 스냅샷으로 따로 남깁니다.' : (st.open.backupOf ? '백업본을 열었으므로' : st.open.source === 'pc' ? 'PC 원본을 열었으므로' : '다른 사람의 스냅샷이므로') + ' 첫 저장은 새 스냅샷으로 만들고, 그다음 저장부터는 거기에 덮어씁니다.';
      const ok = await ask(asNew ? '새 버전으로 저장' : '저장', '<p class="hint">' + esc(why) + ' 원래 스냅샷(' + esc(st.open.base_ym) + ', ' + esc(fmtT(st.open.updated_at || st.open.created_at)) + ')은 그대로 남습니다.</p><label>메모<textarea id="memoIn" placeholder="예: 10/29 가마감 반영"></textarea></label>');
      if (!ok) return;
      memo = ($('memoIn') || {}).value || '';
    }
    saveFromEngine.busy = true; busy('저장하는 중…');
    try {
      const db = st.mounted.bridge.buildDb();
      if (memo === null) {
        const s = st.open, path = 'snapshots/' + s.id + '/r' + (s.rev + 1) + '_' + crypto.randomUUID().slice(0, 8) + '.json.gz';
        const gz = await E.gzip(JSON.stringify(db));
        const up = await sb.storage.from(C.bucket).upload(path, gz, { contentType: 'application/gzip', upsert: false });
        if (up.error) throw new Error('파일 올리기 실패: ' + up.error.message);
        const r = await sb.rpc('sk_overwrite_snapshot', { p_id: s.id, p_expected_rev: s.rev, p_path: path, p_size: gz.size, p_engine_ver: db.sysVer || null });
        if (r.error) {
          await sb.storage.from(C.bucket).remove([path]);
          if (/CONFLICT/.test(r.error.message)) { toast('다른 창이나 다른 사람이 그사이 이 스냅샷을 저장했습니다. 덮어쓰지 않았으니 「새 버전으로 저장」을 쓰세요.', 9000); return; }
          throw new Error('저장 실패: ' + r.error.message);
        }
        if (r.data && r.data.prune && r.data.prune.length) await sb.storage.from(C.bucket).remove(r.data.prune);
        st.open = Object.assign({}, s, { rev: r.data.rev, storage_path: path, size_bytes: gz.size, updated_at: new Date().toISOString(), engine_ver: db.sysVer || s.engine_ver });
        log('save_web', s.id, 'rev=' + r.data.rev);
        toast('저장했습니다.');
      } else {
        const parent = st.open.backupOf || st.open.id;
        const id = await putSnapshot(db, { source: 'web', memo, parent_id: parent });
        log('save_web_new', id, 'parent=' + parent);
        const now = new Date().toISOString();
        st.open = Object.assign({}, st.open, { id, memo, rev: 1, created_at: now, updated_at: now, source: 'web', author_email: st.me.email, author_name: st.me.name || '', engine_ver: db.sysVer, backupOf: null });
        toast('새 스냅샷으로 저장했습니다. 다음 저장부터는 여기에 덮어씁니다.', 5000);
      }
      renderBar();
    } catch (e) { toast(e.message, 8000); }
    finally { saveFromEngine.busy = false; busy(null); }
  }
  $('btnSave').onclick = () => saveFromEngine(false);
  $('btnSaveNew').onclick = () => saveFromEngine(true);
  $('btnOffline').onclick = downloadOffline;
  $('btnEngDl').onclick = downloadEngine;

  // 이전 저장(숨은 백업 최대 3개) — 열면 백업본으로 열리고, 저장하면 새 스냅샷이 된다
  async function showBackups(id) {
    const s = st.snaps.find((x) => x.id === id); if (!s) return;
    const { data, error } = await sb.from('sk_snapshot_revs').select('*').eq('snapshot_id', id).order('rev', { ascending: false });
    if (error) { toast(error.message); return; }
    if (!data || !data.length) { toast('남아 있는 이전 저장이 없습니다.'); return; }
    const pick = await new Promise((res) => {
      ask('이전 저장 — ' + s.base_ym + ' ' + (s.memo || ''), '<p class="hint">덮어쓰기 전 내용을 최근 3개까지 남겨 둡니다. 열어서 저장하면 새 스냅샷으로 저장됩니다.</p><table class="grid"><tbody>'
        + data.map((b) => '<tr><td>' + b.rev + '번째 저장</td><td>' + esc(fmtT(b.saved_at)) + '</td><td><button data-rev="' + b.rev + '">열기</button></td></tr>').join('') + '</tbody></table>').then(() => res(null));
      $('mBody').querySelectorAll('[data-rev]').forEach((btn) => { btn.onclick = () => { $('mOk').click(); res(data.find((b) => String(b.rev) === btn.getAttribute('data-rev'))); }; });
    });
    if (pick) openSnap(id, pick);
  }
  $('btnBack').onclick = async () => {
    const draft = RQ.items.length ? ' 접수하지 않은 수정요청 항목 ' + RQ.items.length + '개도 사라집니다.' : '';
    if ((canWrite() || draft) && !(await ask('목록으로', '<p>저장하지 않은 작업은 사라집니다.' + draft + ' 목록으로 갈까요?</p>'))) return;
    loadList();
  };
  window.addEventListener('beforeunload', (e) => { if (!$('vEngine').hidden && canWrite()) { e.preventDefault(); e.returnValue = ''; } });

  // ── 수정요청 모드 ─────────────────────────────────
  const RQ = window.SonikRequest.create({ onChange: () => renderRqCur() });
  const RQK = window.SonikRequest;
  function rqOpen() {
    if (!st.mounted) return;
    $('rqPanel').hidden = false; RQ.start(st.mounted.win); setRqMode('cell'); renderRqItems();
  }
  function rqClose(discard) {
    if (RQ.on) RQ.stop();
    $('rqPanel').hidden = true;
    if (discard) { RQ.reset(); $('rqTitle').value = $('rqBody').value = ''; $('rqKind').value = '기타'; renderRqItems(); }
  }
  $('btnReq').onclick = () => { if ($('rqPanel').hidden) rqOpen(); else rqClose(false); };
  $('rqClose').onclick = () => rqClose(false);
  const RQ_HINT = {
    cell: '표의 셀을 <b>클릭</b>하거나 <b>끌어서</b> 고르세요. Shift+클릭 범위, Ctrl+클릭 추가·빼기, Esc 선택 해제. 메뉴·탭은 그대로 옮겨 다닐 수 있습니다.',
    area: '셀로 고를 수 없는 곳(그래프·카드·안내문 등)은 화면을 <b>끌어서 사각형</b>으로 지정하세요. 이 동안에는 메뉴가 눌리지 않으니, 메뉴를 옮기려면 「셀 고르기」로 돌아가세요.',
  };
  function setRqMode(m) {
    RQ.setMode(m);
    $('rqMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === RQ.mode));
    $('rqHint').innerHTML = RQ_HINT[RQ.mode]; renderRqCur();
  }
  $('rqMode').querySelectorAll('button').forEach((b) => { b.onclick = () => setRqMode(b.getAttribute('data-m')); });
  const textsHtml = (t) => (t && t.length ? '<ul class="rq-texts">' + t.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');
  function renderRqCur() {
    const box = $('rqCur');
    if (RQ.on && RQ.mode === 'area') {
      const a = RQ.currentArea();
      if (!a) { box.innerHTML = '<span class="hint">지정한 영역이 없습니다. 화면에서 끌어 사각형을 그리세요.</span>'; return; }
      const note = ($('rqItemNote') || {}).value || '';
      box.innerHTML = '<div class="loc">' + esc(RQK.locText(a.loc)) + '</div>'
        + (a.busy ? '<p class="hint">캡처 중…</p>' : a.image ? '<img src="' + a.image + '" alt="영역 캡처">' : '<p class="hint">캡처 실패: ' + esc(a.imageError || '') + '</p>')
        + (a.texts.length ? '<div class="hint">영역 안 글자 ' + a.texts.length + '줄</div>' + textsHtml(a.texts) : '')
        + '<textarea id="rqItemNote" placeholder="이 영역에 대한 설명(무엇이 어떻게 되어야 하는지)"></textarea>'
        + '<div class="row"><button id="rqTake" class="pri"' + (a.busy ? ' disabled' : '') + '>이 영역 담기</button><button id="rqClear">다시 지정</button></div>';
      $('rqItemNote').value = note;
      $('rqTake').onclick = rqTake; $('rqClear').onclick = () => RQ.clearSel();
      return;
    }
    const cur = RQ.on ? RQ.current() : null;
    if (!cur) { box.innerHTML = '<span class="hint">고른 셀이 없습니다.</span>'; return; }
    const many = cur.cells.length > 20;
    box.innerHTML = '<div class="loc">' + esc(RQK.locText(cur.loc)) + '</div>'
      + (many ? '<p>' + cur.cells.length + '개 셀 (' + esc(cur.cells[0].row) + ' ~ ' + esc(cur.cells[cur.cells.length - 1].row) + ')</p>'
        : '<table class="rq-cells">' + cur.cells.map((c, i) => '<tr><td>' + esc(c.row || ('행 ' + (c.r + 1))) + '<br><span class="hint">' + esc(c.col || ('열 ' + (c.c + 1))) + '</span></td><td class="v">' + esc(c.value) + '</td><td><input data-note="' + i + '" placeholder="기대값·메모"></td></tr>').join('') + '</table>')
      + '<textarea id="rqItemNote" placeholder="이 부분에 대한 설명(선택)"></textarea>'
      + '<div class="row"><button id="rqTake" class="pri">이 부분 담기</button><button id="rqClear">선택 해제</button></div>';
    $('rqTake').onclick = rqTake; $('rqClear').onclick = () => RQ.clearSel();
  }
  async function rqTake() {
    const notes = Array.from($('rqCur').querySelectorAll('[data-note]')).map((x) => x.value.trim());
    const itemNote = ($('rqItemNote') || {}).value || '';
    busy('화면 캡처 중…');
    try { const it = await RQ.take(notes, itemNote.trim()); if (it.imageError) toast('캡처는 실패했고 표 내용만 담았습니다: ' + it.imageError, 6000); }
    catch (e) { toast(e.message, 6000); }
    busy(null); renderRqItems();
    if (!$('rqTitle').value && RQ.items[0]) { const L = RQ.items[0].loc; $('rqTitle').value = [L.menu, L.table].filter(Boolean).join(' · ').slice(0, 60); }
  }
  function itemHtml(it, i, removable) {
    const notes = (it.cells || []).filter((c) => c.note).map((c) => '<li>' + esc(c.row) + ' / ' + esc(c.col) + ': <b>' + esc(c.value) + '</b> → ' + esc(c.note) + '</li>').join('');
    return '<div class="rq-item"><div class="row between"><b>항목 ' + (i + 1) + '</b>' + (removable ? '<button data-rm="' + i + '">빼기</button>' : '') + '</div>'
      + '<div class="loc">' + esc(RQK.locText(it.loc || {})) + (it.kind === 'area' ? ' · 영역 지정' : ' · 셀 ' + (it.cells || []).length + '개') + '</div>'
      + (notes ? '<ul>' + notes + '</ul>' : '') + (it.note ? '<p>' + esc(it.note) + '</p>' : '')
      + (!removable && it.kind === 'area' ? textsHtml(it.texts) : '')
      + (it.image ? '<img src="' + it.image + '" alt="화면 캡처">' : '') + '</div>';
  }
  function renderRqItems() {
    $('rqCount').textContent = RQ.items.length ? RQ.items.length + '개' : '';
    $('rqItems').innerHTML = RQ.items.length ? RQ.items.map((it, i) => itemHtml(it, i, true)).join('') : '<p class="hint">셀을 고르거나 영역을 끌어 지정한 뒤 「담기」를 누르면 여기에 쌓입니다. 여러 메뉴에서 담을 수 있습니다.</p>';
    $('rqItems').querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { RQ.remove(+b.getAttribute('data-rm')); renderRqItems(); }; });
  }
  function rqDraft() {
    const s = st.open || {};
    return { title: $('rqTitle').value.trim(), kind: $('rqKind').value, body: $('rqBody').value.trim(), items: RQ.items,
      snapshot_id: s.backupOf || s.id || null, base_ym: s.base_ym || null, engine_ver: st.engine ? st.engine.ver : null,
      author_email: st.me.email, author_name: st.me.name || '', created_at: new Date().toISOString() };
  }
  async function downloadXlsx(req) {
    busy('엑셀 만드는 중…');
    try {
      const blob = await RQK.toXlsx(req);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = '수정요청_' + (req.id ? '#' + req.id + '_' : '') + (req.title || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40) + '.xlsx';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast('엑셀을 만들지 못했습니다: ' + e.message, 7000); }
    busy(null);
  }
  $('rqXlsx').onclick = () => { if (!RQ.items.length) { toast('담은 항목이 없습니다.'); return; } downloadXlsx(rqDraft()); };
  $('rqSubmit').onclick = async () => {
    const d = rqDraft();
    if (!d.items.length && !d.body) { toast('셀을 하나 이상 담거나 설명을 적어 주세요.'); return; }
    if (!d.title) { toast('제목을 적어 주세요.'); $('rqTitle').focus(); return; }
    busy('접수하는 중…');
    try {
      const { data, error } = await sb.from('sk_requests').insert({ title: d.title, kind: d.kind, body: d.body, items: d.items, snapshot_id: d.snapshot_id,
        base_ym: d.base_ym, engine_ver: d.engine_ver, author_email: d.author_email, author_name: d.author_name }).select('id').single();
      if (error) throw new Error(error.message);
      log('request', d.snapshot_id, '#' + data.id);
      RQ.reset(); $('rqTitle').value = $('rqBody').value = ''; $('rqKind').value = '기타'; renderRqItems();
      toast('수정요청 #' + data.id + '을(를) 접수했습니다. 💬 소통으로 Claude에게 넘겼습니다.', 6000);
    } catch (e) { toast('접수 실패: ' + e.message, 8000); }
    busy(null);
  };

  // 요청 목록·보기
  // 진행 단계는 사람이 고르지 않는다: Claude가 처리하면서 stage·progress(답변 기록)를 갱신한다
  const STAGES = ['접수', '검토', '수정', '검증', '반영'];
  function stageBar(r, withText) {
    const held = r.status === '보류', n = held ? -1 : Math.max(0, Math.min(4, r.stage || 0));
    const last = (r.progress || [])[(r.progress || []).length - 1];
    return '<div class="stg' + (held ? ' held' : '') + (n === 4 ? ' done' : '') + '" title="' + esc(held ? '보류' : STAGES[n]) + '">'
      + '<div class="bar">' + STAGES.map((s, i) => '<span class="' + (i <= n ? 'on' : '') + (i === n ? ' cur' : '') + '">' + s + '</span>').join('') + '</div>'
      + (withText && last ? '<div class="say">' + esc(last.text).slice(0, 80) + '</div>' : held ? '<div class="say">보류</div>' : '') + '</div>';
  }
  async function loadRequests() {
    const { data, error } = await sb.from('sk_requests').select('id,title,kind,status,stage,progress,author_name,author_email,created_at').order('created_at', { ascending: false }).limit(100);
    if (error) { $('rqRows').innerHTML = '<tr><td colspan="7" class="hint">요청 목록을 읽지 못했습니다: ' + esc(error.message) + '</td></tr>'; return; }
    $('rqRows').innerHTML = (data || []).length ? data.map((r) => '<tr><td>#' + r.id + '</td><td class="memo">' + esc(r.title) + '</td><td>' + esc(r.kind) + '</td><td>' + stageBar(r, true) + '</td><td>'
      + esc(r.author_name || r.author_email) + '</td><td>' + esc(fmtT(r.created_at)) + '</td><td><button data-rv="' + r.id + '">보기</button></td></tr>').join('')
      : '<tr><td colspan="7" class="hint">아직 접수된 요청이 없습니다.</td></tr>';
    $('rqRows').querySelectorAll('[data-rv]').forEach((b) => { b.onclick = () => viewRequest(+b.getAttribute('data-rv')); });
  }
  function excerptHtml(ex) {
    if (!ex || !ex.rows || !ex.rows.length) return '';
    const sel = new Set((ex.sel || []).map((x) => x[0] + ',' + x[1]));
    return '<div style="overflow-x:auto"><table class="ex">' + ex.rows.map((row, i) => '<tr' + (i < (ex.head || 0) ? ' class="h"' : '') + '>' + row.map((v, j) => '<td' + (sel.has(i + ',' + j) ? ' class="sel"' : '') + '>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</table></div>';
  }
  async function viewRequest(id) {
    busy('요청 읽는 중…');
    const { data: r, error } = await sb.from('sk_requests').select('*').eq('id', id).single();
    busy(null);
    if (error) { toast(error.message); return; }
    $('rvBody').innerHTML = '<h3>수정요청 #' + r.id + ' · ' + esc(r.title) + '</h3>'
      + '<p class="hint">' + esc(r.kind) + ' · ' + esc(r.author_name || r.author_email) + ' · ' + esc(fmtT(r.created_at)) + ' · 스냅샷 ' + esc(r.base_ym || '') + ' / 엔진 ' + esc(r.engine_ver || '') + '</p>'
      + (r.body ? '<p style="white-space:pre-wrap">' + esc(r.body) + '</p>' : '')
      + stageBar(r, false)
      + '<h4>진행 기록</h4>' + ((r.progress || []).length
        ? '<ol class="rq-log">' + r.progress.map((p) => '<li><span class="hint">' + esc(fmtT(p.at)) + ' · ' + esc(STAGES[p.stage] || p.stage) + '</span><div>' + esc(p.text) + '</div></li>').join('') + '</ol>'
        : '<p class="hint">아직 답변이 없습니다. 접수 글이 💬 소통으로 Claude에게 넘어갔고, PC 중계가 돌고 있으면 곧 여기에 진행 상황이 적힙니다.</p>')
      + '<h4>요청 내용</h4>'
      + (r.items || []).map((it, i) => itemHtml(it, i, false) + excerptHtml(it.excerpt)).join('');
    $('rqView').hidden = false;
    $('rvClose').onclick = () => { $('rqView').hidden = true; };
    $('rvXlsx').onclick = () => downloadXlsx(r);
  }

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
