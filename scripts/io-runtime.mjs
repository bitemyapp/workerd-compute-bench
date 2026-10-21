import {spawn} from 'node:child_process';
import {request,Agent} from 'node:http';
import {once} from 'node:events';
import {procStats,clockTicks} from './runtime.mjs';
export {procStats,clockTicks};
export const agent=new Agent({keepAlive:true,maxSockets:1024,maxFreeSockets:1024});
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function call(path,port=8787) {
  return new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,path,agent},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks)}));
    });
    req.setTimeout(15000,()=>req.destroy(new Error('HTTP timeout')));
    req.on('error',reject);req.end();
  });
}
export async function health(port=8787){const r=await call('/health',port);if(r.status!==200)throw new Error(`health HTTP ${r.status}`);return JSON.parse(r.bytes);}
export async function reset() {for(const port of [8787,8790]){const r=await call('/reset',port);if(r.status!==204)throw new Error(`reset ${port}: HTTP ${r.status}`);}}
export async function start(variant) {
  const origin=variant==='origin', native=origin||variant.startsWith('tokio-');
  const port=origin?8790:8787;
  // Refuse to benchmark a pre-existing process accidentally.
  try{await health(port);throw new Error(`port ${port} already serves an application`);}catch(e){if(e.code!=='ECONNREFUSED')throw e;}
  const args=native?['target/io/release/io-native',origin?'origin':'app']:['bash','scripts/workerd.sh','serve',`build/${variant}.capnp`];
  const cpu=origin?process.env.ORIGIN_CPU:process.env.BENCH_CPU;
  const child=spawn(cpu?'taskset':args[0],cpu?['-c',cpu,...args]:args.slice(1),{env:{...process.env,TOKIO_THREADS:variant==='tokio-current'?'1':'2'},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  let spawnError;child.on('error',e=>spawnError=e);
  const stop=async()=>{agent.destroy();if(child.exitCode===null&&!spawnError){const done=once(child,'exit');child.kill();const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(timer);}};
  try{
    const begin=performance.now();
    while(true){
      if(spawnError)throw spawnError;
      if(child.exitCode!==null)throw new Error(`startup ${variant}: ${log}`);
      try{await health(port);break;}catch{}
      if(performance.now()-begin>15000)throw new Error(`startup timeout ${variant}: ${log}`);
      await sleep(10);
    }
    return {child,stop,log:()=>log};
  }catch(e){await stop();throw e;}
}

export const defaults={seed:1,items:12,parallel:6,bytes:4096,delay:0,headers:10,chunks:1,fail:-1,truncate:-1};
export function path(spec={}) {return `/aggregate?${new URLSearchParams({...defaults,...spec})}`;}
// Independent client oracle; no server implementation is imported.
export function expected(spec={}) {
  const s={...defaults,...spec},out=Buffer.alloc(8+s.items*12);
  out.writeUInt32LE(s.seed,0);out.writeUInt32LE(s.items,4);
  for(let item=0;item<s.items;item++){
    let h=2166136261;
    for(let j=0;j<s.bytes;j++)h=Math.imul(h^((Math.imul(s.seed,31)+item*17+j)&255),16777619)>>>0;
    out.writeUInt32LE(item,8+item*12);out.writeUInt32LE(s.bytes,12+item*12);out.writeUInt32LE(h,16+item*12);
  }
  return out;
}
export function normal(processes) {
  const stats=Object.fromEntries(Object.entries(processes).map(([name,pid])=>[name,procStats(pid)]));
  if(process.env.REQUIRE_NORMAL_SCHEDULER==='1')for(const [name,s] of Object.entries(stats))if(s?.schedulerPolicy!==0||s?.nice!==0)throw new Error(`${name} requires SCHED_OTHER/nice 0: ${JSON.stringify(s)}`);
  return stats;
}
