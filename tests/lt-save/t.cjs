// node tests/lt-save/t.cjs — 사업계획 중장기 화면에서 웹 저장 시험. 가짜 엔진(중장기 자료 바꿔 끼우기는 실제 엔진과 같은 방식)·가짜 Supabase(실데이터 없음)
// 2026-11-17 hong 「이거 왜이래? 문제가 생겼어」: 중장기 화면에서 저장한 판이 차년도 자리에 중장기(2028~2032) 자료로 저장됨(기준월 2028-12)
//  ① 중장기 화면에서 저장해도 저장본 = 차년도 자료(기준월 2027-01, 확정DB·사업계획 DB 도 차년도) · 중장기에서 고치던 값은 중장기 자료에 남음
//  ② 저장 뒤에도 중장기 화면 그대로(화면이 차년도로 튕기지 않음)
//  ③ 「⤵ 반영」(최신 저장본 합치기)도 차년도 자료로 합침 — 화면 위치(ym 2028-12 등)가 차년도 자료에 들어가지 않음
//  ④ 두 번째 안전장치: 저장할 자료의 기준월이 사업계획과 다르면 덮어쓰지 않음
//  ⑤ 목록 「이전 저장」으로 잘못 저장한 판 되돌리기(백업본 열기 → 저장 = 새 사업계획)
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'../..'), HERE=__dirname, HONG='kongdang2@gmail.com';
const now=()=>new Date().toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'}],sk_engines:[],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[]};
const FILES={};
const eng=fs.readFileSync(HERE+'/engine.html','utf8');
FILES['engines/e.html.gz']=zlib.gzipSync(eng);
DB.sk_engines.push({ver:'v395-1',storage_path:'engines/e.html.gz',sha256:crypto.createHash('sha256').update(eng).digest('hex'),is_current:true,uploaded_at:now()});
const months=['2027-01','2027-02','2027-12'];
const bizDb=(val)=>({format:'pnl-db/1',scope:'all',sysVer:'v395-1',mode:'bizplan',baseYm:'2027-01',months,bizplanYear:2027,bizPrev:null,planDb:null,linkSonik:null,
 payload:{session:{baseYm:'2027-01',baseYear:2027,months},menu:'overview',val},confirmed:{c:'main'},plan:null});
FILES['snapshots/b27/r1.json.gz']=zlib.gzipSync(JSON.stringify(bizDb(7)));
DB.sk_snapshots.push({id:'b27',base_ym:'2027-01',engine_ver:'v395-1',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'2027 사업계획 2차',storage_path:'snapshots/b27/r1.json.gz',size_bytes:1,rev:1,created_at:'2026-11-16T01:00:00Z',updated_at:'2026-11-16T01:00:00Z'});
const saved=()=>{const s=DB.sk_snapshots.find(r=>r.id==='b27');return {rev:s.rev,db:JSON.parse(zlib.gunzipSync(FILES[s.storage_path]))};};
function srv(j){const m=JSON.parse(j);
 if(m.kind==='up'){if(FILES[m.path]&&!m.upsert)return {error:{message:'exists'}};FILES[m.path]=Buffer.from(m.data,'base64');return {error:null};}
 if(m.kind==='down'){return FILES[m.path]?{data:FILES[m.path].toString('base64')}:{error:{message:'missing '+m.path}};}
 if(m.kind==='rm'){m.paths.forEach(p=>delete FILES[p]);return {error:null};}
 if(m.kind==='rpc'){const a=m.a;if(m.fn!=='sk_overwrite_snapshot')return {data:null,error:null};
  const s=DB.sk_snapshots.find(r=>r.id===a.p_id);if(!s)return {error:{message:'NOT_FOUND'}};
  if(s.rev!==a.p_expected_rev)return {error:{message:'CONFLICT:'+s.rev}};
  DB.sk_snapshot_revs.push({snapshot_id:s.id,rev:s.rev,storage_path:s.storage_path,saved_at:s.updated_at});
  Object.assign(s,{storage_path:a.p_path,size_bytes:a.p_size,rev:s.rev+1,updated_at:now(),last_saved_by:m.me,last_saved_name:'hong'});return {data:{rev:s.rev,prune:[]},error:null};}
 const T=DB[m.table]||(DB[m.table]=[]);let op='select',payload=null,single=false,lim=null,ord=null;const f=[];
 for(const [k,a] of m.ops){if(k==='insert'||k==='update'||k==='upsert'){op=k;payload=a[0];}else if(k==='delete')op='delete';else if(k==='eq')f.push(r=>r[a[0]]===a[1]);else if(k==='in')f.push(r=>a[1].includes(r[a[0]]));
  else if(k==='like'){const pre=String(a[1]).replace(/%$/,'');f.push(r=>String(r[a[0]]||'').startsWith(pre));}
  else if(k==='maybeSingle'||k==='single')single=true;else if(k==='limit')lim=a[0];else if(k==='order')ord=[a[0],a[1]&&a[1].ascending];}
 if(op==='insert'||op==='upsert'){(Array.isArray(payload)?payload:[payload]).forEach(p=>{const r=Object.assign({created_at:now()},p);if(m.table==='sk_snapshots'){r.rev=r.rev||1;r.updated_at=r.created_at;}T.push(r);});return {data:null,error:null};}
 if(op==='update'){T.filter(r=>f.every(g=>g(r))).forEach(r=>Object.assign(r,payload));return {data:null,error:null};}
 if(op==='delete'){DB[m.table]=T.filter(r=>!f.every(g=>g(r)));return {data:null,error:null};}
 let out=T.filter(r=>f.every(g=>g(r))).map(r=>Object.assign({},r));if(ord)out.sort((a,b)=>(a[ord[0]]<b[ord[0]]?-1:a[ord[0]]>b[ord[0]]?1:0)*(ord[1]?1:-1));if(lim)out=out.slice(0,lim);
 return {data:single?(out[0]||null):out,error:null};}
const PORT=8794;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 let fp=u==='/mock.js'?path.join(REPO,'tests/two-window/mock.js'):REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 const ct={'.js':'text/javascript','.html':'text/html','.css':'text/css','.txt':'text/plain'}[path.extname(fp)]||'application/octet-stream';
 res.writeHead(200,{'content-type':ct+'; charset=utf-8'});res.end(body);}).listen(PORT);
let pass=0,fail=0;const ok=(c,m,extra)=>{if(c){pass++;console.log('ok  ',m);}else{fail++;console.log('FAIL',m,extra!==undefined?JSON.stringify(extra):'');}};
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:1400,height:900}});
 const errs=[];
 const idle=async(p)=>{await p.waitForTimeout(150);await p.waitForFunction(()=>document.getElementById('busy').hidden,null,{timeout:30000});};
 const fr=(p)=>p.frames().find(f=>f!==p.mainFrame());
 const T=(p,code,arg)=>fr(p).evaluate(code,arg);
 const toastTxt=(p)=>p.evaluate(()=>{const t=document.getElementById('toast');return t.hidden?'':t.textContent;});
 const P=await ctx.newPage();await P.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
 P.on('pageerror',e=>errs.push(e.message));P.on('console',m=>{if(m.type()==='error'&&!/favicon|404|Failed to load/.test(m.text()))errs.push('console: '+m.text());});
 await P.addInitScript(()=>{try{localStorage.setItem('sk_tab','bizplan');}catch(_){}});
 await P.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(HONG));
 await P.waitForSelector('[data-open="b27"]',{timeout:20000});await P.click('[data-open="b27"]');await idle(P);await P.waitForTimeout(300);
 ok(await T(P,()=>T.S().session.baseYm)==='2027-01','열기 = 차년도 2027-01');
 // ① 중장기 화면으로 가서 값을 고치는 중에 저장
 await T(P,()=>{switchZone('lt');T.edit(1234);});
 ok(await T(P,()=>T.lt()&&T.S().session.baseYm==='2028-12'),'중장기 화면 = 엔진 S 가 2028-12 자료');
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(300);
 let sv=saved();
 ok(sv.rev===2,'저장됨(판 2)',sv.rev);
 ok(sv.db.baseYm==='2027-01'&&sv.db.payload.session.baseYm==='2027-01'&&sv.db.payload.val===7,'① 저장본 = 차년도 자료(기준월 2027-01, 값 7) — 중장기 자료(2028-12, 999)가 아님',{baseYm:sv.db.baseYm,s:sv.db.payload.session.baseYm,val:sv.db.payload.val});
 ok(sv.db.confirmed&&sv.db.confirmed.c==='main','① 확정DB 도 차년도 것',sv.db.confirmed);
 ok(sv.db.planDb&&sv.db.planDb.baseYm==='2027-01'&&sv.db.planDb.val===7,'① 사업계획 DB(손익추정 차이분석 계획)도 차년도 것',sv.db.planDb);
 ok(sv.db.payload.ltPlan&&sv.db.payload.ltPlan.S&&sv.db.payload.ltPlan.S.val===1234&&sv.db.payload.ltPlan.S.session.baseYm==='2028-12','① 중장기에서 고치던 값(1234)은 저장본의 중장기 자료에 들어감',sv.db.payload.ltPlan&&sv.db.payload.ltPlan.S);
 ok(await T(P,()=>T.lt()&&T.S().val===1234&&T.S().session.baseYm==='2028-12'),'② 저장 뒤에도 중장기 화면 그대로(고친 값 유지)');
 ok(/저장했습니다/.test(await toastTxt(P)),'저장 알림',await toastTxt(P));
 // ③ 다른 창이 차년도 값을 8 로 저장 → 중장기 화면에서 「⤵ 반영」
 {const s=DB.sk_snapshots.find(r=>r.id==='b27');const d=JSON.parse(JSON.stringify(sv.db));d.payload.val=8;const p='snapshots/b27/r3.json.gz';FILES[p]=zlib.gzipSync(JSON.stringify(d));
  DB.sk_snapshot_revs.push({snapshot_id:'b27',rev:s.rev,storage_path:s.storage_path,saved_at:s.updated_at});Object.assign(s,{storage_path:p,rev:3,updated_at:now(),last_saved_by:'other@x',last_saved_name:'other'});}
 await P.evaluate(()=>{const b=document.getElementById('btnMerge');b.hidden=false;});await P.click('#btnMerge');await idle(P);await P.waitForTimeout(300);
 const after=await T(P,()=>({lt:T.lt(),base:T.S().session.baseYm,ym:T.S().ym,val:T.S().val,lt2:T.S().ltPlan&&T.S().ltPlan.S&&T.S().ltPlan.S.val}));
 ok(after.base==='2027-01'&&after.val===8&&after.ym!=='2028-12'&&!after.lt,'③ 반영 = 차년도 자료에 합침(기준월 2027-01, 값 8, 화면 ym 2028-12 안 섞임), 화면은 차년도로',after);
 // ④ 저장할 자료의 기준월이 다르면 덮어쓰지 않음
 await T(P,()=>T.bad(true));const r0=saved().rev;
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(300);
 ok(saved().rev===r0,'④ 기준월이 다른 자료는 덮어쓰지 않음',[r0,saved().rev]);
 ok(/저장하지 않았습니다/.test(await toastTxt(P)),'④ 안내',await toastTxt(P));
 await T(P,()=>T.bad(false));
 // ⑤ 잘못 저장한 판 되돌리기: 목록의 「이전 저장」(11-03 뺐다가 11-17 되살림) → 판 고르기 → 백업본으로 열림 → 저장 = 새 사업계획
 await P.click('#btnBack');await P.waitForSelector('#modal:not([hidden])');await P.click('#mOk');await P.waitForSelector('[data-bk="b27"]',{timeout:20000});
 ok(true,'⑤ 목록에 「이전 저장」 단추 있음');
 await P.click('[data-bk="b27"]');await P.waitForSelector('#mBody [data-rev="2"]',{timeout:10000});
 const revs=await P.evaluate(()=>[...document.querySelectorAll('#mBody [data-rev]')].map(b=>b.getAttribute('data-rev')));
 ok(revs.join(',')==='2,1','⑤ 남은 이전 저장 = 판 2·1 (지금 판 3 은 빼고)',revs);
 await P.click('#mBody [data-rev="2"]');await idle(P);await P.waitForTimeout(300);
 const ctxT=await P.evaluate(()=>document.getElementById('ctx').textContent);
 ok(/백업본/.test(ctxT),'⑤ 백업본으로 열림',ctxT);
 ok(await T(P,()=>T.S().session.baseYm==='2027-01'&&T.S().val===7),'⑤ 판 2 내용(값 7)');
 const n0=DB.sk_snapshots.length;
 await P.click('#btnSave');await P.waitForSelector('#memoIn');await P.fill('#memoIn','2027 사업계획 2차 (되살림)');await P.click('#mOk');await idle(P);await P.waitForTimeout(300);
 const nw=DB.sk_snapshots.find(r=>r.memo==='2027 사업계획 2차 (되살림)');
 ok(DB.sk_snapshots.length===n0+1&&nw&&JSON.parse(zlib.gunzipSync(FILES[nw.storage_path])).payload.val===7,'⑤ 저장 = 새 사업계획(판 2 내용), 원래 것은 그대로',nw&&nw.memo);
 console.log('errs',errs);ok(errs.length===0,'페이지 오류 없음');
 console.log(`lt-save: ${pass} pass, ${fail} fail`);await br.close();server.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
