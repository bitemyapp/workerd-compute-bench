import {writeFileSync,mkdirSync} from 'node:fs';
import {start,call,agent} from './runtime.mjs';
import {fixture} from './fixtures.mjs';
process.env.PROFILE='1';
const variant=process.argv[2]??'js-flat',path=process.argv[3]??'/search?n=32768&d=128&q=8&k=10';
const runtime=await start(variant);
let ws;
try {
  const targets=await (await fetch('http://127.0.0.1:9229/json/list')).json();
  ws=new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let next=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const [r,j]=pending.get(m.id);pending.delete(m.id);m.error?j(m.error):r(m.result);}};
  function rpc(method,params={}){return new Promise((r,j)=>{const id=++next;pending.set(id,[r,j]);ws.send(JSON.stringify({id,method,params}));});}
  const {bytes}=fixture(path);
  for(let i=0;i<80;i++)await call(path,bytes);
  await rpc('Profiler.enable');await rpc('Profiler.setSamplingInterval',{interval:100});await rpc('Profiler.start');
  for(let i=0;i<100;i++){const r=await call(path,bytes);if(r.status!==200)throw new Error(r.bytes.toString());}
  const {profile}=await rpc('Profiler.stop');
  mkdirSync('results/profiles',{recursive:true});
  const out=`results/profiles/${variant}-${path.startsWith('/image')?'image':'search'}.cpuprofile`;
  writeFileSync(out,JSON.stringify(profile));
  console.log(out);
  console.log(profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,15).map(n=>({hits:n.hitCount,function:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber})));
} finally {ws?.close();await runtime.stop();agent.destroy();}
