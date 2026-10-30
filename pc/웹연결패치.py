# -*- coding: utf-8 -*-
"""웹 연결 패치(웹 시험판 vNNN-n): 오프라인 운영본 vNNN(v312까지 10초·일반 두 파일, v313부터 운영본 한 파일) + 웹 버전 연결(엔진이 웹 페이지 안에서 열릴 때만 동작).

검증자료\\v309-1\\patch.py 와 같은 내용을 버전·날짜만 인자로 받게 한 것. 웹엔진갱신.cjs 가 운영본이 바뀌면 부른다.
웹판은 정규화 전까지 오프라인 번호와 따로 관리한다(오프라인 vNNN 위에 -1, -2…, 웹테스트\\README.md).

- window.__sonikWebBridge: 웹 페이지가 스냅샷(pnl-db/1 전체)을 확인창 없이 불러오고(applyDb), 현재 작업을 같은 형식으로 만들어 받는다(buildDb).
- window.__SONIK_WEB__ 가 켜진 경우에만 Ctrl+S·저장을 「웹 스냅샷 저장」으로 돌린다. PC 파일(file://)에서는 동작이 바뀌지 않는다.
- 웹 스냅샷(buildDb)에 사업계획 계획DB(PLAN_DB)도 담고, 불러올 때(applyDb) 되살린다. PC 「DB 내보내기」 파일에는 없으니 계획DB는 웹에서 한 번 탑재·저장하면 이후 따라다닌다.
- 「DB 내보내기」 파일에 시스템 버전(sysVer)을 함께 적는다.
- 계산 로직·데이터·<title>·script 블록 수 불변(assert).

사용 (손익추정시스템 루트에서):
  python -I 웹테스트/웹연결패치.py --ver v310-1 --basever v310 --date 20261031 --base10 <운영본 10초> --base <일반본> --out 웹테스트
  python -I 웹테스트/웹연결패치.py --ver v313-1 --basever v313 --date 20261101 --base <운영본> --out 웹테스트   (v313부터, 한 파일 → 손익추정_웹연결_v313-1_날짜.html)
"""
import argparse, os, re



def read(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()


def write(p, t):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(t)


def blocks(t):
    return [m.span(2) for m in re.finditer(r'(<script\b[^>]*>)(.*?)</script>', t, re.S)]


OLD1 = r'''  window.importEstimateDb = async function(input){
'''
NEW1 = r'''  /* [@VER@] 웹 버전 연결 — 웹 페이지(로그인 화면)가 이 엔진을 띄울 때 쓰는 통로.
     PC 파일에서는 부르는 곳이 없고, 저장 가로채기는 window.__SONIK_WEB__ 가 있을 때만 켠다. */
  function pnlSysVer(){
    try{ var t=(window.SYS_CHANGELOG&&window.SYS_CHANGELOG[0]&&window.SYS_CHANGELOG[0].title)||''; var m=/^v\d+(?:-\d+)?/.exec(t); return m?m[0]:null; }catch(_){ return null; }
  }
  window.__sonikWebBridge={
    info:function(){
      return {sysVer:pnlSysVer(), engineVer:pnlEngineVer(), mode:(window.__BIZPLAN__?'bizplan':'sonik'),
              baseYm:pnlSessYm(), author:(S.session&&S.session.name)||'', empty:!!window.__EMPTY_ENGINE__};
    },
    /* 현재 작업 → pnl-db/1 전체(확정+추정+검증기준). 「DB 내보내기 ▸ 전체」와 같은 내용 */
    buildDb:function(){
      try{ if(typeof commitActiveEditBeforeSave==='function') commitActiveEditBeforeSave(); }catch(_){}
      var verify=pnlBuildVerify();
      return {
        format:'pnl-db/1', scope:'all', engineVer:pnlEngineVer(), sysVer:pnlSysVer(),
        mode:(window.__BIZPLAN__?'bizplan':'sonik'),
        appVersion:(S.session&&S.session.version)||null,
        baseYm:pnlSessYm(),
        estimatedAt:(S.session&&S.session.estimatedAt)||null,
        savedAt:new Date().toISOString(),
        author:(S.session&&S.session.name)||'',
        months:(S.session&&S.session.months)||[],
        payload:pnlDbPayload(),
        confirmed:(typeof CONFIRMED_DB!=='undefined' && CONFIRMED_DB)?JSON.parse(JSON.stringify(CONFIRMED_DB)):null,
        plan:(typeof PLAN_DB!=='undefined' && PLAN_DB)?JSON.parse(JSON.stringify(PLAN_DB)):null,   /* 사업계획 계획DB(빈 엔진엔 없음) — 웹 스냅샷이 함께 들고 다닌다 */
        verify:verify
      };
    },
    /* pnl-db/1 전체 → 확인창 없이 복원(「DB 불러오기 ▸ 전체 복원」과 같은 처리) 후 재현검증 */
    applyDb:function(db){
      if(!db||db.format!=='pnl-db/1'||!db.payload||!db.confirmed) throw new Error('pnl-db/1 전체(확정+추정) 스냅샷이 아닙니다');
      var curMode=(window.__BIZPLAN__?'bizplan':'sonik');
      if(db.mode && db.mode!==curMode) throw new Error('모드 불일치: 스냅샷 '+db.mode+' / 엔진 '+curMode);
      var keepVers=S._versions;
      Object.keys(S).forEach(function(k){ delete S[k]; });
      Object.assign(S, JSON.parse(JSON.stringify(db.payload)));
      if(keepVers) S._versions=keepVers;
      if(!S.site) S.site='onsan';
      if(!S.menu) S.menu='price';
      if(!S.ym)   S.ym=(db.baseYm||(S.session.baseYear+'-'+pnlPad(S.session.baseMonth)));
      if(typeof CONFIRMED_DB!=='undefined' && CONFIRMED_DB){
        Object.keys(CONFIRMED_DB).forEach(function(k){ delete CONFIRMED_DB[k]; });
        Object.assign(CONFIRMED_DB, db.confirmed);
      }
      /* 계획DB: 스냅샷에 있으면 그것으로(브라우저 임시저장엔 쓰지 않음), 없으면 지금 것 유지 */
      if(db.plan && typeof PLAN_DB!=='undefined'){ PLAN_DB=JSON.parse(JSON.stringify(db.plan)); }
      try{ if(window.__dbBustCalcCaches) window.__dbBustCalcCaches(); if(window.__perfV17Bust) window.__perfV17Bust(); }catch(_){}
      if(typeof switchSite==='function'){ try{ switchSite(S.site); }catch(e){} }
      pnlRefreshAll();
      var res=null;
      if(db.verify){ res=pnlDiffVerify(db.verify, pnlBuildVerify()); pnlShowVerifyReport(res, db); }
      return {verify:res};
    }
  };
  if(window.__SONIK_WEB__){
    var pnlWebSave=function(){ try{ window.parent.postMessage({type:'sonik:save'}, '*'); }catch(_){} };
    window.saveToCurrentFile=pnlWebSave;
    window.smartSave=pnlWebSave;
  }

  window.importEstimateDb = async function(input){
'''

EDITS = [('web_bridge', OLD1, NEW1)]

OLD2 = r'''        engineVer:pnlEngineVer(),                                  /* [v194] 엔진(수정이력) 버전 */
'''
NEW2 = r'''        engineVer:pnlEngineVer(),                                  /* [v194] 엔진(수정이력) 버전 */
        sysVer:pnlSysVer(),                                        /* [@VER@] 시스템 버전(vNNN 또는 웹판 vNNN-n) — 웹 스냅샷 목록·엔진 대조용 */
'''
EDITS += [('export_sysver', OLD2, NEW2)]

CHANGELOG = " {date:'@DATE@',title:'@VER@ 웹 버전 연결(웹 시험판)',detail:[{h:'웹 페이지에서 열기',b:['웹 시험판입니다. 오프라인 운영본(@BASE@)과 계산·데이터는 같고, 웹 페이지에서 열릴 때 쓰는 연결 통로만 더했습니다.','로그인하는 웹 페이지가 이 엔진을 띄워 스냅샷(DB 내보내기 ▸ 전체와 같은 내용)을 확인창 없이 불러옵니다. 불러온 뒤 손익 재현검증 결과를 PC와 같게 보여 줍니다.','웹 페이지 안에서는 Ctrl+S·저장이 「웹 스냅샷 저장」(내 웹 스냅샷 덮어쓰기, 이전 3개 보관)으로 바뀝니다. PC 파일에서 여는 경우에는 저장·계산 동작이 바뀌지 않습니다.']}]},"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ver', required=True)       # 웹판 번호, 예 v310-1
    ap.add_argument('--basever', required=True)   # 기반 오프라인 번호, 예 v310
    ap.add_argument('--date', required=True)      # 파일 이름 날짜 YYYYMMDD
    ap.add_argument('--base10')                  # v312까지의 10초본. v313부터는 빼고 --base 에 운영본 하나
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', default='.')
    a = ap.parse_args()
    assert re.fullmatch(r'v\d+-\d+', a.ver) and re.fullmatch(r'v\d+', a.basever) and re.fullmatch(r'\d{8}', a.date), 'ver/basever/date 형식'
    d = a.date[:4] + '-' + a.date[4:6] + '-' + a.date[6:]
    sub = lambda x: x.replace('@VER@', a.ver).replace('@BASE@', a.basever).replace('@DATE@', d)
    edits = [(tag, old, sub(new)) for tag, old, new in EDITS]
    cl = sub(CHANGELOG)
    NAME10 = '손익추정_10초_웹연결_' + a.ver + '_' + a.date + '.html'
    NAMEG = '손익추정_웹연결_' + a.ver + '_' + a.date + '.html'
    for src, name in (((a.base10, NAME10), (a.base, NAMEG)) if a.base10 else ((a.base, NAMEG),)):
        t = read(src)
        crlf = t.count('\r\n')
        nl = '\r\n' if crlf else '\n'
        if crlf:
            assert crlf == t.count('\n') == t.count('\r'), 'mixed newlines'
        fx = (lambda s: s.replace('\r\n', '\n').replace('\n', nl))
        nb = len(blocks(t))
        out = t
        for tag, old, new in edits + [('changelog', "window.SYS_CHANGELOG = [\n", "window.SYS_CHANGELOG = [\n" + cl + "\n")]:
            old, new = fx(old), fx(new)
            c = out.count(old)
            assert c == 1, (name, tag, c)
            out = out.replace(old, new)
        assert t.count('__sonikWebBridge') == 0, (name, '이미 웹 연결이 들어 있는 파일')
        assert len(blocks(out)) == nb, (name, 'script blocks')
        for k in ('__SAVED_DATA__', '__SAVED_CONFIRMED__', '__LINK_STAMP__'):
            assert t.count(k) == out.count(k), (name, k)
        assert re.search(r'<title>.*?</title>', t, re.S).group(0) == re.search(r'<title>.*?</title>', out, re.S).group(0)
        write(os.path.join(a.out, name), out)
        print(name, len(out.encode('utf-8')), 'crlf' if crlf else 'lf', nb)


if __name__ == '__main__':
    main()
