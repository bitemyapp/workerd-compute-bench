// Diagnostic only: V8 trace flags are never added to benchmark configurations.
import {readFileSync,writeFileSync} from 'node:fs';
import {start,call,agent} from './runtime.mjs';
import {fixture} from './fixtures.mjs';
const variant=process.argv[2]??'js-fast';
const searchMode=process.argv[3]==='search';
writeFileSync('build/debug.capnp',readFileSync(`build/${variant}.capnp`,'utf8').replace('const config :Workerd.Config = (','const config :Workerd.Config = (\n v8Flags = ["--trace-opt", "--trace-deopt"],'));
const r=await start('debug');
try {
  const sequence=searchMode?[[1024,1000],[32768,10],[1024,100]]:[[256,1000],[1024,100],[256,100]];
  for(const [w,count] of sequence) {
    const path=searchMode?`/search?n=${w}&d=128&q=${w===1024?4:8}&k=10`:`/image?w=${w}&h=${w}`,{bytes}=fixture(path);
    const lat=[];
    for(let i=0;i<count;i++) {
      const t=performance.now();const res=await call(path,bytes);lat.push(performance.now()-t);
      if(res.status!==200)throw new Error(res.bytes.toString());
    }
    console.log(JSON.stringify({w,first:lat.slice(0,10),last:lat.slice(-10)}));
  }
} finally {await r.stop();agent.destroy();}
