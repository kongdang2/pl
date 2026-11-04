#!/usr/bin/env node
// 엔진 조회 — 웹 추정자료(DB 내보내기 JSON)를 웹 엔진에 화면 없이 열어, 엔진이 계산해 보여 주는 표를 메뉴마다 글자로 뽑는다.
// 챗봇 답변 개선 B(hong 2026-11-04): 화면에 없는 숫자를 챗봇이 제 공식으로 다시 셈해 틀리던 것을, 엔진 계산값을 직접 찾아 쓰게 한다.
// 읽기 전용: 네트워크는 막고, 저장·다운로드는 하지 않는다. 자료 파일은 바꾸지 않는다.
// PC 위치: 손익추정시스템\소통\엔진조회.cjs   (중계.cjs 가 숫자 질문 때 먼저 돌려 둔다. 직접 실행도 된다)
//
// 사용:
//   node 소통\엔진조회.cjs --db <자료.json> --engine <웹 엔진.html> --out <폴더> [--ym 2026-10[,2026-09]] [--conf-ym 2026-09] [--only 온산]
//   node 소통\엔진조회.cjs --db … --engine … --eval "식"      (엔진 안에서 식을 계산해 JSON 으로 출력. 예: "S.ym", "Object.keys(CONFIRMED_DB)")
// 결과(--out): 목차.txt(화면별 파일·위치·표 이름) + 화면마다 NNN_<위치>.txt(표는 탭 구분, 「표 이름」 머리)
//   월을 고르는 화면(판매·구매·수율·제조원가 등)은 --ym 의 달 기준, 전체월 표 화면은 그대로 뽑는다.
'use strict';
const fs = require('fs'), path = require('path');

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 && i + 1 < A.length ? A[i + 1] : d; };
const DB = arg('db'), ENGINE = arg('engine'), OUT = arg('out'), EVAL = arg('eval'), ONLY = arg('only', '');
const YMS = String(arg('ym', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const CONF_YM = arg('conf-ym', ''); // 확정 구역에서 볼 달(비우면 엔진 기본 = 기준월 직전 달)
const LIMIT_MIN = +arg('limit-min', 8);
if (!DB || !ENGINE || (!OUT && !EVAL)) {
  console.error('사용: node 엔진조회.cjs --db <자료.json> --engine <엔진.html> (--out <폴더> [--ym 2026-10] [--only 온산] | --eval "식")');
  process.exit(2);
}

// Playwright: PC 는 웹 자동검증 lib.cjs 의 것(설치된 Chrome), 없으면 일반 playwright
function browserType() {
  const lib = path.join(__dirname, '..', '웹테스트', '자동검증', 'lib.cjs');
  if (fs.existsSync(lib)) { try { return { pw: require(lib).playwright(), opt: { channel: 'chrome', headless: true } }; } catch (_) { /* 아래로 */ } }
  return { pw: require('playwright'), opt: { headless: true } };
}

// 웹 페이지(engine-loader.js)와 같은 표시: 웹 모드 + 브라우저 저장소를 메모리로
const FLAG = '<script>window.__SONIK_WEB__=true;(function(){var m=Object.create(null);'
  + 'var s={getItem:function(k){k=String(k);return k in m?m[k]:null;},setItem:function(k,v){m[String(k)]=String(v);},'
  + 'removeItem:function(k){delete m[String(k)];},clear:function(){for(var k in m)delete m[k];},'
  + 'key:function(i){var a=Object.keys(m);return i<a.length?a[i]:null;},get length(){return Object.keys(m).length;}};'
  + 'try{Object.defineProperty(window,"localStorage",{value:s,configurable:true});}catch(e){}'
  + 'try{Object.defineProperty(window,"sessionStorage",{value:s,configurable:true});}catch(e){}})();<\/script>';

// ── 엔진 안에서 도는 부분 ──
function pageLib() {
  const vis = (e) => !!e && e.offsetParent !== null;
  const txt = (el) => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  const isNum = (t) => /^[-+()\d.,%△▲▼\s]+$/.test(t);
  function cellText(td) {
    const f = td.querySelector('input,select,textarea');
    if (f) {
      if (f.tagName === 'SELECT') return (f.options[f.selectedIndex] || {}).text || f.value || '';
      if (f.type === 'checkbox' || f.type === 'radio') return f.checked ? '✔' : '';
      if (f.value != null && f.value !== '') return String(f.value);
    }
    if (!td.querySelector('button,[hidden],.hide,script,style')) return txt(td);
    const c = td.cloneNode(true);
    c.querySelectorAll('button,[hidden],.hide,script,style').forEach((x) => x.remove());
    return String(c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function tableTitle(table) {
    let el = table;
    for (let up = 0; up < 6 && el && el.tagName !== 'BODY'; up++) {
      let s = el.previousElementSibling;
      for (let k = 0; k < 6 && s; k++, s = s.previousElementSibling) {
        if (s.tagName === 'TABLE' || s.tagName === 'SCRIPT' || s.tagName === 'STYLE') continue;
        const h = /^H[1-6]$/.test(s.tagName) ? s : s.querySelector && s.querySelector('h1,h2,h3,h4,h5,.title,.card-title,.sec-title,b,strong');
        let src = h || s;
        if (src.querySelector && src.querySelector('select,option')) { src = src.cloneNode(true); src.querySelectorAll('select,option').forEach((x) => x.remove()); }
        const t = txt(src).replace(/[◀▶]/g, '').trim().slice(0, 80);
        if (t && !isNum(t) && t.length >= 2) return t;
      }
      el = el.parentElement;
    }
    return '';
  }
  const one = (sel) => { const e = Array.from(document.querySelectorAll(sel)).find(vis); return e ? txt(e) : ''; };
  function where() {
    return [one('.zonecard.on'), one('.site-tab.active'), one('.menu-tab.active')]
      .concat(Array.from(document.querySelectorAll('.subtab.active')).filter(vis).map(txt)).filter(Boolean).join(' ▸ ');
  }
  function screen() {
    const out = [];
    for (const t of Array.from(document.querySelectorAll('table')).filter(vis)) {
      if (t.parentElement && t.parentElement.closest('table')) continue;
      const rows = [];
      for (const tr of Array.from(t.rows)) {
        if (!vis(tr)) continue;
        const cells = Array.from(tr.cells).map((td) => cellText(td).replace(/\t/g, ' '));
        if (cells.some(Boolean)) rows.push(cells.join('\t'));
      }
      if (rows.length) out.push({ title: tableTitle(t) || '표', rows });
    }
    // 달 표시: 확정 구역은 화면 안 확정실적 연-월, 추정 구역은 월 버튼이 있는 메뉴만(나머지는 전체월 표)
    let ym = null;
    try {
      if ((S._zone || 'est') === 'conf') ym = (typeof getConfYm === 'function') ? getConfYm() : null;
      else if (typeof MONTH_TAB_MENUS !== 'undefined' && MONTH_TAB_MENUS.includes(S.menu)) ym = S.ym;
    } catch (_) { /* 없음 */ }
    return { where: where(), ym, menu: S && S.menu, tables: out };
  }
  // 보이는 탭(onclick 있는 것)만: 같은 함수 호출은 한 번
  function tabs(sel) {
    const seen = new Set(), r = [];
    for (const e of Array.from(document.querySelectorAll(sel)).filter(vis)) {
      const oc = e.getAttribute('onclick') || '';
      if (!oc || seen.has(oc + '|' + txt(e))) continue;
      seen.add(oc + '|' + txt(e)); r.push({ oc, t: txt(e) });
    }
    return r;
  }
  function click(sel, oc, t) {
    const e = Array.from(document.querySelectorAll(sel)).filter(vis).find((x) => (x.getAttribute('onclick') || '') === oc && (!t || txt(x) === t));
    if (!e) return false;
    e.click(); return true;
  }
  function setYm(ym, confYm) {
    if (typeof S === 'undefined') return false;
    let ch = false;
    if (confYm && (S._zone || 'est') === 'conf') { try { if (_confYm !== confYm) { _confYm = confYm; ch = true; } } catch (_) { /* 없음 */ } }
    if (ym && S.ym !== ym) { S.ym = ym; ch = true; }
    if (!ch) return false;
    try { if (typeof renderMonthTabs === 'function') renderMonthTabs(); } catch (_) { /* 무시 */ }
    try { if (typeof switchMenu === 'function') switchMenu(S.menu); } catch (_) { /* 무시 */ }
    return true;
  }
  window.__eq = { screen, tabs, click, setYm, where };
}

const wait = (p, ms) => p.waitForTimeout(ms);
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s▸]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80);

(async () => {
  const t0 = Date.now();
  const { pw, opt } = browserType();
  const html = fs.readFileSync(ENGINE, 'utf8');
  const i = html.search(/<head[^>]*>/i), j = html.indexOf('>', i) + 1;
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonik-eq-'));
  const tmp = path.join(tmpDir, 'engine.html');
  fs.writeFileSync(tmp, html.slice(0, j) + FLAG + html.slice(j));
  const browser = await pw.chromium.launch(opt);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: false });
    await ctx.route(/^https?:/, (r) => r.abort());
    const p = await ctx.newPage();
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p.goto(require('url').pathToFileURL(tmp).href, { timeout: 240000 });
    await p.waitForFunction(() => window.__sonikWebBridge && window.__sonikWebBridge.info(), null, { timeout: 240000 });
    await wait(p, 800);
    const db = JSON.parse(fs.readFileSync(DB, 'utf8').replace(/^﻿/, ''));
    if (db.mode === 'bizplan') throw new Error('사업계획 자료는 아직 지원하지 않습니다(손익추정 자료만)');
    const ver = await p.evaluate((d) => { const r = window.__sonikWebBridge.applyDb(d); return { info: window.__sonikWebBridge.info(), verify: r && r.verify ? (r.verify.ok !== undefined ? r.verify.ok : null) : null }; }, db);
    await wait(p, 600);
    // 재현검증 결과 창 등 떠 있는 창은 닫는다
    await p.evaluate(() => { document.querySelectorAll('.modal,.overlay,.dlg-backdrop').forEach((e) => { if (e.offsetParent !== null) e.style.display = 'none'; }); });
    await p.evaluate(pageLib);

    if (EVAL) {
      const r = await p.evaluate((src) => { try { const v = (0, eval)(src); return { ok: true, v: JSON.parse(JSON.stringify(v === undefined ? null : v)) }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } }, EVAL);
      process.stdout.write(JSON.stringify(r, null, 1) + '\n');
      return;
    }

    fs.mkdirSync(OUT, { recursive: true });
    for (const f of fs.readdirSync(OUT)) if (/^\d{3}_.*\.txt$|^목차\.txt$/.test(f)) fs.unlinkSync(path.join(OUT, f));
    const baseYm = ver.info.baseYm;
    const yms = YMS.length ? YMS : [await p.evaluate(() => S.ym)];
    const idx = [];
    let n = 0, stop = false;
    const seenShot = new Set();
    const deadline = t0 + LIMIT_MIN * 60000;
    const settle = async () => { await wait(p, 250); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)))); };
    const shoot = async (ym) => {
      const s = await p.evaluate(() => window.__eq.screen());
      if (!s.tables.length) return;
      const key = s.where + '|' + s.ym + '|' + s.tables.map((t) => t.title + t.rows.length).join(',');
      if (seenShot.has(key)) return;
      seenShot.add(key);
      n++;
      const name = String(n).padStart(3, '0') + '_' + safe(s.where) + (s.ym ? '_' + s.ym : '') + '.txt';
      const body = ['위치: ' + s.where + (s.ym ? ' · ' + s.ym : ''), '(엔진 ' + ver.info.sysVer + '이 계산해 보여 준 표 그대로. 표는 탭 구분)', '']
        .concat(s.tables.map((t) => '「' + t.title + '」\n' + t.rows.join('\n'))).join('\n\n');
      fs.writeFileSync(path.join(OUT, name), body);
      idx.push(name + '\t' + s.where + (s.ym ? ' · ' + s.ym : '') + '\t' + s.tables.map((t) => t.title + '(' + t.rows.length + '행)').join(' / '));
    };
    for (const ym of yms) {
      for (const z of await p.evaluate(() => window.__eq.tabs('.zonecard'))) {
        if (stop) break;
        await p.evaluate((a) => window.__eq.click('.zonecard', a.oc, a.t), z); await settle();
        for (const s of await p.evaluate(() => window.__eq.tabs('.site-tab'))) {
          if (stop) break;
          if (!/switchSite\(/.test(s.oc)) continue; // 「추정자료취합」 같은 이동 버튼은 건너뜀
          if (ONLY && s.t.indexOf(ONLY) < 0 && z.t.indexOf(ONLY) < 0) continue;
          await p.evaluate((a) => window.__eq.click('.site-tab', a.oc, a.t), s); await settle();
          for (const m of await p.evaluate(() => window.__eq.tabs('.menu-tab'))) {
            if (Date.now() > deadline) { stop = true; break; }
            await p.evaluate((a) => window.__eq.click('.menu-tab', a.oc, a.t), m); await settle();
            if (await p.evaluate((a) => window.__eq.setYm(a[0], a[1]), [ym, CONF_YM])) await settle();
            const subs = await p.evaluate(() => window.__eq.tabs('.subtab'));
            if (!subs.length) { await shoot(ym); continue; }
            for (const sb of subs) {
              if (Date.now() > deadline) { stop = true; break; }
              if (!(await p.evaluate((a) => window.__eq.click('.subtab', a.oc, a.t), sb))) continue;
              await settle();
              await shoot(ym);
            }
          }
        }
      }
    }
    const head = ['엔진 조회 목차 — 자료 「' + (ver.info.author || '') + '」 기준월 ' + baseYm + ' · 엔진 ' + ver.info.sysVer + ' · 고른 달 ' + yms.join(',')
      + ' · 화면 ' + n + '개 · ' + Math.round((Date.now() - t0) / 1000) + '초' + (stop ? ' ※ 시간 한도(' + LIMIT_MIN + '분)로 일부만' : ''),
    '파일\t위치\t표(행 수)'];
    fs.writeFileSync(path.join(OUT, '목차.txt'), head.concat(idx).join('\n') + '\n');
    console.log('화면 ' + n + '개 → ' + OUT + (stop ? ' (시간 한도로 일부만)' : ''));
  } finally {
    await browser.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* 무시 */ }
  }
})().catch((e) => { console.error('엔진 조회 실패:', e && e.message || e); process.exit(1); });
