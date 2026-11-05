// Supabase 흉내(저장소 정리 시험용: 버킷 구분·list·createSignedUrls 추가): 표·저장소·RPC 는 Node 쪽 공유 상태(__srv), 실시간 통로는 BroadcastChannel(같은 브라우저의 두 창)
(function(){
 const ME=new URLSearchParams(location.search).get('me')||'kongdang2@gmail.com';
 const b64=async(blob)=>{const u=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s);};
 const unb64=(s)=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return new Blob([u]);};
 function q(table){const ops=[];const p=new Proxy({},{get(_,k){if(k==='then')return (res,rej)=>window.__srv(JSON.stringify({kind:'q',table,ops,me:ME})).then(r=>res(JSON.parse(r)),rej);return (...a)=>{ops.push([k,a]);return p;};}});return p;}
 const storage={from(bucket){return{
  upload:async(path,blob,o)=>JSON.parse(await window.__srv(JSON.stringify({kind:'up',bucket,path,data:await b64(blob),upsert:!!(o&&o.upsert)}))),
  download:async(path)=>{const r=JSON.parse(await window.__srv(JSON.stringify({kind:'down',bucket,path})));return r.error?r:{data:unb64(r.data)};},
  list:async(prefix,o)=>JSON.parse(await window.__srv(JSON.stringify({kind:'ls',bucket,prefix,o}))),
  createSignedUrls:async(paths)=>JSON.parse(await window.__srv(JSON.stringify({kind:'sign',bucket,paths}))),
  remove:async(paths)=>JSON.parse(await window.__srv(JSON.stringify({kind:'rm',bucket,paths})))};}};
 function channel(name,opts){
  const bc=new BroadcastChannel('mock:'+name), hs={presence:[],broadcast:{}}, state={}, myKey=opts&&opts.config&&opts.config.presence&&opts.config.presence.key;let mine=null;
  const sync=()=>hs.presence.forEach(f=>f());
  bc.onmessage=(e)=>{const m=e.data;
   if(m.t==='track'){state[m.key]=[m.meta];sync();if(m.hello&&mine)bc.postMessage({t:'track',key:myKey,meta:mine});}
   else if(m.t==='leave'){delete state[m.key];sync();}
   else if(m.t==='bc'){(hs.broadcast[m.event]||[]).forEach(f=>f({payload:m.payload}));}};
  const ch={on(type,filter,cb){if(type==='presence')hs.presence.push(cb);else if(type==='broadcast'){(hs.broadcast[filter.event]=hs.broadcast[filter.event]||[]).push(cb);}return ch;},
   subscribe(cb){setTimeout(()=>cb&&cb('SUBSCRIBED'),10);return ch;},
   track(meta){mine=meta;state[myKey]=[meta];bc.postMessage({t:'track',key:myKey,meta,hello:true});sync();return Promise.resolve('ok');},
   send(m){bc.postMessage({t:'bc',event:m.event,payload:m.payload});return Promise.resolve('ok');},
   presenceState(){return JSON.parse(JSON.stringify(state));},
   _close(){if(ch.closed)return;ch.closed=true;if(mine)bc.postMessage({t:'leave',key:myKey});bc.close();}};
  addEventListener('pagehide',()=>ch._close());
  return ch;}
 window.supabase={createClient(){return{
  auth:{getSession:async()=>({data:{session:{user:{email:ME}}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};},signOut:async()=>({})},
  from:q, rpc:async(fn,a)=>JSON.parse(await window.__srv(JSON.stringify({kind:'rpc',fn,a,me:ME}))), storage, channel, removeChannel(ch){ch._close&&ch._close();}};}};
})();
