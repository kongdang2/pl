// 수정요청 모드 — 엔진 화면(같은 출처 iframe)에서 셀을 고르고 메모를 달아 요청서로 묶는다.
// 엔진은 고치지 않는다: 바깥 페이지가 iframe 문서를 직접 읽고(위치·표·값), 그림은 html2canvas로 뜬다.
(function () {
  const MAX_EXCERPT_ROWS = 40, MAX_EXCERPT_COLS = 16, MAX_IMG_W = 1400;
  const isNum = (s) => /^[-+(△▲▼]?\s*[\d,.]+\s*%?\)?$/.test(String(s).trim());
  const txt = (el) => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  // 셀 글자: 안에 든 버튼(예: 「퀵」)·숨은 요소는 빼고 읽는다
  function cellText(td) {
    if (!td.querySelector('button,[hidden],.hide,script,style')) return txt(td);
    const c = td.cloneNode(true);
    c.querySelectorAll('button,[hidden],.hide,script,style').forEach((x) => x.remove());
    return String(c.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function cellValue(td) {
    const f = td.querySelector('input,select,textarea');
    if (f) {
      if (f.tagName === 'SELECT') return (f.options[f.selectedIndex] || {}).text || f.value || '';
      if (f.type === 'checkbox' || f.type === 'radio') return f.checked ? '✔' : '';
      return String(f.value || '');
    }
    return cellText(td);
  }

  // 표 → 논리 격자(rowspan·colspan 펼침). pos: 셀 요소 → 왼쪽 위 [r, c]
  function buildGrid(table) {
    const grid = [], pos = new Map();
    Array.from(table.rows).forEach((tr, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      Array.from(tr.cells).forEach((td) => {
        while (grid[r][c]) c++;
        const rs = Math.max(1, td.rowSpan || 1), cs = Math.max(1, td.colSpan || 1);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { grid[r + i] = grid[r + i] || []; grid[r + i][c + j] = td; }
        pos.set(td, [r, c]);
        c += cs;
      });
    });
    const nCols = grid.reduce((m, row) => Math.max(m, row ? row.length : 0), 0);
    // 머리글 행: thead 안, 또는 맨 위에서 th만 있는 행들(없으면 0행이 숫자가 아니면 0행)
    let head = 0;
    if (table.tHead) head = table.tHead.rows.length;
    else {
      while (head < table.rows.length && Array.from(table.rows[head].cells).every((x) => x.tagName === 'TH')) head++;
      if (!head && table.rows[0] && Array.from(table.rows[0].cells).every((x) => !isNum(txt(x)))) head = 1;
    }
    // 행 이름 열: 본문에서 대부분 숫자가 아닌 앞쪽 열(최대 3개)
    let label = 0;
    for (let c = 0; c < Math.min(3, nCols); c++) {
      let n = 0, s = 0;
      for (let r = head; r < grid.length && n < 30; r++) { const td = grid[r] && grid[r][c]; if (!td) continue; const v = cellValue(td); if (!v) continue; n++; if (!isNum(v)) s++; }
      if (n && s / n >= 0.7) label = c + 1; else break;
    }
    return { grid, pos, nCols, head, label };
  }
  function colLabel(G, c) {
    const out = [];
    for (let r = 0; r < G.head; r++) { const td = G.grid[r] && G.grid[r][c]; const t = td ? cellText(td) : ''; if (t && out[out.length - 1] !== t) out.push(t); }
    return out.join(' / ');
  }
  function rowLabel(G, r) {
    const out = [];
    for (let c = 0; c < G.label; c++) { const td = G.grid[r] && G.grid[r][c]; const t = td ? cellValue(td) : ''; if (t && out[out.length - 1] !== t) out.push(t); }
    return out.join(' / ');
  }
  function tableTitle(table) {
    let el = table;
    for (let up = 0; up < 6 && el && el.tagName !== 'BODY'; up++) {
      let s = el.previousElementSibling;
      for (let k = 0; k < 6 && s; k++, s = s.previousElementSibling) {
        if (s.tagName === 'TABLE' || s.tagName === 'SCRIPT' || s.tagName === 'STYLE') continue;
        const h = /^H[1-6]$/.test(s.tagName) ? s : s.querySelector && s.querySelector('h1,h2,h3,h4,h5,.title,.card-title,.sec-title,b,strong');
        const t = txt(h || s).slice(0, 80);
        if (t && !isNum(t) && t.length >= 2) return t;
      }
      el = el.parentElement;
    }
    return '';
  }
  function location(win, table) {
    const d = win.document, vis = (e) => e && e.offsetParent !== null;
    const one = (sel) => { const e = Array.from(d.querySelectorAll(sel)).find(vis); return e ? txt(e) : ''; };
    let ym = null;
    try { ym = (0, win.eval)('typeof S!=="undefined"&&S?S.ym:null'); } catch (_) { /* 없음 */ }
    return {
      zone: one('.zonecard.on'), site: one('.site-tab.active'), menu: one('.menu-tab.active'),
      subs: Array.from(d.querySelectorAll('.subtab.active')).filter(vis).map(txt).filter(Boolean),
      ym, table: table ? tableTitle(table) : '',
    };
  }
  const locText = (L) => [L.zone, L.site, L.menu].concat(L.subs || []).filter(Boolean).join(' ▸ ') + (L.ym ? ' · ' + L.ym : '') + (L.table ? ' · 「' + L.table + '」' : '');

  // ── html2canvas를 iframe 안에 한 번 싣기(그 문서 기준으로 그려야 글꼴·스타일이 맞다)
  function ensureH2C(win) {
    if (win.html2canvas) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = win.document.createElement('script');
      s.src = new URL('vendor/html2canvas-1.4.1.min.js', window.location.href).href;
      s.onload = () => res(); s.onerror = () => rej(new Error('캡처 도구를 불러오지 못했습니다'));
      win.document.head.appendChild(s);
    });
  }
  async function snapImage(win, table, cells) {
    await ensureH2C(win);
    // 고른 셀 주변(머리글 포함)만 잘라 낸다. 표 전체를 그린 뒤 자르는 방식(위치 계산이 단순하고 정확)
    const tr = table.getBoundingClientRect();
    let top = Infinity, bot = -Infinity, left = Infinity, right = -Infinity;
    cells.forEach((td) => { const r = td.getBoundingClientRect(); top = Math.min(top, r.top); bot = Math.max(bot, r.bottom); left = Math.min(left, r.left); right = Math.max(right, r.right); });
    const headBot = table.tHead ? table.tHead.getBoundingClientRect().bottom : (table.rows[0] ? table.rows[0].getBoundingClientRect().bottom : tr.top);
    const pad = 90;
    const y0 = Math.max(tr.top, Math.min(top - pad, headBot)) - tr.top;
    const y1 = Math.min(tr.bottom, bot + pad) - tr.top;
    // 행 이름 열이 보이도록 왼쪽 끝부터. 표가 아주 넓을 때만 고른 셀 왼쪽 260px부터
    const x0 = (right - tr.left) <= 1800 ? 0 : Math.max(0, left - tr.left - 260);
    const x1 = Math.min(tr.width, Math.max(right - tr.left + 200, x0 + 600));
    const canvas = await win.html2canvas(table, { backgroundColor: '#ffffff', scale: 1, logging: false, useCORS: false,
      windowWidth: win.document.documentElement.scrollWidth, windowHeight: win.document.documentElement.scrollHeight });
    const w = Math.max(1, Math.round(x1 - x0)), h = Math.max(1, Math.round(y1 - y0));
    const k = Math.min(1, MAX_IMG_W / w);
    const out = document.createElement('canvas'); out.width = Math.round(w * k); out.height = Math.round(h * k);
    const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(canvas, Math.round(x0), Math.round(y0), w, h, 0, 0, out.width, out.height);
    // 고른 셀 표시는 직접 그린다(입력칸이 셀을 덮으면 셀 스타일이 캡처에 안 보임)
    g.strokeStyle = '#D92D20'; g.lineWidth = 2;
    cells.forEach((td) => { const r = td.getBoundingClientRect(); g.strokeRect((r.left - tr.left - x0) * k + 1, (r.top - tr.top - y0) * k + 1, r.width * k - 2, r.height * k - 2); });
    let url = out.toDataURL('image/png');
    if (url.length > 900000) url = out.toDataURL('image/jpeg', 0.85);
    return url;
  }

  function excerpt(G, sel) {
    const rs = sel.map((x) => x[0]), cs = sel.map((x) => x[1]);
    const r0 = Math.max(G.head, Math.min(...rs) - 2), r1 = Math.min(G.grid.length - 1, Math.max(...rs) + 2);
    const c0 = Math.max(G.label, Math.min(...cs) - 2), c1 = Math.min(G.nCols - 1, Math.max(...cs) + 2);
    const rows = [], cols = [];
    for (let c = 0; c < G.label; c++) cols.push(c);
    for (let c = c0; c <= c1 && cols.length < MAX_EXCERPT_COLS; c++) if (!cols.includes(c)) cols.push(c);
    const rowIdx = [];
    for (let r = 0; r < G.head; r++) rowIdx.push(r);
    for (let r = r0; r <= r1 && rowIdx.length < MAX_EXCERPT_ROWS; r++) rowIdx.push(r);
    rowIdx.forEach((r) => {
      const seen = new Set();
      rows.push(cols.map((c) => {
        const td = G.grid[r] && G.grid[r][c]; if (!td || seen.has(td)) return '';
        seen.add(td);
        const p = G.pos.get(td); if (p && p[0] < r && rowIdx.includes(p[0])) return ''; // 위 행에서 내려온 rowspan
        return cellValue(td);
      }));
    });
    const mark = [];
    sel.forEach(([r, c]) => { const i = rowIdx.indexOf(r), j = cols.indexOf(c); if (i >= 0 && j >= 0) mark.push([i, j]); });
    return { rows, sel: mark, head: G.head };
  }

  // ── 모드 본체 ───────────────────────────────────────
  const STYLE_ID = '__SK_RQ_STYLE__';
  // 캡처(html2canvas)는 outline을 그리지 않으므로 안쪽 box-shadow로 표시한다
  const CSS = '.sk-rq-on td,.sk-rq-on th{cursor:cell!important}.sk-rq-sel{box-shadow:inset 0 0 0 2px #D92D20!important;background-image:linear-gradient(rgba(217,45,32,.12),rgba(217,45,32,.12))!important}'
    + '.sk-rq-done{box-shadow:inset 0 0 0 2px #F79009!important}';

  function create(opts) {
    // opts: {getWin, onChange(state)}
    const st = { on: false, win: null, table: null, G: null, sel: new Map(), anchor: null, dragging: false, items: [] };
    let handlers = null;

    function clearMarks(cls) { if (!st.win) return; st.win.document.querySelectorAll('.' + cls).forEach((e) => e.classList.remove(cls)); }
    function paint() {
      clearMarks('sk-rq-sel');
      st.sel.forEach((td) => td.classList.add('sk-rq-sel'));
      opts.onChange && opts.onChange(api);
    }
    function cellFrom(ev) {
      const td = ev.target && ev.target.closest && ev.target.closest('td,th');
      if (!td) return null;
      const table = td.closest('table');
      return table ? { td, table } : null;
    }
    function rect(a, b) {
      const [r0, r1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [c0, c1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      const m = new Map();
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const td = st.G.grid[r] && st.G.grid[r][c]; if (td) { const p = st.G.pos.get(td); m.set(p[0] + ',' + p[1], td); } }
      return m;
    }
    function down(ev) {
      if (ev.button !== 0) return;
      const hit = cellFrom(ev); if (!hit) return;
      ev.preventDefault(); ev.stopPropagation();
      if (hit.table !== st.table || ev.altKey) { st.table = hit.table; st.G = buildGrid(hit.table); st.sel = new Map(); }
      else st.G = buildGrid(hit.table); // 다시 그려졌을 수 있어 매번 새로
      const p = st.G.pos.get(hit.td); if (!p) return;
      const key = p[0] + ',' + p[1];
      if (ev.ctrlKey || ev.metaKey) { if (st.sel.has(key)) st.sel.delete(key); else st.sel.set(key, hit.td); st.anchor = p; }
      else if (ev.shiftKey && st.anchor) { st.sel = rect(st.anchor, p); }
      else { st.anchor = p; st.sel = new Map([[key, hit.td]]); st.dragging = true; }
      paint();
    }
    function over(ev) {
      if (!st.dragging) return;
      const hit = cellFrom(ev); if (!hit || hit.table !== st.table) return;
      const p = st.G.pos.get(hit.td); if (!p) return;
      st.sel = rect(st.anchor, p); paint();
    }
    function up() { st.dragging = false; }
    function block(ev) { if (cellFrom(ev)) { ev.preventDefault(); ev.stopPropagation(); } }
    function key(ev) { if (ev.key === 'Escape') { if (st.sel.size) { st.sel = new Map(); paint(); } else api.stop(); } }

    const api = {
      get on() { return st.on; },
      get items() { return st.items; },
      start(win) {
        if (st.on) return;
        st.win = win; st.on = true;
        const d = win.document;
        if (!d.getElementById(STYLE_ID)) { const s = d.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; d.head.appendChild(s); }
        d.body.classList.add('sk-rq-on');
        handlers = { mousedown: down, mouseover: over, mouseup: up, click: block, dblclick: block, focusin: block, keydown: key };
        Object.entries(handlers).forEach(([k, f]) => d.addEventListener(k, f, true));
        paint();
      },
      stop() {
        if (!st.on) return;
        const d = st.win.document;
        Object.entries(handlers || {}).forEach(([k, f]) => d.removeEventListener(k, f, true));
        d.body.classList.remove('sk-rq-on');
        clearMarks('sk-rq-sel'); clearMarks('sk-rq-done');
        st.on = false; st.sel = new Map(); st.table = null;
        opts.onChange && opts.onChange(api);
      },
      reset() { st.items = []; st.sel = new Map(); st.table = null; if (st.on) paint(); else opts.onChange && opts.onChange(api); },
      clearSel() { st.sel = new Map(); paint(); },
      // 지금 고른 셀 정보(패널 표시용)
      current() {
        if (!st.sel.size || !st.table) return null;
        const G = st.G = buildGrid(st.table);
        const list = Array.from(st.sel.values()).map((td) => { const p = G.pos.get(td); return p && { r: p[0], c: p[1], row: rowLabel(G, p[0]), col: colLabel(G, p[1]), value: cellValue(td) }; }).filter(Boolean)
          .sort((a, b) => a.r - b.r || a.c - b.c);
        return { loc: location(st.win, st.table), cells: list };
      },
      // 지금 고른 셀을 항목으로 담는다(그림·표 발췌는 이때 뜬다)
      async take(notes, itemNote) {
        const cur = api.current(); if (!cur) throw new Error('먼저 셀을 고르세요');
        const tds = Array.from(st.sel.values());
        cur.cells.forEach((c, i) => { c.note = (notes && notes[i]) || ''; });
        const ex = excerpt(st.G, cur.cells.map((c) => [c.r, c.c]));
        let image = null;
        try { image = await snapImage(st.win, st.table, tds); } catch (e) { image = null; cur.imageError = String(e && e.message || e); }
        const item = { loc: cur.loc, cells: cur.cells, excerpt: ex, image, note: itemNote || '', at: new Date().toISOString() };
        if (cur.imageError) item.imageError = cur.imageError;
        st.items.push(item);
        tds.forEach((td) => td.classList.add('sk-rq-done'));
        st.sel = new Map(); paint();
        return item;
      },
      remove(i) { st.items.splice(i, 1); opts.onChange && opts.onChange(api); },
    };
    return api;
  }

  // ── 엑셀(요청서 + 항목별 표 발췌·그림) ────────────────
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error(src + ' 를 불러오지 못했습니다')); document.head.appendChild(s); });
  }
  async function toXlsx(req) {
    if (!window.ExcelJS) await loadScript('vendor/exceljs-4.4.0.min.js');
    const wb = new window.ExcelJS.Workbook(); wb.creator = '손익추정 웹';
    const yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }, grey = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F5' } };
    const thin = { style: 'thin', color: { argb: 'FFC9D3DD' } }, box = { top: thin, left: thin, bottom: thin, right: thin };
    const ws = wb.addWorksheet('요청서');
    ws.columns = [{ width: 16 }, { width: 34 }, { width: 30 }, { width: 18 }, { width: 40 }];
    const put = (k, v) => { const r = ws.addRow([k, v]); r.getCell(1).font = { bold: true }; r.getCell(1).fill = grey; ws.mergeCells(r.number, 2, r.number, 5); r.getCell(2).alignment = { wrapText: true, vertical: 'top' }; };
    put('요청 번호', req.id ? '#' + req.id : '(접수 전)'); put('제목', req.title); put('구분', req.kind); put('상태', req.status || '접수');
    put('작성', (req.author_name || req.author_email || '') + ' · ' + new Date(req.created_at || Date.now()).toLocaleString('ko-KR'));
    put('스냅샷', (req.base_ym || '') + ' · 엔진 ' + (req.engine_ver || '') + (req.snapshot_id ? ' · ' + req.snapshot_id : ''));
    put('설명', req.body || '');
    ws.addRow([]);
    const h = ws.addRow(['항목', '위치', '행', '열', '현재 값 → 메모(기대값)']); h.font = { bold: true }; h.eachCell((c) => { c.fill = grey; c.border = box; });
    (req.items || []).forEach((it, i) => {
      (it.cells || []).forEach((c, j) => {
        const r = ws.addRow([j ? '' : '항목 ' + (i + 1), j ? '' : locText(it.loc || {}), c.row, c.col, (c.value || '') + (c.note ? '  →  ' + c.note : '')]);
        r.eachCell((x) => { x.border = box; x.alignment = { wrapText: true, vertical: 'top' }; });
        if (c.note) r.getCell(5).fill = yellow;
      });
      if (it.note) { const r = ws.addRow(['', '항목 메모', it.note]); ws.mergeCells(r.number, 3, r.number, 5); r.getCell(3).alignment = { wrapText: true }; }
    });
    for (let i = 0; i < (req.items || []).length; i++) {
      const it = req.items[i];
      const s = wb.addWorksheet('항목' + (i + 1));
      s.addRow([locText(it.loc || {})]).font = { bold: true };
      if (it.note) s.addRow(['메모: ' + it.note]);
      const base = s.rowCount + 1;
      const ex = it.excerpt || { rows: [], sel: [] };
      ex.rows.forEach((row, ri) => {
        const r = s.addRow(row.map((v) => (isNum(v) && /\d/.test(v) && !/%$/.test(v) ? Number(String(v).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/^[△▼]/, '-').replace(/^▲/, '')) : v)));
        r.eachCell({ includeEmpty: true }, (c) => { c.border = box; if (ri < (ex.head || 0)) { c.fill = grey; c.font = { bold: true }; } });
      });
      const noteOf = {}; (it.cells || []).forEach((c) => { noteOf[c.r + ',' + c.c] = c.note; });
      ex.sel.forEach(([ri, ci], k) => {
        const cell = s.getCell(base + ri, ci + 1); cell.fill = yellow; cell.border = { top: { style: 'medium', color: { argb: 'FFD92D20' } }, left: { style: 'medium', color: { argb: 'FFD92D20' } }, bottom: { style: 'medium', color: { argb: 'FFD92D20' } }, right: { style: 'medium', color: { argb: 'FFD92D20' } } };
        const c = (it.cells || [])[k]; if (c && c.note) cell.note = c.note;
      });
      s.columns.forEach((col, ci) => { col.width = ci < 2 ? 22 : 13; });
      if (it.image) {
        const ext = /^data:image\/jpeg/.test(it.image) ? 'jpeg' : 'png';
        const id = wb.addImage({ base64: it.image, extension: ext });
        const img = new Image(); img.src = it.image;
        await new Promise((r) => { img.onload = r; img.onerror = r; });
        const row0 = s.rowCount + 2;
        s.getCell(row0 - 1, 1).value = '화면 캡처';
        s.addImage(id, { tl: { col: 0, row: row0 }, ext: { width: img.naturalWidth || 800, height: img.naturalHeight || 400 } });
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  window.SonikRequest = { create, toXlsx, locText, _t: { buildGrid, colLabel, rowLabel, excerpt, cellValue, isNum } };
})();
