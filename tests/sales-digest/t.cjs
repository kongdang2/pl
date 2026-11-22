// node tests/sales-digest/t.cjs — 목록 「개요」가 저장 뒤에도 옛 숫자로 남는 문제(hong 11/21 「월별 납사가를 바꿨는데 개요가 안 바뀌는 듯」) 시험.
// 가짜 엔진·가짜 Supabase(실데이터 없음). 실제 클릭(열기·저장)으로 확인한다.
//  ① 개요가 마지막 저장보다 오래된 사업계획을 열면 → 개요를 다시 채움(자료 파일은 저장 안 함) · sk_log summary_heal
//  ② 개요가 최신이면 열어도 다시 쓰지 않음 · 읽기 전용 사용자는 열어도 쓰지 않음
//  ③ 저장 때 개요 계산이 한 번 실패해도 다시 시도해 새 숫자로 기록
//  ④ 계속 실패하면 sk_log summary_fail 에 사유를 남김(예전: 콘솔에만)
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'../..'), HERE=__dirname, HONG='hong@x.com', VIEW='view@x.com';
const now=()=>new Date().toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'},{email:VIEW,name:'보기',role:'viewer'}],sk_engines:[],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[]};
const FILES={};
const eng=fs.readFileSync(HERE+'/engine.html','utf8');
FILES['engines/e.html.gz']=zlib.gzipSync(eng);
DB.sk_engines.push({ver:'v409-1',storage_path:'engines/e.html.gz',sha256:crypto.createHash('sha256').update(eng).digest('hex'),is_current:true,uploaded_at:now()});
const months=[{ym:'2026-10',type:'confirmed',active:true},{ym:'2026-11',type:'estimate',active:true},{ym:'2026-12',type:'estimate',active:true}];
const sonikDb=()=>({format:'pnl-db/1',scope:'all',sysVer:'v409-1',mode:'sonik',baseYm:'2026-11',months,
 payload:{session:{baseYm:'2026-11',months},menu:'overview',site:'ulsan',
  onsan:{prices:{'2026-10':{nap:600,fx:1400},'2026-11':{nap:610,fx:1400},'2026-12':{nap:620,fx:1400}},
   sales:{'2026-11':[{prod:'에틸렌',salesType:'수출',qty:20000,usdMode:'formula',fmAdj:300},{prod:'에틸렌',salesType:'수출',qty:1000,usdMode:'formula',fmAdj:300},{prod:'부타디엔',salesType:'내수',qty:8000,usdMode:'direct',usdDirect:1000},{prod:'기타매출(총무팀)',salesType:'내수',qty:5,amtMode:'direct',amtDirect:30}],
          '2026-12':[{prod:'에틸렌',salesType:'수출',qty:21000,usdMode:'formula',fmAdj:300},{prod:'부타디엔',salesType:'내수',qty:8200,usdMode:'direct',usdDirect:1000}]}},
  ulsan:{sales:{'2026-11':[{prod:'HDPE',salesType:'내수',qty:30000,usdMode:'direct',usdDirect:1100}],'2026-12':[{prod:'HDPE',salesType:'내수',qty:31000,usdMode:'direct',usdDirect:1090}]}}},
 confirmed:{onsan:{confirmedSales:{'2026-10':{'에틸렌':{exp:{qty:20500,amt:26000}},'C9+':{dom:{qty:3000,amt:2400}}}}},ulsan:{confirmedSales:{'2026-10':{HDPE:{dom:{qty:29000,amt:44000}}}}}},plan:null});
FILES['snapshots/s1/r1.json.gz']=zlib.gzipSync(JSON.stringify(sonikDb()));
DB.sk_snapshots.push({id:'s1',base_ym:'2026-11',engine_ver:'v409-1',mode:'sonik',source:'web',author_email:HONG,author_name:'hong',memo:'11월 추정',storage_path:'snapshots/s1/r1.json.gz',size_bytes:1,rev:1,
 created_at:'2026-11-22T07:00:00Z',updated_at:'2026-11-22T07:00:00Z',summary:{kind:'est',at:'2026-11-22T07:00:02Z'}});
const DIG=[];let NOFN=false;
const SUM=[];
function srv(j){const m=JSON.parse(j);
 if(m.kind==='up'){if(FILES[m.path]&&!m.upsert)return {error:{message:'exists'}};FILES[m.path]=Buffer.from(m.data,'base64');return {error:null};}
 if(m.kind==='down'){return FILES[m.path]?{data:FILES[m.path].toString('base64')}:{error:{message:'missing '+m.path}};}
 if(m.kind==='rm'){m.paths.forEach(p=>delete FILES[p]);return {error:null};}
 if(m.kind==='rpc'){const a=m.a;
  if(m.fn==='sk_set_digest'){DIG.push({a,me:m.me});if(NOFN)return {data:null,error:{message:'Could not find the function public.sk_set_digest in the schema cache'}};return {data:null,error:null};}
  if(m.fn==='sk_set_snapshot_summary'){const me=DB.sk_members.find(x=>x.email===m.me);if(!me||!['admin','writer'].includes(me.role))return {data:null,error:{message:'NO_WRITE'}};
   const s=DB.sk_snapshots.find(r=>r.id===a.p_id);SUM.push({id:a.p_id,s:a.p_summary,me:m.me});s.summary=a.p_summary;return {data:null,error:null};}
  if(m.fn!=='sk_overwrite_snapshot')return {data:null,error:null};
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
 if(m.table==='sk_members'&&single)out=out.filter(r=>r.email===m.me);
 return {data:single?(out[0]||null):out,error:null};}
const PORT=8796;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 let fp=u==='/mock.js'?path.join(REPO,'tests/two-window/mock.js'):REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 const ct={'.js':'text/javascript','.html':'text/html','.css':'text/css','.txt':'text/plain'}[path.extname(fp)]||'application/octet-stream';
 res.writeHead(200,{'content-type':ct+'; charset=utf-8'});res.end(body);}).listen(PORT);
let pass=0,fail=0;const ok=(c,m,extra)=>{if(c){pass++;console.log('ok  ',m);}else{fail++;console.log('FAIL',m,extra!==undefined?JSON.stringify(extra):'');}};
const logs=(a,id)=>DB.sk_log.filter(r=>r.action===a&&(!id||r.snapshot_id===id));
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:1400,height:900}});
 const errs=[];
 const idle=async(p)=>{await p.waitForTimeout(150);await p.waitForFunction(()=>document.getElementById('busy').hidden,null,{timeout:30000});};
 const fr=(p)=>p.frames().find(f=>f!==p.mainFrame());
 const T=(p,code,arg)=>fr(p).evaluate(code,arg);
 async function page(me,tab){const p=await ctx.newPage();await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
  p.on('pageerror',e=>errs.push(me+': '+e.message));
  await p.addInitScript((t)=>{try{localStorage.setItem('sk_tab',t);}catch(_){}} ,tab||'bizplan');
  await p.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(me));return p;}
 const back=async(p)=>{await p.click('#btnBack');await p.waitForTimeout(300);const d=await p.$('#dlgOk');if(d&&await d.isVisible())await d.click();await p.waitForSelector('#snapRows tr',{timeout:10000});};
 const P=await page(HONG,'sonik');await P.waitForSelector('[data-open="s1"]',{timeout:20000});
 await P.click('[data-open="s1"]');await idle(P);await P.waitForTimeout(1500);
 ok(DIG.length===0,'열기만 하면 판매 요약을 쓰지 않는다',DIG.length);
 await T(P,()=>T.qty(0,9000));
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(2000);
 ok(DIG.length===1,'저장하면 판매 요약을 한 번 기록',DIG.length);
 const d=DIG[0]&&DIG[0].a.p_digest||{};
 ok(DIG[0]&&DIG[0].a.p_id==='s1'&&DIG[0].a.p_kind==='sales','기록 대상 = 이 자료, 종류 sales',DIG[0]&&DIG[0].a);
 ok(JSON.stringify(d.yms)==='["2026-11","2026-12"]'&&d.prev==='2026-10','추정월 2개와 직전 확정월',[d.yms,d.prev]);
 const on=(d.s||{}).onsan||{}, eth=(on['2026-11']||[]).find(r=>r[0]==='에틸렌');
 ok(eth&&eth[1]==='x'&&eth[2]===21000&&eth[3]===Math.round(910*1400*21000/1e6*10)/10&&eth[4]===2&&eth[6]===2,'같은 품목·수출 행은 묶어 수량·금액(백만원)·포뮬러 행 수',eth);
 const oth=(on['2026-11']||[]).find(r=>/기타매출/.test(r[0]));
 ok(oth&&oth[2]===0&&oth[3]===30&&oth[5]===1,'금액만 있는 매출은 수량 0·금액 직접',oth);
 ok(((on['2026-12']||[]).find(r=>r[0]==='에틸렌')||[])[2]===9000,'화면에서 바꾼 수량(9,000)이 들어감');
 ok(JSON.stringify(on['c:2026-10'])===JSON.stringify([['에틸렌','x',20500,26000],['C9+','d',3000,2400]]),'직전 확정월 판매',on['c:2026-10']);
 ok(((d.s.ulsan||{})['2026-11']||[])[0]&&d.s.ulsan['2026-11'][0][0]==='HDPE','울산도 함께',d.s.ulsan);
 ok(JSON.stringify(d.px['2026-12'])==='[620,1400]','달별 납사·환율',d.px);
 ok(await T(P,()=>T.site())==='ulsan','요약 뒤 엔진 사업장은 원래대로(울산)');
 const fullLen=JSON.stringify(d).length; ok(fullLen<5000,'요약 크기가 작다('+fullLen+'자)');
 // 엔진 계산이 예외를 던져도 저장은 그대로
 const rev1=DB.sk_snapshots.find(r=>r.id==='s1').rev;
 await T(P,()=>T.fail(1));await P.click('#btnSave');await idle(P);await P.waitForTimeout(1500);
 ok(DB.sk_snapshots.find(r=>r.id==='s1').rev===rev1+1,'요약 계산이 실패해도 저장은 된다');
 ok(DIG.length===1,'실패한 요약은 쓰지 않음',DIG.length);
 // 028 적용 전(함수 없음)이면 한 번만 시도하고 조용히 멈춤
 await T(P,()=>T.fail(0));NOFN=true;await P.click('#btnSave');await idle(P);await P.waitForTimeout(1200);
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(1200);
 ok(DIG.length===2,'표·함수가 없으면 한 번만 시도하고 더 부르지 않음',DIG.length);
 ok(!DB.sk_log.some(r=>/digest/.test(r.action||'')),'로그를 남기지 않음');
 ok(!DB.sk_snapshots[0].hasOwnProperty('sales_digest'),'목록 표(sk_snapshots)에는 아무것도 붙이지 않음');
 ok(errs.length===0,'페이지 오류 없음',errs);
 console.log('\n결과 pass',pass,'fail',fail);await br.close();server.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
