// 사업계획(웹): 손익추정 엔진에서 사업계획 시스템을 만들어 웹에서 바로 열고, 손익추정 ↔ 사업계획 자료를 웹 저장본끼리 주고받는다(hong 2026-10-30).
// 엔진 계산·화면은 건드리지 않는다. 엔진에 이미 있는 기능(📘 사업계획 시스템 다운로드 · 사업계획 DB 내보내기 · 연간 비교자료)을
// 그대로 부르고, 파일로 내려받는 대신 그 결과를 받아 쓴다. 엔진 쪽 정리(만들기/내려받기 분리)는 오프라인 v313 후보.
(function () {
  // 엔진 함수가 내려받기(a.download + blob 주소)를 하는 순간 그 blob 을 가로챈다. 실제 다운로드는 일어나지 않는다
  async function capture(win, run) {
    const U = win.URL, A = win.HTMLAnchorElement.prototype;
    const origCreate = U.createObjectURL, origClick = A.click, blobs = new Map();
    let got = null;
    U.createObjectURL = function (b) { const u = origCreate.call(U, b); blobs.set(u, b); return u; };
    A.click = function () { if (this.download && blobs.has(this.href)) { got = { name: this.download, blob: blobs.get(this.href) }; return; } return origClick.call(this); };
    try { run(); } finally {
      U.createObjectURL = origCreate; A.click = origClick;
      const t = win.document.getElementById('toast'); if (t) t.classList.remove('show'); // 「다운로드 완료」 안내는 지운다
    }
    if (!got) return null;
    return { name: got.name, text: await got.blob.text() };
  }
  const isBiz = (win) => !!(win && win.__BIZPLAN__);
  const planYearOf = (db) => (db && db.meta && (db.meta.planYear || (db.meta.months && String(db.meta.months[0] || '').slice(0, 4)))) || null;

  // 손익추정 엔진(자료가 들어 있는 상태) → 사업계획 시스템 HTML (「📘 사업계획 시스템 다운로드」와 같은 결과)
  async function makeHtml(win) {
    if (typeof win.downloadBizplanEngine !== 'function') throw new Error('이 엔진에는 사업계획 시스템 만들기가 없습니다');
    const r = await capture(win, () => win.downloadBizplanEngine());
    if (!r || !/id=["']__BIZPLAN_FLAG__["']/.test(r.text)) throw new Error('사업계획 시스템을 만들지 못했습니다(엔진 안내를 확인하세요)');
    return r.text;
  }
  // 웹 빈 엔진 → 사업계획 모드 엔진. 웹에 저장한 사업계획을 다시 열 때 쓴다(자료는 저장본이 채운다).
  // 생성 파일과 같은 표시를 머리 맨 앞에 넣는다: __BIZPLAN_FLAG__ + 빈 확정DB(손익추정 확정DB와 분리).
  // 글자로 </head> 를 찾지 않는다(엔진 안 xlsx 코드에 그 글자가 들어 있다)
  function shell(engineHtml, planYear, prevYear) {
    const safe = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
    const h = engineHtml.replace(/<script id=["']__EMPTY_ENGINE_FLAG__["']>[\s\S]*?<\/script>/, '');
    const i = h.search(/<head[^>]*>/i); if (i < 0) throw new Error('엔진 HTML에 <head>가 없습니다');
    const j = h.indexOf('>', i) + 1;
    return h.slice(0, j) + '<script id="__BIZPLAN_FLAG__">window.__BIZPLAN__=' + safe({ planYear: +planYear, seed: null, prevYear: prevYear || null }) + ';</script>'
      + '<script id="__SAVED_CONFIRMED__">window.__CONFIRMED_DATA__={"onsan":{},"ulsan":{},"head":{}};</script>' + h.slice(j);
  }
  // 오프라인 파일(PC에서 여는 HTML): 엔진의 HTML 만들기는 사업계획 표시를 빼므로 다시 넣는다
  function offlineFlag(win, html) {
    const b = win.__BIZPLAN__, safe = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
    const i = html.search(/<head[^>]*>/i), j = html.indexOf('>', i) + 1;
    return html.slice(0, j) + '<script id="__BIZPLAN_FLAG__">window.__BIZPLAN__=' + safe({ planYear: +b.planYear, seed: null, prevYear: b.prevYear || null }) + ';</script>' + html.slice(j);
  }

  // 저장할 때 웹 저장본에 함께 싣는 연동 자료
  //  손익추정: annual = 올해 연간 비교자료(「연간 비교자료 내보내기」와 같은 pnl-annual-kpi) → 사업계획 「당해」 열·차이분석 전년
  //  사업계획: planDb = 「사업계획 DB 내보내기」와 같은 plan-db/1 → 손익추정 차이분석의 계획 / bizplanYear·bizPrev = 다시 열 때 모드·동봉 전년자료
  async function extras(win) {
    const out = {};
    if (isBiz(win)) {
      out.bizplanYear = +win.__BIZPLAN__.planYear;
      out.bizPrev = win.__BIZPLAN__.prevYear || null;
      try { const r = await capture(win, () => win.exportPlanDb()); out.planDb = r ? JSON.parse(r.text) : null; } catch (_) { out.planDb = null; }
    } else {
      try { const S = win.eval('S'); out.annual = win.p88PackYear(+S.session.baseYear); } catch (_) { out.annual = null; }
    }
    return out;
  }
  // 사업계획에 손익추정 연간 비교자료 넣기(「전년 연간 비교자료 불러오기」와 같은 처리). 연도가 계획연도-1 이 아니면 넣지 않는다
  function applyAnnual(win, o) {
    if (!isBiz(win) || !o || o.kind !== 'pnl-annual-kpi' || !o.stores) return false;
    if (+o.year !== +win.__BIZPLAN__.planYear - 1) return false;
    const S = win.eval('S');
    S._bvPrev = JSON.parse(JSON.stringify(o)); delete S._annual88;
    try { if (typeof win.renderVarView === 'function' && S.menu === 'h_analysis') win.renderVarView(); } catch (_) { /* 화면은 다음 이동 때 */ }
    return true;
  }
  // 손익추정에 사업계획 DB 넣기. v312부터는 연도별 보관(같은 연도만 교체), 그 전 엔진은 계획DB가 비었거나 같은 연도일 때만 넣는다
  function applyPlan(win, db) {
    if (isBiz(win) || !db || db.format !== 'plan-db/1' || !db.stores) return 'skip';
    const copy = JSON.parse(JSON.stringify(db));
    if (typeof win.planDbPut === 'function') win.planDbPut(copy);
    else {
      const cur = win.eval('typeof PLAN_DB==="undefined"?null:PLAN_DB');
      if (cur && String(planYearOf(cur)) !== String(planYearOf(db))) return 'other-year';
      win.__skPlanIn = copy; win.eval('PLAN_DB=window.__skPlanIn; delete window.__skPlanIn;');
      try { if (win.__dbBustCalcCaches) win.__dbBustCalcCaches(); if (win.__perfV17Bust) win.__perfV17Bust(); } catch (_) { /* 무시 */ }
    }
    try { const S = win.eval('S'); if (typeof win.renderVarView === 'function' && S.menu === 'h_analysis') win.renderVarView(); } catch (_) { /* 무시 */ }
    return 'ok';
  }

  // ── 연동 손익추정의 12월 값으로 다시 이어받기(hong 2026-11-02) ──
  // 손익추정이 갱신되면 사업계획을 처음부터 다시 만들지 않고, 그 손익추정의 직전 12월 값만 다시 넣는다.
  // 넣는 값은 「📘 새 사업계획」(엔진 「사업계획 시스템 다운로드」)이 처음 만들 때 넣는 것과 같다:
  //  ① 12월 기말재고 → 계획연도 1월 기초(온산 생산월보·원료/제품 수불부·기초재공, 울산 원료/제품 수불부·기초재공·생산 원단위)
  //  ② 12월 추정 입력(판매·구매·수율·원가 등) → 손익시뮬레이션 기준(직전 12월)
  //  ③ 그해 연간 실적·추정 → 버전 비교 「당해」 열
  // 계획 1~12월 입력·기준가격 입력은 그대로 둔다(기준가격은 빈 달만 12월 값으로 채움, 처음 만들 때와 같음)
  const SEED_STORES = { onsan: ['confirmedMatflow', 'confirmedProdFlow', 'confirmedFlow', 'confirmedPrice', 'confirmedMfg'], ulsan: ['confirmedUlsanMat', 'confirmedUlsanProdFlow', 'confirmedUlsanMfg'], head: ['confirmedLagSeed158'] };
  function scriptJson(html, id, prefix) {
    const tag = '<script id="' + id + '">' + prefix, i = html.indexOf(tag); if (i < 0) return null;
    const a = i + tag.length, b = html.indexOf(';</script>', a); if (b < 0) return null;
    try { return JSON.parse(html.slice(a, b)); } catch (_) { return null; }
  }
  async function seedPack(win, py) {
    let pk = null;
    try { // 새 사업계획 만들기와 똑같이 만든 뒤 그 안의 묶음을 꺼낸다(엔진은 계획연도 = 올해+1 로 만든다)
      const html = await makeHtml(win), f = scriptJson(html, '__BIZPLAN_FLAG__', 'window.__BIZPLAN__=');
      if (f && +f.planYear === +py && f.seed) pk = { seed: f.seed, prevYear: f.prevYear || null, confirmed: scriptJson(html, '__SAVED_CONFIRMED__', 'window.__CONFIRMED_DATA__=') };
    } catch (_) { /* 아래 직접 계산 */ }
    if (!pk) { // 계획연도가 올해+1 이 아니면 같은 엔진 함수를 그 연도로 직접 부른다
      const sd = win.bizExportSeed(py), di = win.bizDecInputFrom(win.eval('S'), (py - 1) + '-12');
      if (win._bizDecHasTxn(di)) sd.anchors.decInput = di;
      pk = { seed: sd.anchors, prevYear: null, confirmed: sd.confPayload };
    }
    try { pk.annual = win.p88PackYear(py - 1); } catch (_) { pk.annual = null; }
    return pk;
  }
  // 열린 사업계획(win)에 넣는다. 돌려주는 값 = 넣은 것 요약
  function applySeedPack(win, pk, srcLabel) {
    if (!isBiz(win)) throw new Error('사업계획이 아닙니다');
    if (win.__LT_ON) throw new Error('중장기계획 화면에서는 할 수 없습니다 — 차년도계획으로 돌아와서 하세요');
    const py = +win.__BIZPLAN__.planYear, pd = (py - 1) + '-12', out = { inv: 0, dec: 0, annual: false };
    const sd = pk.seed || {};
    ['mat', 'flow', 'pf', 'umat', 'upf'].forEach((k) => { out.inv += (sd[k] || []).length; });
    win._bizApplySeed(sd, py + '-01');
    // 1월 기초는 엔진이 직전 12월 「확정」 기말을 먼저 보므로 그 칸도 새 값으로 바꾼다(없어진 항목은 지운다)
    const CD = win.eval('CONFIRMED_DB'), conf = pk.confirmed || {};
    Object.keys(SEED_STORES).forEach((site) => SEED_STORES[site].forEach((store) => {
      const nv = conf[site] && conf[site][store] && conf[site][store][pd];
      CD[site] = CD[site] || {};
      if (nv) { CD[site][store] = CD[site][store] || {}; CD[site][store][pd] = JSON.parse(JSON.stringify(nv)); }
      else if (CD[site][store]) delete CD[site][store][pd];
    }));
    if (sd.decInput && win._bizDecHasTxn(sd.decInput)) { sd.decInput.src = srcLabel; out.dec = win._bizApplyDecInput(sd.decInput); }
    if (pk.prevYear && +pk.prevYear.year === py - 1) { win.__BIZPLAN__.prevYear = pk.prevYear; }
    if (pk.annual) out.annual = applyAnnual(win, pk.annual);
    try { if (win.__dbBustCalcCaches) win.__dbBustCalcCaches(); if (win.__perfV17Bust) win.__perfV17Bust(); } catch (_) { /* 무시 */ }
    ['refresh', 'saveToStorage', 'syncUndoBaseline'].forEach((fn) => { try { if (typeof win[fn] === 'function') win[fn](); } catch (_) { /* 무시 */ } });
    return out;
  }

  // 사업계획 화면의 관리자 도구 「🧩 빈 엔진 다운로드」: 엔진 함수는 사업계획 표시를 빼고 손익추정 빈 엔진을 만든다(hong 11/05 지적).
  // 웹에서는 같은 빈 엔진에 사업계획 표시(계획연도, 시드·자료 없음)를 다시 넣어 「사업계획 시스템 빈 엔진」으로 받게 한다.
  // 계산·화면 코드는 그대로(같은 엔진)라 수정 엔진 올리기에도 그대로 쓸 수 있다.
  function patchEmpty(win) {
    if (!isBiz(win) || typeof win.downloadEmptyEngine !== 'function' || win.downloadEmptyEngine.__biz) return false;
    const orig = win.downloadEmptyEngine;
    const fn = function () {
      if (typeof win.__buildEngineHtml !== 'function' || typeof win.__downloadHtml !== 'function') return orig.apply(this, arguments);
      try {
        const html = offlineFlag(win, win.__buildEngineHtml({ embedData: false, emptyEngine: true, stripAdminBar: false }));
        let v = ''; try { v = (win.eval('S').session || {}).version || ''; } catch (_) { /* 버전 모름 */ }
        win.__downloadHtml(html, '사업계획시스템_빈엔진_v' + v + '_' + win.__BIZPLAN__.planYear + '.html');
        if (typeof win.showToast === 'function') win.showToast('🧩 사업계획 시스템 빈 엔진 다운로드 완료 — 자료 없음, 열면 ' + win.__BIZPLAN__.planYear + '년 사업계획 화면으로 뜹니다.');
      } catch (e) { if (typeof win.showToast === 'function') win.showToast('빈 엔진 생성 실패: ' + e.message); console.error(e); }
    };
    fn.__biz = true;
    win.downloadEmptyEngine = fn;
    return true;
  }

  window.SonikBizplan = { capture, makeHtml, shell, offlineFlag, extras, applyAnnual, applyPlan, isBiz, planYearOf, seedPack, applySeedPack, patchEmpty };
})();
