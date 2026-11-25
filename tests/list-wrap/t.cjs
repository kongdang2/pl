// node tests/list-wrap/t.cjs — 자료명·설명 줄바꿈 정돈(hong 11/25) Playwright 조작 시험. 가짜 Supabase(storage-clean/mock.js), 실데이터 없음
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

DB.sk_snapshots.find(x=>x.id==='b2').report_at=day(1);DB.sk_snapshots.find(x=>x.id==='b2').memo='11월 예상실적 (작성중)';DB.sk_snapshots.find(x=>x.id==='b1').memo='2차안(작성중)';DB.sk_snapshots.find(x=>x.id==='b1').descr='납사 $750 기준 수선비 절감안 65억 반영(온산 25, 울산 40) · MOPJ $800, 프리미엄/상업수율 조정 · 그 밖의 긴 설명이 세 줄 넘게 이어지는 경우를 시험하려고 일부러 길게 적은 문장'; // 납사1안 = 보고본 (목록 순서상 두 번째)
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
const PORT=8796;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 const fp=u==='/mock.js'?MOCK:REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 res.writeHead(200,{'content-type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'}[path.extname(fp)]||'text/plain')+'; charset=utf-8'});res.end(body);}).listen(PORT);
let pass=0,fail=0;const ok=(c,m,x)=>{if(c){pass++;console.log('PASS',m);}else{fail++;console.log('FAIL',m,x!==undefined?JSON.stringify(x):'');}};
async function page(br,me,vp){const p=await br.newPage({viewport:vp||{width:1300,height:900}});p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));
 await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));
 await p.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(me));
 await p.waitForSelector('#snapRows tr',{timeout:20000});
 await p.click('#listTabs button[data-t="bizplan"]');await p.waitForFunction(()=>/예상실적/.test(document.getElementById("snapRows").innerText),null,{timeout:10000});return p;}
const state=(p)=>p.evaluate(()=>[...document.querySelectorAll('#snapRows>tr')].map(tr=>({name:(tr.querySelector('td.memo b')||{}).innerText,rep:tr.classList.contains('rep'),badge:!!tr.querySelector('.repb'),star:(tr.querySelector('.star')||{}).innerText||null,bg:getComputedStyle(tr.children[1]).backgroundColor})));
const shots=path.join(__dirname);
const geo=(p)=>p.evaluate(()=>[...document.querySelectorAll('#snapRows>tr')].map(tr=>{const td=tr.children[1],b=td.querySelector('b'),pen=td.querySelector('.ren'),d=tr.children[2],dt=d.querySelector('.dt');const lh=parseFloat(getComputedStyle(b).lineHeight)||20;
 return {name:b.innerText,nameLines:Math.round(b.getBoundingClientRect().height/lh),penPos:pen&&getComputedStyle(pen).position,penOp:pen&&getComputedStyle(pen).opacity,penOverlapsName:pen?pen.getBoundingClientRect().top>b.getBoundingClientRect().bottom+2:false,
  badgeRow:!!td.querySelector('.repw'),descrLines:dt?Math.round(dt.getBoundingClientRect().height/(parseFloat(getComputedStyle(dt).lineHeight)||18)):0,descrTitle:dt?dt.title.length:0};}));
(async()=>{const br=await chromium.launch();
 for(const w of [1300,1100]){
 let p=await page(br,HONG,{width:w,height:900});let g=await geo(p);
 const rep=g.find(x=>/예상실적/.test(x.name)),two=g.find(x=>/2차안/.test(x.name));
 ok(two.nameLines===1,w+'px: 「2차안(작성중)」 이름이 연필 때문에 줄이 넘어가지 않음',two);
 ok(rep.nameLines===1&&rep.badgeRow,w+'px: 「11월 예상실적 (작성중)」 한 줄 + 보고본 배지는 아래 한 줄',rep);
 ok(g.every(x=>x.penPos==='absolute'&&x.penOp==='0'&&!x.penOverlapsName),w+'px: 연필은 줄 밖으로 떨어지지 않고 평소엔 숨김',g.map(x=>[x.penPos,x.penOp,x.penOverlapsName]));
 ok(two.descrLines<=3&&two.descrTitle>50,w+'px: 긴 설명은 세 줄까지, 전체는 마우스 올리면',two);
 await p.locator('#snapRows tr',{hasText:'2차안'}).hover();
 const op=await p.evaluate(()=>getComputedStyle([...document.querySelectorAll('#snapRows tr')].find(t=>/2차안/.test(t.innerText)).querySelector('td.memo .ren')).opacity);
 ok(+op>0,w+'px: 줄에 마우스를 올리면 연필 보임',op);
 // 연필 실제 클릭 → 설명 고치기 창
 await p.locator('#snapRows tr',{hasText:'2차안'}).locator('[data-dsc]').click();
 ok(await p.waitForSelector('#dscIn',{timeout:5000}).then(()=>true,()=>false),w+'px: 연필 클릭으로 설명 고치기 창 열림');
 if(w===1300)await p.keyboard.press('Escape').catch(()=>{});
 const wide=await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);ok(wide,w+'px: 가로 스크롤 없음');
 ok(p.errs.length===0,w+'px: 화면 오류 없음',p.errs);
 if(w===1300){await p.reload();await p.waitForSelector('#snapRows tr');await p.click('#listTabs button[data-t="bizplan"]');await p.waitForTimeout(500);await p.locator('#snapRows').screenshot({path:path.join(shots,'list.png')});}
 await p.close();}
 // 휴대폰(터치): 연필은 그대로 보임
 const ctx=await br.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const p=await ctx.newPage();p.errs=[];
 await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));await p.goto('http://127.0.0.1:'+PORT+'/index.html?me='+encodeURIComponent(HONG));await p.waitForSelector('#snapRows tr');
 await p.click('#listTabs button[data-t="bizplan"]');await p.waitForTimeout(500);
 const m=await p.evaluate(()=>{const pen=document.querySelector('#snapRows td.memo .ren');return {pos:getComputedStyle(pen).position,op:getComputedStyle(pen).opacity,doc:document.documentElement.scrollWidth,vw:innerWidth};});
 ok(m.pos!=='absolute'&&+m.op>0&&m.doc<=m.vw,'휴대폰: 연필 그대로 보임, 가로 스크롤 없음',m);
 await p.screenshot({path:path.join(shots,'list-phone.png')});
 await br.close();server.close();console.log('PASS',pass,'FAIL',fail);process.exit(fail?1:0);})();
