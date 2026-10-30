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

  window.SonikBizplan = { capture, makeHtml, shell, offlineFlag, extras, applyAnnual, applyPlan, isBiz, planYearOf };
})();
