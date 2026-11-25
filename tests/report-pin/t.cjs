// node tests/report-pin/t.cjs — 보고본 ☆ 지정·맨 위 고정(hong 11/25) Playwright 조작 시험. 가짜 Supabase(storage-clean/mock.js), 실데이터 없음
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium } = require('playwright');
const REPO=path.resolve(__dirname,'../..'), MOCK=path.resolve(__dirname,'../storage-clean/mock.js'), HONG='kongdang2@gmail.com', KIM='kim@x.com';
const day=(d)=>new Date(Date.now()-d*86400000).toISOString();
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'},{email:KIM,name:'김작성',role:'writer'}],sk_engines:[{ver:'v405-1',storage_path:'engines/v405-1.html.gz',is_current:true,uploaded_at:day(0)}],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[],sk_requests:[],sk_channel:[]};
DB.sk_snapshots.push({id:'b1',base_ym:'2027-01',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'2차안_예산조정중',descr:'역송 월 5억 · 타계정 4억/2억',summary:{fin:-681.4,mg:-105.5,cy:78.1,nap0:800,nap1:800,fx:1330,sp:[['2027-01',-85,-43,0],['2027-02',-125,-125,0],['2027-03',-72,-30,0],['2027-04',-208,-217,0],['2027-05',-142,25,0],['2027-06',-116,-63,0],['2027-07',-70,4,0],['2027-08',-32,117,0],['2027-09',16,66,0],['2027-10',50,73,0],['2027-11',55,60,0],['2027-12',48,27,0]]},storage_path:'snapshots/b1/r7.json.gz',rev:7,created_at:day(3),updated_at:day(0)});
DB.sk_snapshots.push({id:'b2',base_ym:'2027-01',mode:'bizplan',source:'web',author_email:HONG,author_name:'hong',memo:'2차_납사1안',summary:{fin:-305.9,mg:477,cy:78.1,nap0:800,nap1:700,fx:1330},storage_path:'snapshots/b2/r11.json.gz',rev:11,created_at:day(3),updated_at:day(0)});
DB.sk_snapshots.push({id:'b3',base_ym:'2027-01',mode:'bizplan',source:'web',author_email:KIM,author_name:'김작성',memo:'김 시험안',storage_path:'snapshots/b3/r1.json.gz',rev:1,created_at:day(1),updated_at:day(1)});
DB.sk_snapshots.push({id:'s1',base_ym:'2026-11',source:'web',author_email:HONG,author_name:'hong',memo:'26년_추정_11/19',summary:{kind:'est',m:[{ym:'2026-11',nap:950,fin:-222.8,mg:-232.1},{ym:'2026-12',nap:930,fin:-49.1,mg:-136.8}],q:{y:2026,q:4,ym0:'2026-10',ym1:'2026-12',nap:956.7,fin:-306.9,mg:-603.5},sp:[['2026-05',70,-61,0],['2026-06',-536,257,0],['2026-07',-166,50,0],['2026-08',-112,-33,0],['2026-09',485,86,0],['2026-10',-35,-235,0],['2026-11',-223,-232,1],['2026-12',-49,-137,1]],cum:{ym0:'2026-01',ym1:'2026-12',nap:850.5,fin:48.2,mg:-713.6}},storage_path:'snapshots/s1/r1.json.gz',rev:1,created_at:day(1),updated_at:day(1)});
DB.sk_snapshots.push({id:'s2',base_ym:'2026-10',source:'pc',author_email:HONG,author_name:'hong',memo:'10말 PC',summary:{kind:'est',m:[{ym:'2026-10',nap:900,fin:12,mg:3.5}],cum:{ym0:'2026-01',ym1:'2026-10',nap:820,fin:100,mg:-50}},storage_path:'snapshots/s2/r1.json.gz',rev:1,created_at:day(2),updated_at:day(2)});
DB.sk_snapshots.push({id:'s3',base_ym:'2026-09',source:'pc',author_email:HONG,author_name:'hong',memo:'9말 개요 없음',storage_path:'snapshots/s3/r1.json.gz',rev:1,created_at:day(3),updated_at:day(3)});

DB.sk_snapshots.find(x=>x.id==='b2').report_at=day(1); // 납사1안 = 보고본 (목록 순서상 두 번째)
const calls=[];
function srv(j){const m=JSON.parse(j);
 if(m.kind==='rpc'){calls.push(m);
  if(m.fn==='sk_set_report'){const me=DB.sk_members.find(x=>x.email===m.me);if(!me||me.role!=='admin')return {data:null,error:{message:'NOT_ALLOWED'}};
   const r=DB.sk_snapshots.find(x=>x.id===m.a.p_id);DB.sk_snapshots.filter(x=>(x.mode||'sonik')===(r.mode||'sonik')).forEach(x=>x.report_at=null);if(m.a.p_on)r.report_at=new Date().toISOString();return {data:null,error:null};}
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
const PORT=8795;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 const fp=u==='/mock.js'?MOCK:REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 res.writeHead(200,{'content-type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'}[path.extname(fp)]||'text/plain')+'; charset=utf-8'});res.end(body);}).listen(PORT);
let pass=0,fail=0;const ok=(c,m,x)=>{if(c){pass++;console.log('PASS',m);}else{fail++;console.log('FAIL',m,x!==undefined?JSON.stringify(x):'');}};
async function page(br,me,vp){const p=await br.newPage({viewport:vp||{width:1300,height:900}});p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));
 await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
 await p.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(me));
 await p.waitForSelector('#snapRows tr',{timeout:20000});
 await p.click('#listTabs button[data-t="bizplan"]');await p.waitForFunction(()=>/예산조정중/.test(document.getElementById('snapRows').innerText),null,{timeout:10000});return p;}
const state=(p)=>p.evaluate(()=>[...document.querySelectorAll('#snapRows>tr')].map(tr=>({name:(tr.querySelector('td.memo b')||{}).innerText,rep:tr.classList.contains('rep'),badge:!!tr.querySelector('.repb'),star:(tr.querySelector('.star')||{}).innerText||null,bg:getComputedStyle(tr.children[1]).backgroundColor})));
const shots=path.join(__dirname);
(async()=>{const br=await chromium.launch();
 let p=await page(br,HONG);let s=await state(p);
 ok(s[0].name==='2차_납사1안'&&s[0].rep&&s[0].badge,'보고본(납사1안)이 저장 순서와 관계없이 첫 줄 + 배지',s.map(x=>x.name));
 ok(s.filter(x=>x.rep).length===1&&s[0].bg!==s[1].bg,'보고본 줄만 바탕색이 다름',s.map(x=>x.bg));
 const rgb=s[0].bg.match(/\d+/g).map(Number);ok(rgb[2]>rgb[0]&&rgb[2]>rgb[1],'보고본 바탕 = 푸른 계열(추이 그래프 추정 구간 노랑과 구분)',s[0].bg);
 ok(s[0].star==='★'&&s.slice(1).every(x=>x.star==='☆'),'관리자: 보고본 ★, 나머지 ☆',s.map(x=>x.star));
 await p.screenshot({path:path.join(shots,'list.png')});
 // 실제 클릭: 예산조정중 ☆ → 보고본이 옮겨 가고 맨 위로
 await p.locator('#snapRows tr',{hasText:'예산조정중'}).locator('.star').click();
 await p.waitForFunction(()=>/예산조정중/.test((document.querySelector('#snapRows>tr.rep')||{}).innerText||''),null,{timeout:5000}).catch(()=>{});
 s=await state(p);
 ok(/예산조정중/.test(s[0].name)&&s[0].rep&&s.filter(x=>x.rep).length===1,'다른 자료 ☆ 클릭 → 그 자료가 보고본, 맨 위, 예전 보고본은 풀림',s.map(x=>[x.name,x.rep]));
 ok(calls.some(c=>c.fn==='sk_set_report'&&c.a.p_id==='b1'&&c.a.p_on===true),'DB 에 지정 요청',calls.filter(c=>c.fn==='sk_set_report'));
 // 손익추정 탭에는 영향 없음
 await p.click('#listTabs button[data-t="sonik"]');await p.waitForFunction(()=>/26년_추정/.test(document.getElementById('snapRows').innerText),null,{timeout:10000});
 s=await state(p);ok(s.every(x=>!x.rep),'손익추정 탭에는 보고본 없음(탭마다 따로)',s.map(x=>x.rep));
 await p.click('#listTabs button[data-t="bizplan"]');await p.waitForFunction(()=>/예산조정중/.test(document.getElementById('snapRows').innerText),null,{timeout:10000});
 // ★ 다시 클릭 → 해제
 await p.locator('#snapRows tr.rep .star').click();
 await p.waitForFunction(()=>!document.querySelector('#snapRows>tr.rep'),null,{timeout:5000}).catch(()=>{});
 s=await state(p);ok(s.every(x=>!x.rep),'★ 다시 클릭 → 지정 해제',s.map(x=>x.rep));
 await p.locator('#snapRows tr',{hasText:'납사1안'}).locator('.star').click();
 await p.waitForFunction(()=>/납사1안/.test((document.querySelector('#snapRows>tr.rep')||{}).innerText||''),null,{timeout:5000}).catch(()=>{});
 ok(p.errs.length===0,'화면 오류 없음',p.errs);await p.close();
 // 작성자(writer): ☆ 없음, 보고본은 보임
 p=await page(br,KIM);s=await state(p);
 ok(s[0].name==='2차_납사1안'&&s[0].badge&&s.every(x=>x.star===null),'작성자: 보고본 첫 줄·배지는 보이고 ☆ 단추는 없음',s.map(x=>[x.name,x.star]));await p.close();
 // 휴대폰
 p=await page(br,HONG,{width:390,height:844});
 const mob=await p.evaluate(()=>{const tr=document.querySelector('#snapRows>tr');return {rep:tr.classList.contains('rep'),bg:getComputedStyle(tr).backgroundColor,doc:document.documentElement.scrollWidth,vw:innerWidth};});
 ok(mob.rep&&mob.bg!=='rgba(0, 0, 0, 0)'&&mob.doc<=mob.vw,'휴대폰: 첫 카드 = 보고본, 카드 전체 강조, 가로 스크롤 없음',mob);
 await p.screenshot({path:path.join(shots,'list-phone.png')});await p.close();
 await br.close();server.close();console.log('PASS',pass,'FAIL',fail);process.exit(fail?1:0);})();
