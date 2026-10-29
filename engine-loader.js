// 엔진 HTML(빈 엔진)을 같은 출처의 iframe으로 띄우고 v308 웹 연결 통로(__sonikWebBridge)로 스냅샷을 주고받는다.
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
    if (html.indexOf('__sonikWebBridge') < 0) errs.push('웹 연결(v308 이후) 엔진이 아닙니다');
    const m = /window\.SYS_CHANGELOG\s*=\s*\[\s*\{date:'[^']*',title:'(v\d+)/.exec(html);
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
  function checkSnapshot(db) {
    if (!db || db.format !== 'pnl-db/1') return 'DB 내보내기(pnl-db/1) 파일이 아닙니다';
    if (!db.payload || !db.confirmed) return '「DB 내보내기 ▸ 전체 (확정 + 추정)」 파일만 올릴 수 있습니다';
    if (db.mode && db.mode !== 'sonik') return '손익추정 파일이 아닙니다(사업계획 백업)';
    return null;
  }

  window.SonikEngine = { checkEmptyEngine, inject, mount, gzip, gunzipToText, sha256, checkSnapshot };
})();
