// node tests/two-window/t.cjs — 가짜 엔진·가짜 Supabase 로 두 창 합치기 시험(실데이터 없음). SHOT=경로 면 충돌 창 화면을 남긴다
// 두 창(같은 사람 A·B) + 다른 사람(K, 보기만) 자동 시험
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'../..'), HERE=__dirname, HONG='kongdang2@gmail.com', KIM='kim@example.com';
const now=()=>new Date().toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'},{email:KIM,name:'김대리',role:'writer'}],sk_engines:[],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[]};
const FILES={};let OLD_RPC=false;
const eng=fs.readFileSync(HERE+'/engine.html','utf8');
FILES['engines/e.html.gz']=zlib.gzipSync(eng);
DB.sk_engines.push({ver:'v319-1',storage_path:'engines/e.html.gz',sha256:crypto.createHash('sha256').update(eng).digest('hex'),is_current:true,uploaded_at:now()});
const S0={session:{name:'t',baseYm:'2026-11',baseYear:2026,months:[{ym:'2026-11',type:'estimate',active:true},{ym:'2026-12',type:'estimate',active:true}]},
 onsan:{sales:{'2026-11':[{prod:'MEG',qty:20},{prod:'EO',qty:10},{prod:'DEG',qty:30}]},purchase:{},prices:{fx:1400}},ulsan:{sales:{},purchase:{}},sysLog:[{m:'처음'}]};
const db0={format:'pnl-db/1',scope:'all',sysVer:'v319-1',mode:'sonik',baseYm:'2026-11',months:S0.session.months,payload:S0,confirmed:{c:1},plan:null};
FILES['snapshots/w1/r1.json.gz']=zlib.gzipSync(JSON.stringify(db0));
DB.sk_snapshots.push({id:'w1',base_ym:'2026-11',engine_ver:'v319-1',mode:'sonik',source:'web',author_email:HONG,author_name:'hong',memo:'11월 추정',storage_path:'snapshots/w1/r1.json.gz',size_bytes:1,rev:1,created_at:'2026-11-04T01:00:00Z',updated_at:'2026-11-04T01:00:00Z'});
function srv(j){const m=JSON.parse(j);
 if(m.kind==='up'){if(FILES[m.path]&&!m.upsert)return {error:{message:'exists'}};FILES[m.path]=Buffer.from(m.data,'base64');return {error:null};}
 if(m.kind==='down'){return FILES[m.path]?{data:FILES[m.path].toString('base64')}:{error:{message:'missing '+m.path}};}
 if(m.kind==='rm'){m.paths.forEach(p=>delete FILES[p]);return {error:null};}
 if(m.kind==='rpc'){const a=m.a;if(m.fn!=='sk_overwrite_snapshot')return {data:null,error:null};
  const s=DB.sk_snapshots.find(r=>r.id===a.p_id);if(!s)return {error:{message:'NOT_FOUND'}};
  if(s.source!=='web'||(OLD_RPC&&s.author_email!==m.me))return {error:{message:'NOT_OWN'}};
  if(s.rev!==a.p_expected_rev)return {error:{message:'CONFLICT:'+s.rev}};
  DB.sk_snapshot_revs.push({snapshot_id:s.id,rev:s.rev,storage_path:s.storage_path,saved_at:s.updated_at});
  const mm=DB.sk_members.find(x=>x.email===m.me);Object.assign(s,{storage_path:a.p_path,size_bytes:a.p_size,rev:s.rev+1,updated_at:now(),last_saved_by:m.me,last_saved_name:mm&&mm.name});
  const mine=DB.sk_snapshot_revs.filter(r=>r.snapshot_id===s.id).sort((x,y)=>y.rev-x.rev),gone=mine.slice(3);
  DB.sk_snapshot_revs=DB.sk_snapshot_revs.filter(r=>!gone.includes(r));return {data:{rev:s.rev,prune:gone.map(g=>g.storage_path)},error:null};}
 const T=DB[m.table]||(DB[m.table]=[]);let op='select',payload=null,single=false,lim=null,ord=null;const f=[];
 for(const [k,a] of m.ops){if(k==='insert'||k==='update'||k==='upsert'){op=k;payload=a[0];}else if(k==='delete')op='delete';else if(k==='eq')f.push(r=>r[a[0]]===a[1]);else if(k==='in')f.push(r=>a[1].includes(r[a[0]]));else if(k==='neq')f.push(r=>r[a[0]]!==a[1]);else if(k==='maybeSingle'||k==='single')single=true;else if(k==='limit')lim=a[0];else if(k==='order')ord=[a[0],a[1]&&a[1].ascending];}
 if(op==='insert'||op==='upsert'){(Array.isArray(payload)?payload:[payload]).forEach(p=>{const r=Object.assign({created_at:now()},p);if(m.table==='sk_snapshots'){r.rev=r.rev||1;r.updated_at=r.created_at;}T.push(r);});return {data:null,error:null};}
 if(op==='update'){T.filter(r=>f.every(g=>g(r))).forEach(r=>Object.assign(r,payload));return {data:null,error:null};}
 if(op==='delete'){DB[m.table]=T.filter(r=>!f.every(g=>g(r)));return {data:null,error:null};}
 let out=T.filter(r=>f.every(g=>g(r))).map(r=>Object.assign({},r));if(ord)out.sort((a,b)=>(a[ord[0]]<b[ord[0]]?-1:a[ord[0]]>b[ord[0]]?1:0)*(ord[1]?1:-1));if(lim)out=out.slice(0,lim);
 return {data:single?(out[0]||null):out,error:null};}
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 let fp=u==='/mock.js'||u==='/engine.html'?HERE+u:REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 const ct={'.js':'text/javascript','.html':'text/html','.css':'text/css','.txt':'text/plain'}[path.extname(fp)]||'application/octet-stream';
 res.writeHead(200,{'content-type':ct+'; charset=utf-8'});res.end(body);}).listen(8791);
const latest=()=>{const s=DB.sk_snapshots.find(x=>x.id==='w1');return {rev:s.rev,db:JSON.parse(zlib.gunzipSync(FILES[s.storage_path]))};};
const rowsOf=(d)=>d.payload.onsan.sales['2026-11'].map(r=>r.prod+':'+r.qty+(r.note?'/'+r.note:'')).sort().join(',');
let pass=0,fail=0;const ok=(c,m,extra)=>{if(c)pass++;else{fail++;console.log('FAIL',m,extra!==undefined?JSON.stringify(extra):'');}};
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:1400,height:900}});
 const errs=[];
 async function open(me,tag){const p=await ctx.newPage();await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
  p.on('pageerror',e=>errs.push(tag+': '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/favicon|404|Failed to load/.test(m.text()))errs.push(tag+' console: '+m.text());});
  await p.goto('http://127.0.0.1:8791/index.html?me='+encodeURIComponent(me));await p.waitForSelector('[data-open="w1"]',{timeout:20000});
  await p.click('[data-open="w1"]');await idle(p);await p.waitForTimeout(1800);return p;}
 const idle=async(p)=>{await p.waitForTimeout(100);await p.waitForFunction(()=>document.getElementById('busy').hidden,null,{timeout:30000});};
 const fr=(p)=>p.frames().find(f=>f!==p.mainFrame());
 const T=(p,code)=>fr(p).evaluate(code);
 const modal=(p)=>p.evaluate(()=>document.getElementById('modal').hidden?null:{title:document.getElementById('mTitle').textContent,body:document.getElementById('mBody').innerText});
 const ctxt=(p)=>p.evaluate(()=>document.getElementById('ctx').textContent);
 const mergeBtn=(p)=>p.evaluate(()=>!document.getElementById('btnMerge').hidden);
 const save=async(p)=>{await p.click('#btnSave');await p.waitForTimeout(400);};
 const A=await open(HONG,'A'), Bw=await open(HONG,'B');
 await A.waitForTimeout(500);
 ok(/내 다른 창 함께 여는 중/.test(await ctxt(A)),'presence A',await ctxt(A));
 // 1) A: EO 11, fx 1410, 로그 → 저장(rev2)
 await T(A,()=>{T.qty('EO',11);T.fx(1410);T.log('A');});await save(A);await idle(A);
 ok(latest().rev===2,'A saved rev2');await Bw.waitForTimeout(400);
 ok(await mergeBtn(Bw),'B sees 반영 button');
 // 2) B: MEG 21, fx 1420(충돌), TEG 추가, 로그 → 저장 → 충돌 창 1칸
 await T(Bw,()=>{T.qty('MEG',21);T.fx(1420);T.add('TEG',5);T.log('B');});await save(Bw);await Bw.waitForSelector('#modal:not([hidden])');
 if(process.env.SHOT)await Bw.screenshot({path:process.env.SHOT,scale:'device'});let md=await modal(Bw);ok(/고를 칸 1개/.test(md.title)&&/환율/.test(md.body),'conflict modal fx',md);
 await Bw.click('#mgAllT');await Bw.click('#mOk');await idle(Bw);await Bw.waitForTimeout(300);
 let L=latest();ok(L.rev===3,'B merged save rev3',L.rev);
 ok(rowsOf(L.db)==='DEG:30,EO:11,MEG:21,TEG:5','rows merged',rowsOf(L.db));
 ok(L.db.payload.onsan.prices.fx===1410,'fx = theirs chosen',L.db.payload.onsan.prices.fx);
 ok(L.db.payload.sysLog.length===3,'sysLog union',L.db.payload.sysLog);
 ok(L.db.payload.ulsan.sales['2026-12'].length===1,'auto row not duplicated',L.db.payload.ulsan.sales['2026-12']);
 ok(L.db.payload.onsan.sales['2026-11'].every(r=>r._mk),'all rows stamped');
 ok(await T(Bw,()=>T.S().onsan.prices.fx)===1410,'B screen shows merged fx');
 ok((await ctxt(Bw)).indexOf('저장하면')>=0,'B ctx ok');
 ok(DB.sk_log.some(l=>l.action==='save_web'&&/합침/.test(l.detail)),'log note');
 // 3) A: 반영(A 는 바꾼 것 없음) → 화면 = rev3
 await A.waitForTimeout(400);ok(await mergeBtn(A),'A sees 반영');
 await A.click('#btnMerge');await idle(A);await A.waitForTimeout(300);
 ok(await T(A,()=>T.S().onsan.sales['2026-11'].map(r=>r.prod+':'+r.qty).join(','))==='DEG:30,EO:11,MEG:21,TEG:5','A pulled',await T(A,()=>JSON.stringify(T.S().onsan.sales)));
 ok(!(await mergeBtn(A)),'A 반영 button gone');
 // 4) A 행 삭제(DEG) 저장, B 는 DEG 수량 수정 → 행 충돌, B 는 내 값(행 유지)
 await T(A,()=>T.del('DEG'));await save(A);await idle(A);ok(latest().rev===4,'A del saved');
 await T(Bw,()=>T.qty('DEG',33));await save(Bw);await Bw.waitForSelector('#modal:not([hidden])');md=await modal(Bw);
 ok(/DEG/.test(md.body)&&/없음·삭제/.test(md.body),'row conflict modal',md);
 await Bw.click('#mOk');await idle(Bw);L=latest();ok(L.rev===5&&/DEG:33/.test(rowsOf(L.db)),'B keeps row',rowsOf(L.db));
 // 5) 같은 행 다른 칸: A 는 반영 후 EO 수량, B 는 EO 비고 → 묻지 않고 합치고 확인 필요 안내
 await A.waitForTimeout(400);await A.click('#btnMerge');await idle(A);
 await T(A,()=>T.qty('EO',12));await save(A);await idle(A);
 await T(Bw,()=>T.note('EO','B메모'));await save(Bw);await Bw.waitForTimeout(800);md=await modal(Bw);
 ok(md&&/확인 필요 1곳/.test(md.title),'warn modal',md);if(md)await Bw.click('#mOk');await idle(Bw);
 L=latest();ok(/EO:12\/B메모/.test(rowsOf(L.db))&&L.rev===7,'same row merged',[L.rev,rowsOf(L.db)]);
 // 6) 충돌 창 취소 → 저장 안 됨
 await A.waitForTimeout(400);await A.click('#btnMerge');await idle(A);
 await T(A,()=>T.fx(1500));await save(A);await idle(A);
 await T(Bw,()=>T.fx(1600));await save(Bw);await Bw.waitForSelector('#modal:not([hidden])');await Bw.click('#mCancel');await idle(Bw);
 ok(latest().rev===8&&latest().db.payload.onsan.prices.fx===1500,'cancel saves nothing',latest().rev);
 ok(await T(Bw,()=>T.S().onsan.prices.fx)===1600,'B screen untouched after cancel');
 // 7) 추정월 구성 변경 → 합칠 수 없음, 취소
 ok(!(await mergeBtn(A)),'A up to date (B cancelled)');
 await T(A,()=>T.month());await save(A);await idle(A);const r9=latest().rev;
 await save(Bw);await Bw.waitForSelector('#modal:not([hidden])');md=await modal(Bw);
 ok(/합칠 수 없습니다/.test(md.title)&&/추정월/.test(md.body),'guard months',md);await Bw.click('#mCancel');await idle(Bw);
 ok(latest().rev===r9,'guard saved nothing');
 // 8) 다른 사람(김대리) 열면 이름이 보임
 const K=await open(KIM,'K');await A.waitForTimeout(600);
 ok(/김대리/.test(await ctxt(A)),'presence other person',await ctxt(A));
 // 9) 김대리가 hong 저장본에 덮어써 저장 → A 알림에 이름, A 저장 시 합침
 await T(K,()=>T.qty('MEG',25));await save(K);await idle(K);ok(latest().rev===r9+1&&latest().db.payload.onsan.sales['2026-11'].some(r=>r.prod==='MEG'&&r.qty===25),'kim overwrote',latest().rev);
 ok(DB.sk_snapshots.length===1,'no new snapshot for kim');
 await A.waitForTimeout(500);ok(/김대리/.test(await A.evaluate(()=>document.getElementById('btnMerge').title)),'A notice names kim',await A.evaluate(()=>document.getElementById('btnMerge').title));
 await T(A,()=>T.qty('TEG',6));await save(A);await idle(A);L=latest();ok(/MEG:25/.test(rowsOf(L.db))&&/TEG:6/.test(rowsOf(L.db)),'A merged kim',rowsOf(L.db));
 ok(DB.sk_log.some(l=>/김대리님/.test(l.detail)),'log names kim');
 // 10) 서버 설정 전(옛 RPC): 김대리 저장은 새 버전으로
 OLD_RPC=true;await K.click('#btnMerge').catch(()=>{});await idle(K);await T(K,()=>T.fx(1700));await save(K);await K.waitForSelector('#modal:not([hidden])');md=await modal(K);
 ok(/새 버전으로 저장/.test(md.title),'old rpc → save new',md);await K.fill('#memoIn','김 버전');await K.click('#mOk');await idle(K);
 ok(DB.sk_snapshots.length===2,'kim new snapshot');OLD_RPC=false;
 await K.close();await A.waitForTimeout(400);ok(!/김대리/.test(await ctxt(A)),'presence leave',await ctxt(A));
 // 9) 1분 확인(통로 없이): 판 번호를 직접 올리면 pollRev 가 알림
 console.log('errs',errs);ok(errs.length===0,'no page errors');
 console.log(`two-window: ${pass} pass, ${fail} fail`);await br.close();server.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
