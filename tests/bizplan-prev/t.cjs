// node tests/bizplan-prev/t.cjs — 사업계획 「당해」(전년 손익추정 연간 비교자료) 연동 시차 시험. 가짜 엔진·가짜 Supabase(실데이터 없음)
// hong 11-13 「연동하는 26년 손익을 수정하면 곧바로 연동이 안 되고 시차가 좀 있는 거 같은데」
//  ① 목록을 띄운 뒤 ’26년 손익추정이 다시 저장돼도, 그 목록에서 사업계획을 열면 최신 저장본의 값이 들어간다(예전: 목록이 기억한 이전 저장본)
//  ② 받은 즉시 지금 화면(차이분석이 아닌 메뉴)을 다시 그린다(예전: 메뉴를 옮겨야 보임) · 스크롤 그대로
//  ③ 열어 둔 사업계획: 다른 창에서 ’26년을 저장하면 바로 알림 + 「⟳ ’26년 다시 받기」 강조, 누르면 새 값 · 함께 여는 사람 명단에는 안 들어감
//  ④ 「🔗 연동 손익추정」 목록도 서버에서 다시 읽음(목록 뒤에 생긴 손익추정이 보임)
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'../..'), HERE=__dirname, HONG='kongdang2@gmail.com';
const now=()=>new Date().toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'}],sk_engines:[],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[]};
const FILES={};
const eng=fs.readFileSync(HERE+'/engine.html','utf8');
FILES['engines/e.html.gz']=zlib.gzipSync(eng);
DB.sk_engines.push({ver:'v377-1',storage_path:'engines/e.html.gz',sha256:crypto.createHash('sha256').update(eng).digest('hex'),is_current:true,uploaded_at:now()});
const months=[{ym:'2026-12',type:'estimate',active:true}];
const sonikDb=(val)=>({format:'pnl-db/1',scope:'all',sysVer:'v377-1',mode:'sonik',baseYm:'2026-12',months,payload:{session:{baseYm:'2026-12',baseYear:2026,months},menu:'overview',val},confirmed:{c:1},plan:null,annual:{kind:'pnl-annual-kpi',year:2026,stores:{v:val}}});
FILES['snapshots/s26/r1.json.gz']=zlib.gzipSync(JSON.stringify(sonikDb(100)));
DB.sk_snapshots.push({id:'s26',base_ym:'2026-12',engine_ver:'v377-1',mode:'sonik',source:'web',author_email:HONG,author_name:'hong',memo:'26년 추정',storage_path:'snapshots/s26/r1.json.gz',size_bytes:1,rev:1,created_at:'2026-11-12T01:00:00Z',updated_at:'2026-11-12T01:00:00Z'});
const bizDb={format:'pnl-db/1',scope:'all',sysVer:'v377-1',mode:'bizplan',baseYm:'2026-12',months,bizplanYear:2027,bizPrev:null,planDb:null,
 linkSonik:{id:'s26',memo:'26년 추정',synced:'2026-11-12T01:00:00Z'},
 payload:{session:{baseYm:'2026-12',baseYear:2026,months},menu:'overview',val:7,_bvPrev:{kind:'pnl-annual-kpi',year:2026,stores:{v:50}}},confirmed:{c:1},plan:null};
FILES['snapshots/b27/r1.json.gz']=zlib.gzipSync(JSON.stringify(bizDb));
DB.sk_snapshots.push({id:'b27',base_ym:'2026-12',engine_ver:'v377-1',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'2027 사업계획',storage_path:'snapshots/b27/r1.json.gz',size_bytes:1,rev:1,created_at:'2026-11-12T02:00:00Z',updated_at:'2026-11-12T02:00:00Z'});
// 다른 창에서 저장한 것처럼 서버 쪽 손익추정을 바꾼다(새 판 번호·새 파일)
function serverSave(id,val,at){const s=DB.sk_snapshots.find(r=>r.id===id);const p='snapshots/'+id+'/r'+(s.rev+1)+'.json.gz';FILES[p]=zlib.gzipSync(JSON.stringify(sonikDb(val)));
 Object.assign(s,{storage_path:p,rev:s.rev+1,updated_at:at||now(),last_saved_by:HONG,last_saved_name:'hong'});}
const SEL=[];
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
 if(m.table==='sk_snapshots'&&op==='select')SEL.push(m.ops.map(o=>o[0]).join(','));
 if(op==='insert'||op==='upsert'){(Array.isArray(payload)?payload:[payload]).forEach(p=>{const r=Object.assign({created_at:now()},p);if(m.table==='sk_snapshots'){r.rev=r.rev||1;r.updated_at=r.created_at;}T.push(r);});return {data:null,error:null};}
 if(op==='update'){T.filter(r=>f.every(g=>g(r))).forEach(r=>Object.assign(r,payload));return {data:null,error:null};}
 if(op==='delete'){DB[m.table]=T.filter(r=>!f.every(g=>g(r)));return {data:null,error:null};}
 let out=T.filter(r=>f.every(g=>g(r))).map(r=>Object.assign({},r));if(ord)out.sort((a,b)=>(a[ord[0]]<b[ord[0]]?-1:a[ord[0]]>b[ord[0]]?1:0)*(ord[1]?1:-1));if(lim)out=out.slice(0,lim);
 return {data:single?(out[0]||null):out,error:null};}
const PORT=8793;
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
 const T=(p,code)=>fr(p).evaluate(code);
 const toastTxt=(p)=>p.evaluate(()=>{const t=document.getElementById('toast');return t.hidden?'':t.textContent;});
 const btn=(p)=>p.evaluate(()=>{const b=document.getElementById('btnPrevRe');return {hidden:b.hidden,text:b.textContent,warn:b.classList.contains('warn')};});
 async function page(tab){const p=await ctx.newPage();await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
  p.on('pageerror',e=>errs.push(tab+': '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/favicon|404|Failed to load/.test(m.text()))errs.push(tab+' console: '+m.text());});
  await p.addInitScript((t)=>{try{localStorage.setItem('sk_tab',t);}catch(_){}} ,tab);
  await p.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(HONG));return p;}
 // ① 목록을 먼저 띄워 두고(’26년 r1 을 기억), 그 뒤 다른 창이 ’26년을 저장(r2, 값 200)
 const P=await page('bizplan');await P.waitForSelector('[data-open="b27"]',{timeout:20000});
 serverSave('s26',200,'2026-11-13T00:00:00Z');
 await P.click('[data-open="b27"]');await idle(P);await P.waitForTimeout(300);
 let tx=await T(P,()=>T.text());const pv=await T(P,()=>T.S()._bvPrev.stores.v);
 ok(pv===200,'① 열면 목록이 기억한 이전 저장본(100)이 아니라 최신 저장본(200)을 받음',pv);
 ok(tx==='menu=overview prev='+pv+' val=7','② 차이분석이 아닌 지금 화면(overview)도 받은 값으로 바로 다시 그림(메뉴 이동 없이)',[tx,pv]);
 ok(/「26년 추정」.*「당해」 비교자료로 넣었습니다/.test(await toastTxt(P)),'열 때 알림 = 최신 저장본 이름·시각',await toastTxt(P));
 let b=await btn(P);ok(!b.hidden&&b.text==='⟳ ’26년 다시 받기'&&!b.warn,'「⟳ ’26년 다시 받기」 단추 보임(강조 없음)',b);
 // ③ 다른 창(Q)에서 ’26년 손익추정을 열어 값 300 으로 저장 → P 에 바로 알림·단추 강조
 const Q=await page('sonik');await Q.waitForSelector('[data-open="s26"]',{timeout:20000});await Q.click('[data-open="s26"]');await idle(Q);await Q.waitForTimeout(1800);
 const qctx=await Q.evaluate(()=>document.getElementById('ctx').textContent);
 ok(!/함께 여는 중/.test(qctx),'③ 사업계획(P)이 ’26년 저장 알림만 들음 — ’26년 쪽 「함께 여는 중」에 안 나옴',qctx);
 await T(Q,()=>T.val(300));await Q.click('#btnSave');await idle(Q);await Q.waitForTimeout(500);
 const s26=DB.sk_snapshots.find(r=>r.id==='s26');ok(s26.rev===3,'Q 저장 = 판 3',s26.rev);
 await P.waitForTimeout(400);b=await btn(P);const tt=await toastTxt(P);
 ok(b.warn&&!b.hidden,'③ P: 다른 창 저장 직후 단추 강조',b);
 ok(/다시 저장했습니다/.test(tt)&&/’26년 다시 받기/.test(tt),'③ P: 바로 알림',tt);
 tx=await T(P,()=>T.text());ok(/prev=200/.test(tx),'③ 누르기 전에는 화면을 갑자기 바꾸지 않음',tx);
 // 스크롤 위치 유지 + 누르면 새 값
 const y0=await T(P,()=>T.scroll());const n0=await T(P,()=>T.n());
 await P.click('#btnPrevRe');await idle(P);await P.waitForTimeout(200);
 tx=await T(P,()=>T.text());ok(/prev=300/.test(tx),'③ 「다시 받기」 = 최신(300)',tx);
 ok(await T(P,()=>T.n())>n0,'다시 그림');ok(await T(P,()=>T.y())===y0,'② 스크롤 그대로',[y0,await T(P,()=>T.y())]);
 b=await btn(P);ok(!b.warn,'받은 뒤 강조 풀림',b);
 // 같은 값이면 다시 그리지 않음
 const n1=await T(P,()=>T.n());await P.click('#btnPrevRe');await idle(P);ok(await T(P,()=>T.n())===n1,'같은 자료면 다시 그리지 않음');
 // P 저장 → 사업계획 저장본에 새 「당해」(300)·연동 기억 그대로
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(300);
 const b27=DB.sk_snapshots.find(r=>r.id==='b27');const saved=JSON.parse(zlib.gunzipSync(FILES[b27.storage_path]));
 ok(saved.payload._bvPrev.stores.v===300&&saved.linkSonik&&saved.linkSonik.id==='s26','P 저장본 = 새 「당해」 300 · 연동 s26 그대로',{v:saved.payload._bvPrev.stores.v,link:saved.linkSonik});
 // ④ 연동 손익추정 고르기: 목록 뒤에 서버에 생긴 ’26년 손익추정도 보임
 DB.sk_snapshots.push({id:'s26b',base_ym:'2026-12',engine_ver:'v377-1',mode:'sonik',source:'web',author_email:HONG,author_name:'hong',memo:'26년 추정 수정안',storage_path:'snapshots/s26/r1.json.gz',size_bytes:1,rev:1,created_at:now(),updated_at:now()});
 await P.click('#btnLink');await P.waitForSelector('#lnkSrc');
 const opts=await P.evaluate(()=>[...document.querySelectorAll('#lnkSrc option')].map(o=>o.textContent));
 ok(opts.some(t=>/수정안/.test(t)),'④ 연동 손익추정 목록에 나중에 생긴 손익추정도 나옴',opts);
 await P.click('#mCancel');
 ok(SEL.some(s=>/eq,like/.test(s)),'서버에서 해당 연도 손익추정 행만 다시 읽음(파일 아님)',SEL.slice(-5));
 console.log('errs',errs);ok(errs.length===0,'페이지 오류 없음');
 console.log(`bizplan-prev: ${pass} pass, ${fail} fail`);await br.close();server.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
