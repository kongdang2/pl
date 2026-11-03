// 엔진 HTML(빈 엔진)을 같은 출처의 iframe으로 띄우고 웹 연결 통로(__sonikWebBridge, 웹 시험판 vNNN-n)로 스냅샷을 주고받는다.
// Supabase와 무관한 부분만 둔다(로컬 시험에서도 그대로 쓴다).
(function () {
  // 엔진이 열리기 전에 실행: 웹 모드 표시 + 브라우저 저장소를 메모리로 대체(같은 github.io 주소를 쓰는
  // 다른 앱과 저장 공간을 나누지 않고, 공용 PC에 손익 데이터가 남지 않게). 실행 후 자기 자신을 지워
  // 엔진의 「HTML 저장」「빈 엔진 다운로드」 결과에 이 표시가 섞이지 않게 한다.
  const FLAG = '<script id="__SONIK_WEB_FLAG__">window.__SONIK_WEB__=true;(function(){var m=Object.create(null);'
    + 'var s={getItem:function(k){k=String(k);return k in m?m[k]:null;},setItem:function(k,v){m[String(k)]=String(v);},'
    + 'removeItem:function(k){delete m[String(k)];},clear:function(){for(var k in m)delete m[k];},'
    + 'key:function(i){var a=Object.keys(m);return i<a.length?a[i]:null;},get length(){return Object.keys(m).length;}};'
    + 'try{Object.defineProperty(window,"localStorage",{value:s,configurable:true});}catch(e){}'
    + 'try{Object.defineProperty(window,"sessionStorage",{value:s,configurable:true});}catch(e){}'
    + 'var me=document.getElementById("__SONIK_WEB_FLAG__");if(me)me.remove();})();<\/script>';

  function checkEmptyEngine(html) {
    const errs = [];
    if (!/window\.__EMPTY_ENGINE__\s*=\s*true/.test(html)) errs.push('빈 엔진 표시(__EMPTY_ENGINE__)가 없습니다 — 관리자 도구 「빈 엔진 다운로드」 파일인지 확인하세요');
    for (const id of ['__SAVED_DATA__', '__SAVED_CONFIRMED__', '__SAVED_PLAN__', '__SAVED_VERSIONS__', '__LINK_STAMP__']) {
      if (new RegExp('<script[^>]*id=["\']' + id + '["\']').test(html)) errs.push('데이터 블록 ' + id + ' 이 들어 있습니다');
    }
    if (html.indexOf('__sonikWebBridge') < 0) errs.push('웹 연결 엔진(웹 시험판 v307-1 이후)이 아닙니다');
    const m = /window\.SYS_CHANGELOG\s*=\s*\[\s*\{date:'[^']*',title:'(v\d+(?:-\d+)?)/.exec(html);
    return { ok: errs.length === 0, errs, ver: m ? m[1] : null };
  }

  function inject(html) {
    const i = html.search(/<head[^>]*>/i);
    if (i < 0) throw new Error('엔진 HTML에 <head>가 없습니다');
    const j = html.indexOf('>', i) + 1;
    return html.slice(0, j) + FLAG + html.slice(j);
  }

  // iframe을 만들고 엔진이 준비될 때까지 기다린다. 반환: {frame, win, bridge}
  async function mount(container, html, onMessage, timeoutMs) {
    container.innerHTML = '';
    const url = URL.createObjectURL(new Blob([inject(html)], { type: 'text/html;charset=utf-8' }));
    const frame = document.createElement('iframe');
    frame.className = 'engine-frame';
    frame.src = url;
    container.appendChild(frame);
    const handler = (ev) => { if (ev.source === frame.contentWindow && ev.data && typeof ev.data.type === 'string') onMessage(ev.data); };
    window.addEventListener('message', handler);
    const t0 = Date.now(), limit = timeoutMs || 180000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 300));
      const w = frame.contentWindow;
      try { if (w && w.__sonikWebBridge && w.__sonikWebBridge.info()) break; } catch (_) { /* 아직 부팅 중 */ }
      if (Date.now() - t0 > limit) throw new Error('엔진이 ' + Math.round(limit / 1000) + '초 안에 열리지 않았습니다');
    }
    await new Promise((r) => setTimeout(r, 800)); // 부팅 직후 refresh 마무리
    URL.revokeObjectURL(url);
    return { frame, win: frame.contentWindow, bridge: frame.contentWindow.__sonikWebBridge, dispose: () => window.removeEventListener('message', handler) };
  }

  async function gzip(text) {
    const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return await new Response(s).blob();
  }
  async function gunzipToText(blob) {
    const s = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(s).text();
  }
  async function sha256(text) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // want: 'sonik'(손익추정 목록에 올림, 기본) / 'bizplan'(사업계획 목록에 올림)
  function checkSnapshot(db, want) {
    want = want || 'sonik';
    if (!db || db.format !== 'pnl-db/1') return 'DB 내보내기(pnl-db/1) 파일이 아닙니다';
    if (!db.payload || !db.confirmed) return '「DB 내보내기 ▸ 전체 (확정 + 추정)」 파일만 올릴 수 있습니다';
    const mode = db.mode || 'sonik';
    if (mode !== want) return want === 'sonik' ? '손익추정 파일이 아닙니다(사업계획 백업) — 「사업계획」 탭에서 올리세요' : '사업계획 파일이 아닙니다(손익추정 백업) — 「손익추정」 탭에서 올리세요';
    return null;
  }

  // ── 기기 보관(hong 11/03): 서버 파일(엔진·추정자료 .gz)을 이 브라우저 IndexedDB 에 경로 그대로 둔다.
  // 서버 경로는 저장할 때마다 새 이름(엔진 ver_sha8, 저장본 rN_uuid)이라 경로가 같으면 내용도 같다 → 같은 경로는 다시 받지 않는다.
  // kind 별 최근 것만 남긴다(엔진 2개, 추정자료 40개). 로그아웃하면 clear() 로 모두 지운다.
  const LC_KEEP = { engine: 2, snap: 40 };
  let lcDb = null;
  function lcOpen() {
    if (lcDb) return lcDb;
    lcDb = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('no idb')); return; }
      const r = indexedDB.open('sonik-cache', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('files', { keyPath: 'path' }); s.createIndex('kind', 'kind'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch((e) => { lcDb = null; throw e; });
    return lcDb;
  }
  function lcReq(mode, fn) {
    return lcOpen().then((db) => new Promise((res, rej) => {
      const tx = db.transaction('files', mode), s = tx.objectStore('files');
      let out; const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out); tx.onerror = tx.onabort = () => rej(tx.error);
    }));
  }
  const LocalCache = {
    async get(path) {
      try { const x = await lcReq('readonly', (s) => s.get(path)); if (!x || !x.blob) return null; lcReq('readwrite', (s) => { x.at = Date.now(); s.put(x); }).catch(() => {}); return x.blob; }
      catch (_) { return null; }
    },
    async put(path, blob, kind) {
      try {
        await lcReq('readwrite', (s) => s.put({ path, blob, kind, at: Date.now(), size: blob.size }));
        const all = await lcReq('readonly', (s) => s.index('kind').getAll(kind));
        const old = (all || []).sort((a, b) => b.at - a.at).slice(LC_KEEP[kind] || 20);
        if (old.length) await lcReq('readwrite', (s) => { old.forEach((o) => s.delete(o.path)); });
      } catch (_) { /* 보관 못 해도 열기는 계속 */ }
    },
    async clear(kind) {
      try {
        if (!kind) { await lcReq('readwrite', (s) => s.clear()); return; }
        const all = await lcReq('readonly', (s) => s.index('kind').getAllKeys(kind));
        await lcReq('readwrite', (s) => { (all || []).forEach((k) => s.delete(k)); });
      } catch (_) { /* 없음 */ }
    },
    async stats() {
      try { const all = await lcReq('readonly', (s) => s.getAll()); return (all || []).reduce((o, x) => { o[x.kind] = (o[x.kind] || 0) + 1; o.bytes += x.size || 0; return o; }, { bytes: 0 }); }
      catch (_) { return { bytes: 0 }; }
    },
  };

  window.SonikEngine = { checkEmptyEngine, inject, mount, gzip, gunzipToText, sha256, checkSnapshot, LocalCache };
})();
