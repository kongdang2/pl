// node tests/storage-clean/t.cjs — 저장소 정리(🧹, 반자동) 시험. 가짜 Supabase, 실데이터 없음
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'../..'), HERE=__dirname, HONG='kongdang2@gmail.com';
const day=(d)=>new Date(Date.now()-d*86400000).toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'}],sk_engines:[],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[],sk_requests:[],sk_channel:[]};
const F={}; const put=(b,p,size,age)=>{F[b+'|'+p]={size,at:day(age)};};
// 엔진 6개(현재 v325-1) + 목록에 없는 엔진 파일 1개
['v320-1','v321-1','v322-1','v323-1','v324-1','v325-1'].forEach((v,i)=>{const p='engines/'+v+'.html.gz';put('sonik',p,4e6,10-i);DB.sk_engines.push({ver:v,storage_path:p,is_current:v==='v325-1',uploaded_at:day(10-i)});});
put('sonik','engines/stray.html.gz',3e6,20);
// 저장본: w1 현재 r3 + 이전 r2, 안 쓰이는 r1
DB.sk_snapshots.push({id:'w1',base_ym:'2026-11',engine_ver:'v325-1',mode:'sonik',source:'web',author_email:HONG,author_name:'hong',memo:'11월',storage_path:'snapshots/w1/r3.json.gz',rev:3,created_at:day(3),updated_at:day(1)});
DB.sk_snapshot_revs.push({snapshot_id:'w1',rev:2,storage_path:'snapshots/w1/r2.json.gz',saved_at:day(2)});
['r1','r2','r3'].forEach((r,i)=>put('sonik','snapshots/w1/'+r+'.json.gz',2e6,3-i));
// 챗봇 첨부: 오래된 것 / 최근 것 / 끝나지 않은 요청이 가리키는 것 / 대기 글 첨부 / 끝난 요청이 가리키는 오래된 것
put('sonik-channel','hong/old.png',5e5,40); put('sonik-channel','hong/new.png',5e5,2);
put('sonik-channel','member/kim/eng_open.html.gz',4e6,45); put('sonik-channel','hong/wait.xlsx',1e5,50);
put('sonik-channel','member/kim/eng_done.html.gz',4e6,45); put('sonik-channel','Claude/r.xlsx',1e5,10);
DB.sk_requests.push({id:1,status:'진행',items:[{kind:'engine',path:'member/kim/eng_open.html.gz'}]},{id:2,status:'반영',items:[{kind:'engine',path:'member/kim/eng_done.html.gz'}]});
DB.sk_channel.push({id:9,status:'대기',files:[{path:'hong/wait.xlsx',name:'w.xlsx'}],at:day(50),sender:'hong',recipient:'Claude',body:'x'});
function srv(j){const m=JSON.parse(j);
 if(m.kind==='ls'){const pre=m.prefix?m.prefix+'/':'';const seen=new Set(),out=[];
  Object.keys(F).filter(k=>k.startsWith(m.bucket+'|'+pre)).forEach(k=>{const rest=k.slice((m.bucket+'|'+pre).length),i=rest.indexOf('/');
   if(i>=0){const d=rest.slice(0,i);if(!seen.has(d)){seen.add(d);out.push({name:d,id:null});}}else out.push({name:rest,id:'x',created_at:F[k].at,metadata:{size:F[k].size}});});
  return {data:out,error:null};}
 if(m.kind==='rm'){m.paths.forEach(p=>delete F[m.bucket+'|'+p]);return {data:[],error:null};}
 if(m.kind==='sign')return {data:m.paths.map(p=>F[m.bucket+'|'+p]?{path:p,signedUrl:'http://127.0.0.1:8792/x?'+p}:{path:p,error:'Object not found',signedUrl:null}),error:null};
 if(m.kind==='down')return {error:{message:'no'}};
 if(m.kind==='rpc'){if(m.fn==='sk_usage')return {data:{egress_month:1.05*2**30,egress_today:7e7,storage:149*2**20,db:16*2**20,at:new Date().toISOString()},error:null};return {data:null,error:null};}
 const T=DB[m.table]||(DB[m.table]=[]);let op='select',payload=null,single=false,lim=null,ord=null;const f=[];
 for(const [k,a] of m.ops){if(k==='insert'||k==='update'||k==='upsert'){op=k;payload=a[0];}else if(k==='delete')op='delete';else if(k==='eq')f.push(r=>r[a[0]]===a[1]);else if(k==='in')f.push(r=>a[1].includes(r[a[0]]));else if(k==='maybeSingle'||k==='single')single=true;else if(k==='limit')lim=a[0];else if(k==='order')ord=[a[0],a[1]&&a[1].ascending];}
 if(op==='insert'){(Array.isArray(payload)?payload:[payload]).forEach(p=>T.push(Object.assign({created_at:new Date().toISOString()},p)));return {data:null,error:null};}
 if(op==='update'){T.filter(r=>f.every(g=>g(r))).forEach(r=>Object.assign(r,payload));return {data:null,error:null};}
 if(op==='delete'){DB[m.table]=T.filter(r=>!f.every(g=>g(r)));return {data:null,error:null};}
 let out=T.filter(r=>f.every(g=>g(r))).map(r=>Object.assign({},r));if(ord)out.sort((a,b)=>(a[ord[0]]<b[ord[0]]?-1:a[ord[0]]>b[ord[0]]?1:0)*(ord[1]?1:-1));if(lim)out=out.slice(0,lim);
 return {data:single?(out[0]||null):out,error:null};}
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 const fp=u==='/mock.js'?HERE+u:REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 res.writeHead(200,{'content-type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'}[path.extname(fp)]||'text/plain')+'; charset=utf-8'});res.end(body);}).listen(8792);
let pass=0,fail=0;const ok=(c,m,x)=>{if(c)pass++;else{fail++;console.log('FAIL',m,x!==undefined?JSON.stringify(x):'');}};
const has=(b,p)=>!!F[b+'|'+p];
(async()=>{const br=await chromium.launch();const p=await br.newPage({viewport:{width:1300,height:900}});const errs=[];
 await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://127.0.0.1:8792/index.html?me='+encodeURIComponent(HONG));
 await p.waitForSelector('#btnClean:not([hidden])',{timeout:20000});ok(true,'admin sees 🧹');
 await p.click('#btnClean');await p.waitForSelector('#clSum',{timeout:20000});
 const rows=()=>p.$$eval('#mBody .cl-row',rs=>rs.map(r=>({t:r.innerText.replace(/\s+/g,' '),on:r.querySelector('input').checked})));
 let R=await rows();const txt=(re)=>R.filter(r=>re.test(r.t));
 ok(txt(/웹 엔진 v32[0-2]-1/).length===3&&txt(/웹 엔진/).every(r=>r.on),'3 old engines checked',R);
 ok(!txt(/v32[345]-1/).length,'current + 2 previous kept',R);
 ok(txt(/목록에 없는 엔진 파일/).length===1,'stray engine file',R);
 ok(txt(/쓰이지 않는 저장 파일/).length===1&&/r1\.json/.test(txt(/쓰이지 않는/)[0].t),'orphan snapshot r1 only',R);
 const at=txt(/챗봇 첨부/);ok(at.length===2&&at.every(r=>!r.on),'2 old attachments unchecked',at);
 ok(at.some(r=>/old\.png/.test(r.t))&&at.some(r=>/eng_done/.test(r.t)),'old.png + done request file',at);
 ok(!R.some(r=>/eng_open|wait\.xlsx|new\.png|r\.xlsx/.test(r.t)),'open request / 대기 / recent excluded',R);
 // 7일로 바꾸면 Claude/r.xlsx(10일)도 나온다
 await p.selectOption('#clDays','7');await p.waitForFunction(()=>/r\.xlsx/.test(document.getElementById('mBody').innerText),null,{timeout:10000});
 R=await rows();ok(txt(/챗봇 첨부/).length===3,'7 days shows 3 attachments',R);
 // old.png 만 추가로 체크하고 지우기
 await p.$$eval('#mBody .cl-row',rs=>rs.forEach(r=>{if(/old\.png/.test(r.innerText)){const x=r.querySelector('input');x.checked=true;x.dispatchEvent(new Event('change'));}}));
 ok(/고른 것 6개/.test(await p.textContent('#clSum')),'sum 6',await p.textContent('#clSum'));
 await p.click('#mOk');await p.waitForFunction(()=>document.getElementById('busy').hidden&&document.getElementById('modal').hidden,null,{timeout:20000});await p.waitForTimeout(300);
 ok(!has('sonik','engines/v320-1.html.gz')&&!has('sonik','engines/v322-1.html.gz')&&!has('sonik','engines/stray.html.gz'),'old engine files gone');
 ok(has('sonik','engines/v323-1.html.gz')&&has('sonik','engines/v325-1.html.gz'),'kept engine files remain');
 ok(DB.sk_engines.map(r=>r.ver).join()==='v323-1,v324-1,v325-1','sk_engines rows pruned',DB.sk_engines.map(r=>r.ver));
 ok(!has('sonik','snapshots/w1/r1.json.gz')&&has('sonik','snapshots/w1/r2.json.gz')&&has('sonik','snapshots/w1/r3.json.gz'),'only orphan snapshot removed');
 ok(!has('sonik-channel','hong/old.png')&&has('sonik-channel','member/kim/eng_done.html.gz')&&has('sonik-channel','Claude/r.xlsx'),'only chosen attachment removed');
 ok(has('sonik-channel','member/kim/eng_open.html.gz')&&has('sonik-channel','hong/wait.xlsx'),'protected attachments remain');
 ok(DB.sk_log.some(l=>l.action==='storage_clean'&&/6개/.test(l.detail)),'logged',DB.sk_log);
 ok(await p.textContent('#mOk')==='확인','ok button label restored');
 // 취소하면 아무것도 지우지 않음
 const n=Object.keys(F).length;await p.click('#btnClean');await p.waitForSelector('#clSum');await p.click('#mCancel');await p.waitForTimeout(300);
 ok(Object.keys(F).length===n,'cancel deletes nothing');
 // 관리자가 아니면 버튼 없음
 DB.sk_members[0].role='writer';const q=await br.newPage();await q.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
 await q.goto('http://127.0.0.1:8792/index.html?me='+encodeURIComponent(HONG));await q.waitForSelector('#usageCard:not([hidden])',{timeout:20000});
 ok(await q.$eval('#btnClean',b=>b.hidden),'writer has no 🧹');
 if(process.env.SHOT){DB.sk_members[0].role='admin';await p.reload();await p.waitForSelector('#btnClean:not([hidden])');await p.click('#btnClean');await p.waitForSelector('#clSum');await p.screenshot({path:process.env.SHOT});}
 ok(!errs.length,'no page errors',errs);
 console.log(`storage-clean: ${pass} pass, ${fail} fail`);await br.close();server.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
