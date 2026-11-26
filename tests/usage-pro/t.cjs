// node tests/usage-pro/t.cjs — 사용량 카드 Pro 한도(2026-11-26 Pro 전환) 시험. 가짜 Supabase(tests/storage-clean/mock.js), 실데이터 없음
// REPO=<다른 폴더> 로 옛 화면을 돌리면 실패해야 한다
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium } = require('playwright');
const REPO=process.env.REPO||path.resolve(__dirname,'../..'), MOCK=path.resolve(__dirname,'../storage-clean/mock.js'), HONG='kongdang2@gmail.com';
const now=new Date().toISOString();
const usages=(eg)=>[{metric:'EGRESS',usage_original:eg,pricing_free_units:250,project_allocations:[{ref:'znqaxyqayxkgqnqnwyez',usage:eg*0.9},{ref:'vowvnkxqzmizicvubipy',usage:eg*0.1}]},
 {metric:'CACHED_EGRESS',usage_original:0,pricing_free_units:250},{metric:'STORAGE_SIZE',usage_original:0.15e9,pricing_free_units:100,project_allocations:[{ref:'znqaxyqayxkgqnqnwyez',usage:0.15e9}]}]; // Pro 응답엔 DATABASE_SIZE 없음
let REAL=null;
const DB={sk_members:[{email:HONG,name:'hong',role:'admin'}],sk_engines:[],sk_snapshots:[],sk_snapshot_revs:[],sk_log:[],sk_requests:[],sk_channel:[]};
function srv(j){const m=JSON.parse(j);
 if(m.kind==='rpc'){if(m.fn==='sk_usage')return {data:{egress_month:12e9,egress_today:2e8,storage:149e6,db:29e6,cycle_start:'2026-11-07T00:00:00Z',at:now},error:null};return {data:null,error:null};}
 if(m.table==='sk_usage_real')return {data:REAL,error:null};
 if(m.kind)return {data:[],error:null};
 const single=m.ops.some(([k])=>k==='maybeSingle'||k==='single');const T=DB[m.table]||[];
 return {data:single?(T[0]||null):T,error:null};}
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 const fp=u==='/mock.js'?MOCK:REPO+u;if(!fs.existsSync(fp)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(fp);if(u==='/index.html')body=Buffer.from(body.toString().replace(/<script src="vendor\/supabase-js[^"]*"><\/script>/,'<script src="mock.js"></script>'));
 res.writeHead(200,{'content-type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'}[path.extname(fp)]||'text/plain')+'; charset=utf-8'});res.end(body);}).listen(8793);
let pass=0,fail=0;const ok=(c,m,x)=>{if(c)pass++;else{fail++;console.log('FAIL',m,x!==undefined?JSON.stringify(x):'');}};
const rows=(p)=>p.$$eval('#usageRows .u-item',rs=>rs.map(r=>r.innerText.replace(/\s+/g,' ')));
(async()=>{const br=await chromium.launch();const errs=[];
 const open=async(w,h,shot)=>{const p=await br.newPage({viewport:{width:w,height:h}});p.on('pageerror',e=>errs.push(e.message));
  await p.exposeFunction('__srv',(j)=>JSON.stringify(srv(j)));await p.goto('http://127.0.0.1:8793/index.html?me='+encodeURIComponent(HONG));
  await p.waitForSelector('#usageCard:not([hidden])',{timeout:20000});await p.waitForTimeout(300);
  if(shot){await p.locator('#usageCard').scrollIntoViewIfNeeded();await p.locator('#usageCard').screenshot({path:shot});}return p;};
 // ① Pro 실제 값(최신) · 지출 한도 켜짐
 REAL={egress:3.2e9,cached_egress:0,egress_free:250e9,period_start:'2026-11-26T07:05:03Z',period_end:'2026-12-26T00:00:00Z',fetched_at:now,error:'',raw:{usage:{usages:usages(3.2e9)},sub:{plan:{id:'pro',name:'Pro'},usage_billing_enabled:false}}};
 let p=await open(1300,900,process.env.SHOT&&process.env.SHOT+'_pc.png');let R=await rows(p);
 ok(R.length===3,'3 bars',R);
 ok(/전송량/.test(R[0])&&/3\.20GB \/ 250GB · 1%/.test(R[0]),'egress 250GB',R[0]);
 ok(/파일 보관/.test(R[1])&&/\/ 100GB/.test(R[1]),'storage 100GB',R[1]);
 ok(/데이터베이스/.test(R[2])&&/29MB \/ 8\.00GB/.test(R[2]),'db 8GB per project',R[2]);
 const head=await p.$eval('#usageCard .fhead',e=>e.innerText);
 ok(!/무료 프로젝트는 1주일/.test(head),'no free-pause note',head);
 ok(/Pro 플랜 · 지출 한도 켜짐/.test(head),'plan + spend cap on',head);
 ok(await p.$eval('#usageRows .u-bar i',e=>e.className)==='ok','green bar');
 // 접기·펴기 조작
 await p.click('#usageCard h2');await p.waitForTimeout(150);const folded=await p.$eval('#usageCard',e=>e.classList.contains('folded'));
 await p.click('#usageCard h2');await p.waitForTimeout(150);ok(folded&&!(await p.$eval('#usageCard',e=>e.classList.contains('folded'))),'fold/unfold');
 await p.close();
 // ② 지출 한도 꺼짐 → 추가 요금 문구
 REAL.raw.sub.usage_billing_enabled=true;p=await open(1300,900);
 ok(/지출 한도 꺼짐: 한도를 넘은 만큼 추가 요금/.test(await p.$eval('#usageCard .fhead',e=>e.innerText)),'spend cap off text');await p.close();
 // ③ 실제 값 없음 → 추정 막대도 250GB 기준(12GB = 4.8%, 초록)
 REAL=null;p=await open(390,844,process.env.SHOT&&process.env.SHOT+'_mobile.png');R=await rows(p);
 ok(/12\.00GB \/ 250GB · 5%/.test(R[0]),'estimate vs 250GB',R[0]);
 ok(/\/ 100GB/.test(R[1])&&/\/ 8\.00GB/.test(R[2]),'fallback storage/db limits',R);
 ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll on phone');
 await p.close();
 ok(!errs.length,'no page errors',errs);
 console.log(fail?'FAIL':'PASS',pass+'/'+(pass+fail));await br.close();server.close();process.exit(fail?1:0);})();
