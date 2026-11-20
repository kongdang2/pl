// node tests/summary-heal/t.cjs — 목록 「개요」가 저장 뒤에도 옛 숫자로 남는 문제(hong 11/21 「월별 납사가를 바꿨는데 개요가 안 바뀌는 듯」) 시험.
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
const months=[{ym:'2026-12',type:'estimate',active:true}];
const bizDb=(val,n0,n1)=>({format:'pnl-db/1',scope:'all',sysVer:'v409-1',mode:'bizplan',baseYm:'2027-01',months,bizplanYear:2027,bizPrev:null,planDb:null,linkSonik:null,
 payload:{session:{baseYm:'2027-01',baseYear:2027,months},menu:'overview',val,onsan:{prices:{'2027-01':{nap:n0,fx:1330},'2027-02':{nap:n1,fx:1330}}}},confirmed:{c:1},plan:null});
// b1 = 04:15 에 다시 저장됐는데 개요는 16:08 것(옛 숫자 800→700, 재무 −244)
FILES['snapshots/b1/r2.json.gz']=zlib.gzipSync(JSON.stringify(bizDb(13,780,720)));
DB.sk_snapshots.push({id:'b1',base_ym:'2027-01',engine_ver:'v409-1',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'2차_절감반영중',storage_path:'snapshots/b1/r2.json.gz',size_bytes:1,rev:2,
 created_at:'2026-11-20T07:08:29Z',updated_at:'2026-11-20T19:15:18Z',summary:{fin:-244.4,mg:543.2,cy:78.1,nap0:800,nap1:700,fx:1330,at:'2026-11-20T07:08:30Z',ver:'v409-1'}});
// b2 = 개요가 최신
FILES['snapshots/b2/r1.json.gz']=zlib.gzipSync(JSON.stringify(bizDb(5,800,600)));
DB.sk_snapshots.push({id:'b2',base_ym:'2027-01',engine_ver:'v409-1',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'납사2안',storage_path:'snapshots/b2/r1.json.gz',size_bytes:1,rev:1,
 created_at:'2026-11-20T07:00:00Z',updated_at:'2026-11-20T07:00:00Z',summary:{fin:10,mg:5,cy:78,nap0:800,nap1:600,fx:1330,at:'2026-11-20T07:00:02Z',ver:'v409-1'}});
const SUM=[];
function srv(j){const m=JSON.parse(j);
 if(m.kind==='up'){if(FILES[m.path]&&!m.upsert)return {error:{message:'exists'}};FILES[m.path]=Buffer.from(m.data,'base64');return {error:null};}
 if(m.kind==='down'){return FILES[m.path]?{data:FILES[m.path].toString('base64')}:{error:{message:'missing '+m.path}};}
 if(m.kind==='rm'){m.paths.forEach(p=>delete FILES[p]);return {error:null};}
 if(m.kind==='rpc'){const a=m.a;
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
const PORT=8795;
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
 // ② 읽기 전용 사용자: 옛 개요 자료를 열어도 쓰지 않음
 const V=await page(VIEW);await V.waitForSelector('[data-open="b1"]',{timeout:20000});await V.click('[data-open="b1"]');await idle(V);await V.waitForTimeout(2500);
 ok(SUM.length===0,'② 읽기 전용 사용자는 열어도 개요를 쓰지 않음',SUM);await V.close();
 // ① hong: 옛 개요(800→700, −244)인 b1 을 열면 → 지금 자료 값(780→720, 재무 0.3·관리 0.1)으로 다시 채움, 파일 저장 없음
 const P=await page(HONG);await P.waitForSelector('[data-open="b1"]',{timeout:20000});
 const rev0=DB.sk_snapshots.find(r=>r.id==='b1').rev;
 await P.click('[data-open="b1"]');await idle(P);await P.waitForTimeout(2500);
 const h=SUM.filter(x=>x.id==='b1');const b1=DB.sk_snapshots.find(r=>r.id==='b1');
 ok(h.length===1&&h[0].s.nap0===780&&h[0].s.nap1===720&&h[0].s.fin===26&&h[0].s.mg===13,'① 열면 옛 개요를 지금 자료 값으로 다시 채움(780→720, 재무 26·관리 13)',h.map(x=>x.s));
 ok(b1.rev===rev0&&!DB.sk_snapshot_revs.length,'① 자료 파일은 저장하지 않음(판 번호 그대로)',b1.rev);
 ok(logs('summary_heal','b1').length===1,'① 기록 summary_heal',DB.sk_log.map(r=>r.action));
 // ② 개요가 최신인 b2 는 열어도 다시 쓰지 않음
 await back(P);await P.click('[data-open="b2"]');await idle(P);await P.waitForTimeout(2500);
 ok(!SUM.some(x=>x.id==='b2'),'② 개요가 최신이면 다시 쓰지 않음',SUM.map(x=>x.id));
 // ③ b2 에서 납사를 바꾸고 저장 — 개요 계산이 한 번 실패해도 다시 시도해 기록
 await T(P,()=>{T.val(8);T.nap(790,610);T.fail(1);});
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(2500);
 const s3=SUM.filter(x=>x.id==='b2');
 ok(s3.length===1&&s3[0].s.nap0===790&&s3[0].s.nap1===610&&s3[0].s.fin===16,'③ 저장 때 계산이 한 번 실패해도 다시 시도해 새 숫자(790→610)로 기록',s3.map(x=>x.s));
 ok(!logs('summary_fail','b2').length,'③ 다시 시도해 됐으면 실패 기록 없음',logs('summary_fail'));
 // ④ 계속 실패하면 사유를 남김
 await T(P,()=>{T.val(9);T.fail(99);});
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(3000);
 const f4=logs('summary_fail','b2');
 ok(f4.length===1&&/save/.test(f4[0].detail)&&/계산 중 예외/.test(f4[0].detail),'④ 계속 실패하면 sk_log summary_fail 에 사유',f4);
 ok(SUM.filter(x=>x.id==='b2').length===1,'④ 실패한 개요는 쓰지 않음');
 // ①' 그 뒤 다시 열면(개요 < 저장) 저절로 채워짐
 await T(P,()=>T.fail(0));await back(P);await P.click('[data-open="b2"]');await idle(P);await P.waitForTimeout(2500);
 const s5=SUM.filter(x=>x.id==='b2');
 ok(s5.length===2&&s5[1].s.fin===18,'①\' 실패 뒤 다시 열면 개요가 저절로 맞춰짐',s5.map(x=>x.s.fin));
 ok(errs.length===0,'페이지 오류 없음',errs);
 console.log('\n결과 pass',pass,'fail',fail);await br.close();server.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
