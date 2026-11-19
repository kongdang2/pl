// node tests/list-descr/t.cjs — 자료 목록 설명 칸·숨긴 열(hong 11/20) Playwright 조작 시험. 가짜 Supabase(storage-clean/mock.js), 실데이터 없음
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'../..'), MOCK=path.resolve(__dirname,'../storage-clean/mock.js'), HONG='kongdang2@gmail.com', KIM='kim@x.com';
const day=(d)=>new Date(Date.now()-d*86400000).toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'},{email:KIM,name:'김작성',role:'writer'}],sk_engines:[{ver:'v405-1',storage_path:'engines/v405-1.html.gz',is_current:true,uploaded_at:day(0)}],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[],sk_requests:[],sk_channel:[]};
DB.sk_snapshots.push({id:'b1',base_ym:'2027-01',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'2차안_예산조정중',descr:'역송 월 5억 · 타계정 4억/2억',storage_path:'snapshots/b1/r7.json.gz',rev:7,created_at:day(3),updated_at:day(0)});
DB.sk_snapshots.push({id:'b2',base_ym:'2027-01',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'2차_납사1안',storage_path:'snapshots/b2/r11.json.gz',rev:11,created_at:day(3),updated_at:day(0)});
DB.sk_snapshots.push({id:'b3',base_ym:'2027-01',mode:'bizplan',source:'web',author_email:KIM,author_name:'김작성',memo:'김 시험안',storage_path:'snapshots/b3/r1.json.gz',rev:1,created_at:day(1),updated_at:day(1)});
const calls=[];
function srv(j){const m=JSON.parse(j);
 if(m.kind==='rpc'){calls.push(m);
  if(m.fn==='sk_set_snapshot_descr'){const r=DB.sk_snapshots.find(x=>x.id===m.a.p_id);const me=DB.sk_members.find(x=>x.email===m.me);
   if(!(me.role==='admin'||(me.role==='writer'&&r.source==='web'&&r.author_email===m.me)))return {data:null,error:{message:'NOT_ALLOWED'}};
   const v=String(m.a.p_descr||'').trim().slice(0,300)||null;r.descr=v;return {data:v||'',error:null};}
  if(m.fn==='sk_usage')return {data:{egress_month:1e8,egress_today:1e6,storage:1e8,db:1e7,at:new Date().toISOString()},error:null};
  return {data:null,error:null};}
 if(m.kind!=='q')return {data:[],error:null};
 const T=DB[m.table]||(DB[m.table]=[]);let op='select',payload=null,single=false,lim=null,ord=null;const f=[];
 for(const [k,a] of m.ops){if(k==='insert'||k==='update'||k==='upsert'){op=k;payload=a[0];}else if(k==='delete')op='delete';else if(k==='eq')f.push(r=>r[a[0]]===a[1]);else if(k==='in')f.push(r=>a[1].includes(r[a[0]]));else if(k==='maybeSingle'||k==='single')single=true;else if(k==='limit')lim=a[0];else if(k==='order')ord=[a[0],a[1]&&a[1].ascending];}
 if(op==='insert'){(Array.isArray(payload)?payload:[payload]).forEach(p=>T.push(Object.assign({created_at:new Date().toISOString()},p)));return {data:null,error:null};}
 if(op==='update'||op==='delete')return {data:null,error:null};
 let out=T.filter(r=>f.every(g=>g(r))).map(r=>Object.assign({},r));if(ord)out.sort((a,b)=>(a[ord[0]]<b[ord[0]]?-1:a[ord[0]]>b[ord[0]]?1:0)*(ord[1]?1:-1));if(lim)out=out.slice(0,lim);
 if(m.table==='sk_members'&&single){out=out.filter(r=>r.email===m.me);}
 return {data:single?(out[0]||null):out,error:null};}
const PORT=8793;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 const fp=u==='/mock.js'?MOCK:REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 res.writeHead(200,{'content-type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'}[path.extname(fp)]||'text/plain')+'; charset=utf-8'});res.end(body);}).listen(PORT);
let pass=0,fail=0;const ok=(c,m,x)=>{if(c)pass++;else{fail++;console.log('FAIL',m,x!==undefined?JSON.stringify(x):'');}};
async function page(br,me){const p=await br.newPage({viewport:{width:1300,height:900}});p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));
 await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
 await p.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(me));
 await p.waitForSelector('#snapRows tr',{timeout:20000});
 await p.click('#listTabs button[data-t="bizplan"]');await p.waitForFunction(()=>/예산조정중/.test(document.getElementById('snapRows').innerText),null,{timeout:10000});return p;}
const rowOf=(p,name)=>p.evaluate(n=>{const tr=[...document.querySelectorAll('#snapRows tr')].find(t=>t.children[1]&&t.children[1].innerText.includes(n));if(!tr)return null;
 return {cells:tr.children.length,title:tr.children[1].getAttribute('title'),descr:tr.children[2].innerText.trim(),dsc:!!tr.querySelector('[data-dsc]'),ren:!!tr.querySelector('[data-ren]')};},name);
(async()=>{const br=await chromium.launch();
 let p=await page(br,HONG);
 const heads=await p.$$eval('#vList thead',ts=>ts[0].innerText.replace(/\s+/g,' ').trim());
 ok(heads==='기준월 사업계획명 설명','머리줄 = 기준월·사업계획명·설명 (출처·작성자·마지막 저장 숨김)',heads);
 let r=await rowOf(p,'예산조정중');
 ok(r&&r.cells===4,'한 줄 4칸',r);
 ok(r&&/웹 저장/.test(r.title)&&/작성자 hong/.test(r.title)&&/마지막 저장/.test(r.title)&&/7회 저장/.test(r.title),'자료명 툴팁에 출처·작성자·마지막 저장',r);
 ok(r&&r.descr.startsWith('역송 월 5억 · 타계정 4억/2억'),'설명 표시',r);
 r=await rowOf(p,'납사1안');ok(r&&r.descr.startsWith('—')&&r.dsc,'설명 없으면 — · 관리자 ✏️',r);
 // 실제 클릭·입력으로 설명 넣기
 const tr=p.locator('#snapRows tr',{hasText:'납사1안'});await tr.locator('[data-dsc]').click();
 await p.waitForSelector('#dscIn');await p.locator('#dscIn').click();await p.keyboard.type('납사 800→700 · 프리미엄 20/5');await p.click('#mOk');
 await p.waitForFunction(()=>/800→700/.test(document.getElementById('snapRows').innerText),null,{timeout:10000});
 r=await rowOf(p,'납사1안');ok(r&&r.descr.startsWith('납사 800→700 · 프리미엄 20/5'),'입력한 설명이 목록에 보임',r);
 ok(calls.some(c=>c.fn==='sk_set_snapshot_descr'&&c.a.p_id==='b2'),'DB 함수 호출',calls.map(c=>c.fn));
 await p.screenshot({path:path.join(__dirname,'list.png'),clip:{x:0,y:0,width:1300,height:600}});
 // 취소하면 그대로
 await tr.locator('[data-dsc]').click();await p.waitForSelector('#dscIn');await p.fill('#dscIn','바뀌면 안 됨');await p.click('#mCancel');await p.waitForTimeout(500);
 r=await rowOf(p,'납사1안');ok(r&&r.descr.startsWith('납사 800→700'),'취소하면 그대로',r);
 // 비우면 지움
 await tr.locator('[data-dsc]').click();await p.waitForSelector('#dscIn');await p.fill('#dscIn','');await p.click('#mOk');
 await p.waitForFunction(()=>!/800→700/.test(document.getElementById('snapRows').innerText),null,{timeout:10000});
 r=await rowOf(p,'납사1안');ok(r&&r.descr.startsWith('—'),'비우면 지움',r);
 ok(!p.errs.length,'페이지 오류 없음',p.errs);await p.close();
 // 작성자(writer): 내 웹 자료만 ✏️
 p=await page(br,KIM);
 r=await rowOf(p,'김 시험안');ok(r&&r.dsc,'작성자 자기 자료 ✏️',r);
 r=await rowOf(p,'예산조정중');ok(r&&!r.dsc&&!r.ren,'남의 자료엔 ✏️ 없음',r);
 // 좁은 화면(휴대폰)에서도 설명이 보임
 await p.setViewportSize({width:390,height:800});await p.waitForTimeout(300);
 const vis=await p.evaluate(()=>{const td=[...document.querySelectorAll('#snapRows td.descr')].find(t=>/역송/.test(t.innerText));const b=td.getBoundingClientRect();return {w:b.width,h:b.height,over:document.documentElement.scrollWidth>innerWidth+1};});
 ok(vis.w>0&&vis.h>0&&!vis.over,'휴대폰 폭: 설명 보임·가로 넘침 없음',vis);
 ok(!p.errs.length,'페이지 오류 없음(작성자)',p.errs);
 await br.close();server.close();console.log('PASS',pass,'FAIL',fail);process.exit(fail?1:0);})().catch(e=>{console.error(e);process.exit(2);});
