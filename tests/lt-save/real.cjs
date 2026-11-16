// 실제 엔진으로 하는 중장기 저장 확인(저장소 밖 자료 필요 — 실데이터는 저장소에 넣지 않는다):
//   ENGINE=<웹연결 엔진 html> BIZDB=<웹 사업계획 저장본 pnl-db/1 json> node tests/lt-save/real.cjs [사이트 폴더]
// 차년도 화면에서 저장(판 2) → 실제 「중장기계획」 구역 단추 → 저장(판 3) → 두 저장본 비교 → 다시 열어 손익 재현 차이 확인
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const { chromium } = require('playwright');
const REPO=path.resolve(process.argv[2]||path.join(__dirname,'../..')), HERE=__dirname, HONG='kongdang2@gmail.com';
const now=()=>new Date().toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'}],sk_engines:[],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[]};
const FILES={};
const eng=fs.readFileSync(process.env.ENGINE,'utf8');
FILES['engines/e.html.gz']=zlib.gzipSync(eng);
DB.sk_engines.push({ver:'v395-1',storage_path:'engines/e.html.gz',sha256:crypto.createHash('sha256').update(eng).digest('hex'),is_current:true,uploaded_at:now()});
const months=['2027-01','2027-02','2027-12'];
const bizDb=(val)=>({format:'pnl-db/1',scope:'all',sysVer:'v395-1',mode:'bizplan',baseYm:'2027-01',months,bizplanYear:2027,bizPrev:null,planDb:null,linkSonik:null,
 payload:{session:{baseYm:'2027-01',baseYear:2027,months},menu:'overview',val},confirmed:{c:'main'},plan:null});
const REAL=JSON.parse(fs.readFileSync(process.env.BIZDB,'utf8'));FILES['snapshots/b27/r1.json.gz']=zlib.gzipSync(JSON.stringify(REAL));
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
const PORT=+(process.env.PORT||8795);
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 let fp=u==='/mock.js'?path.join(__dirname,'../two-window/mock.js'):REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 const ct={'.js':'text/javascript','.html':'text/html','.css':'text/css','.txt':'text/plain'}[path.extname(fp)]||'application/octet-stream';
 res.writeHead(200,{'content-type':ct+'; charset=utf-8'});res.end(body);}).listen(PORT);

let pass=0,fail=0;const ok=(c,m,extra)=>{if(c){pass++;console.log('ok  ',m);}else{fail++;console.log('FAIL',m,extra!==undefined?JSON.stringify(extra).slice(0,400):'');}};
const VIEW=['site','menu','ym','_zone','_zoneMode','_siteMenu','_zoneMenu','_sub','_sysLogReset','_sysLogHideV2'];
const strip=(p)=>{const o={};Object.keys(p).sort().forEach(k=>{if(VIEW.includes(k)||k==='ltPlan')return;o[k]=p[k];});return JSON.stringify(o);};
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:1600,height:950}});
 const errs=[];
 const idle=async(p)=>{await p.waitForTimeout(300);await p.waitForFunction(()=>document.getElementById('busy').hidden,null,{timeout:240000});};
 const fr=(p)=>p.frames().find(f=>f!==p.mainFrame());
 const E=(p,code,arg)=>fr(p).evaluate(code,arg);
 const toastTxt=(p)=>p.evaluate(()=>{const t=document.getElementById('toast');return t.hidden?'':t.textContent;});
 async function page(){const P=await ctx.newPage();await P.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
  P.on('pageerror',e=>errs.push(e.message));
  await P.addInitScript(()=>{try{localStorage.setItem('sk_tab','bizplan');}catch(_){}});
  await P.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(HONG));return P;}
 const vinfo=(p)=>E(p,()=>{const m=document.getElementById('pnlVerifyModal');return m?m.textContent.replace(/\s+/g,' ').slice(0,120):'(창 없음)';});
 const P=await page();await P.waitForSelector('[data-open="b27"]',{timeout:20000});await P.click('[data-open="b27"]');await idle(P);await P.waitForTimeout(3000);
 console.log('열 때 재현 창:',await vinfo(P));
 await E(P,()=>{const m=document.getElementById('pnlVerifyModal');if(m)m.remove();});
 ok(await E(P,()=>S.session.baseYear+'-'+S.session.baseMonth)==='2027-1','열기 = 2027 차년도');
 // ⓐ 차년도 화면에서 저장(판 2) = 비교 기준
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(500);
 const A=saved();ok(A.rev===2,'차년도에서 저장 = 판 2',A.rev);
 // ⓑ 실제 단추로 중장기계획 구역 → 화면 뜰 때까지
 await fr(P).locator('#zoneBtn_lt').click();await P.waitForTimeout(1500);
 await fr(P).waitForFunction(()=>window.__LT_ON===true,null,{timeout:240000});await P.waitForTimeout(8000);
 const ltInfo=await E(P,()=>({on:window.__LT_ON,base:S.session.baseYear+'-'+S.session.baseMonth,ym:S.ym,y:document.getElementById('baseYearLabel')&&document.getElementById('baseYearLabel').textContent}));
 console.log('중장기 화면:',JSON.stringify(ltInfo));
 ok(ltInfo.on&&ltInfo.base!=='2027-1','중장기 화면 = 엔진 S 가 중장기 자료',ltInfo);
 // ⓒ 중장기 화면에서 저장 단추(판 3)
 await P.click('#btnSave');await idle(P);await P.waitForTimeout(800);
 console.log('저장 알림:',await toastTxt(P));
 const B=saved();ok(B.rev===3,'중장기 화면에서 저장 = 판 3',B.rev);
 ok(B.db.baseYm==='2027-01'&&B.db.payload.session.baseYear===2027,'① 저장본 기준월 = 2027-01 (중장기 2028-12 아님)',{baseYm:B.db.baseYm,y:B.db.payload.session.baseYear,m:B.db.payload.session.baseMonth});
 ok(JSON.stringify(B.db.months)===JSON.stringify(A.db.months),'① 기간 목록 = 차년도와 같음',[A.db.months.length,B.db.months.length]);
 ok(strip(B.db.payload)===strip(A.db.payload),'① 저장 자료(보기 상태·중장기 자료 빼고) = 차년도 화면에서 저장한 것과 글자까지 같음');
 ok(JSON.stringify(B.db.confirmed)===JSON.stringify(A.db.confirmed),'① 확정DB 같음');
 const pdb=(d)=>{if(!d)return null;const c=JSON.parse(JSON.stringify(d));if(c.meta)delete c.meta.exportedAt;return JSON.stringify(c);};
 ok(!!A.db.planDb&&pdb(B.db.planDb)===pdb(A.db.planDb),'① 사업계획 DB(내보낸 시각 빼고) = 차년도에서 저장한 것과 같음',[A.db.planDb&&A.db.planDb.meta,B.db.planDb&&B.db.planDb.meta]);
 ok(!!(B.db.payload.ltPlan&&B.db.payload.ltPlan.S),'① 중장기 자료는 저장본의 ltPlan 안에 들어감');
 ok(JSON.stringify(B.db.verify&&B.db.verify.capturedYm||null)===JSON.stringify(A.db.verify&&A.db.verify.capturedYm||null),'① 재현 기준 = 차년도 것',[A.db.verify&&A.db.verify.capturedYm,B.db.verify&&B.db.verify.capturedYm]);
 const after=await E(P,()=>({on:window.__LT_ON,base:S.session.baseYear+'-'+S.session.baseMonth,btn:document.getElementById('zoneBtn_lt')&&document.getElementById('zoneBtn_lt').classList.contains('on')}));
 ok(after.on&&after.base===ltInfo.base,'② 저장 뒤에도 중장기 화면 그대로',after);
 // ⓓ 다시 열기 = 차년도, 재현 차이 없음
 const Q=await page();await Q.waitForSelector('[data-open="b27"]',{timeout:20000});await Q.click('[data-open="b27"]');await idle(Q);await Q.waitForTimeout(3000);
 const vi=await vinfo(Q);console.log('다시 열 때 재현 창:',vi);
 ok(await E(Q,()=>S.session.baseYear+'-'+S.session.baseMonth)==='2027-1','③ 다시 열기 = 2027 차년도');
 ok(!/차이 [1-9]/.test(vi),'③ 손익 재현 차이 없음',vi);
 console.log('errs',errs.slice(0,5));
 console.log(`real-lt-save: ${pass} pass, ${fail} fail`);await br.close();server.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
