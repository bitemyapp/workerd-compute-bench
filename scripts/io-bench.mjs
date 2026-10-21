import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {start,call,health,reset,path,expected,agent,sleep,normal,clockTicks} from './io-runtime.mjs';
import {verifyBuild,hashFile,walk} from './io-manifest.mjs';
import {roundOrder} from './order.mjs';

const variants=(process.env.VARIANTS??'js-io,rust-io,tokio-current,tokio-multi').split(',');
assert(variants.every(v=>['js-io','rust-io','tokio-current','tokio-multi'].includes(v)));
const rounds=Number(process.env.ROUNDS??3),seconds=Number(process.env.SECONDS??2),warmup=Number(process.env.WARMUP_SECONDS??.5);
const concurrencies=(process.env.CONCURRENCIES??'1,8,32,64').split(',').map(Number);
const rates=(process.env.RATES??'500,1500,3000,6000').split(',').map(Number);
const mode=process.env.MODE??'closed',maxOutstanding=512;
assert(['closed','open','origin'].includes(mode));
assert(Number.isInteger(rounds)&&rounds>0&&seconds>0&&warmup>=0);
assert(concurrencies.every(c=>Number.isInteger(c)&&c>0&&c<=512));
assert(rates.every(c=>Number.isFinite(c)&&c>0&&c<=50000));
const profiles=[
  {name:'serial',spec:{parallel:1}},
  {name:'fanout6',spec:{parallel:6}},
  {name:'fanout12',spec:{parallel:12}},
  {name:'stream64k',spec:{items:8,parallel:6,bytes:65536,headers:0,delay:8,chunks:4}},
].filter(p=>!process.env.CASES||process.env.CASES.split(',').includes(p.name));
assert(profiles.length);
for(const profile of profiles)profile.inputs=Array.from({length:256},(_,seed)=>({path:path({...profile.spec,seed}),expected:expected({...profile.spec,seed})}));
function command(c,a=[]){try{return execFileSync(c,a,{encoding:'utf8'}).trim();}catch{return null;}}
const output=process.env.OUTPUT??`results/io-${mode}.json`;
const data={meta:{complete:false,date:new Date().toISOString(),build:verifyBuild(),git:command('git',['rev-parse','HEAD']),gitStatus:command('git',['status','--short']),
  files:Object.fromEntries(walk('scripts').filter(p=>p.includes('/io-')||p.endsWith('/order.mjs')||p.endsWith('/runtime.mjs')||p.endsWith('/workerd.sh')).map(p=>[p,hashFile(p)])),
  node:process.version,rust:command('rustc',['--version']),workerd:command('bash',['scripts/workerd.sh','--version']),cpu:os.cpus()[0].model,kernel:os.release(),
  affinity:{app:process.env.BENCH_CPU??null,origin:process.env.ORIGIN_CPU??null,client:command('taskset',['-pc',String(process.pid)])},loadStart:os.loadavg(),
  requireNormalScheduler:process.env.REQUIRE_NORMAL_SCHEDULER==='1',config:{variants,rounds,seconds,warmup,mode,concurrencies,rates,maxOutstanding,profiles:profiles.map(({name,spec})=>({name,spec}))}},blocks:[]};
mkdirSync('results',{recursive:true});const save=()=>writeFileSync(output,JSON.stringify(data,null,2)+'\n');
const percentile=(values,q)=>{if(!values.length)return null;const a=[...values].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(q*a.length)-1)];};
const origin=await start('origin');

async function measure(profile,load,duration,record,port=8787){
  const samples=[],pending=new Set();let next=0,dropped=0,doneInWindow=0;
  const begin=performance.now(),end=begin+duration*1000;
  async function invoke(scheduled=performance.now()){
    const i=next++,input=profile.inputs[i%profile.inputs.length],dispatch=performance.now();
    let status,bytes,error;
    try{({status,bytes}=await call(input.path,port));}catch(e){status=0;error=String(e);}
    const received=performance.now();
    if(status===200)assert(bytes.equals(input.expected),`incorrect response ${profile.name}/${i}`);
    if(status===200&&received<=end)doneInWindow++;
    if(record)samples.push({status,latencyMs:received-dispatch,scheduledLatencyMs:received-scheduled,dispatchLagMs:dispatch-scheduled,...(error?{error}:{})});
  }
  if(mode==='open'){
    // Schedule independently of response completion. Do not hide overload by
    // waiting for a free client. Record dropped offers and dispatch lateness.
    const offered=Math.floor(duration*load);let n=0;
    while(n<offered){
      const now=performance.now();
      while(n<offered&&begin+n*1000/load<=now){
        const scheduled=begin+n++*1000/load;
        if(pending.size>=maxOutstanding){dropped++;continue;}
        const p=invoke(scheduled);pending.add(p);p.then(()=>pending.delete(p),()=>{});
      }
      if(n<offered)await sleep(Math.max(0,begin+n*1000/load-performance.now()));
    }
    await Promise.all(pending);
  }else{
    await Promise.all(Array.from({length:load},async()=>{do{await invoke();}while(performance.now()<end);}));
  }
  const elapsedMs=performance.now()-begin;
  if(!record)return;
  const counts={};for(const s of samples)counts[s.status]=(counts[s.status]??0)+1;
  const ok=samples.filter(s=>s.status===200);
  return {samples,counts,dropped,offered:samples.length+dropped,elapsedMs,successes:ok.length,
    goodput:ok.length*1000/elapsedMs,windowGoodput:doneInWindow/duration,
    rejectionRps:(counts[503]??0)*1000/elapsedMs,p50:percentile(ok.map(s=>s.latencyMs),.5),p95:percentile(ok.map(s=>s.latencyMs),.95),p99:percentile(ok.map(s=>s.latencyMs),.99),
    scheduledP95:percentile(ok.map(s=>s.scheduledLatencyMs),.95),dispatchLagP95:percentile(samples.map(s=>s.dispatchLagMs),.95),dispatchLagMax:samples.reduce((m,s)=>Math.max(m,s.dispatchLagMs),0)};
}

try{
  for(let round=0;round<rounds;round++)for(const variant of roundOrder(mode==='origin'?['origin']:variants,round)){
    const app=variant==='origin'?null:await start(variant);
    try{
      for(const profile of roundOrder(profiles,round))for(const load of roundOrder(mode==='open'?rates:concurrencies,round)){
        let p=profile;
        if(mode==='origin'){
          // One shard per request; same bytes, stream and delay as this profile.
          const s={items:1,bytes:4096,headers:10,delay:0,chunks:1,...profile.spec};
          p={...profile,inputs:Array.from({length:256},(_,seed)=>({path:`/shard?${new URLSearchParams({seed,item:0,bytes:s.bytes,headers:s.headers,delay:s.delay,chunks:s.chunks,fail:-1,truncate:-1})}`,expected:Buffer.from(Array.from({length:s.bytes},(_,j)=>(Math.imul(seed,31)+j)&255))}))};
        }
        const port=mode==='origin'?8790:8787;
        if(warmup)await measure(p,load,warmup,false,port);
        if(app)await reset();else assert.equal((await call('/reset',8790)).status,204);
        const pids={client:process.pid,origin:origin.child.pid,...(app?{app:app.child.pid}:{})};
        const before=normal(pids);
        const block=await measure(p,load,seconds,true,port);
        const after=normal(pids),upstream=await health(8790),application=app?await health():null;
        assert.equal(upstream.active,0);
        const items=mode==='origin'?1:profile.spec.items??12;
        const bytes=profile.spec.bytes??4096;
        // Only expected admission rejections may occur. Full body integrity,
        // origin accounting and permit recovery must hold under every load.
        assert(Object.keys(block.counts).every(s=>s==='200'||s==='503'),JSON.stringify(block.counts));
        assert.equal(upstream.completed,block.successes*items);
        assert.equal(upstream.bytes,block.successes*items*bytes);
        if(app){assert.equal(application.availablePermits,512);assert.equal(application.reservedBytes,0);assert.equal(application.active,0);assert(upstream.peak<=512);}
        const cpuMs=Object.fromEntries(Object.keys(before).map(k=>[k,before[k]&&after[k]?(after[k].cpuTicks-before[k].cpuTicks)*1000/clockTicks:null]));
        Object.assign(block,{round,variant,profile:profile.name,load,mode,cpuMs,before,after,upstream,application,mibPerSec:block.goodput*items*bytes/1048576});
        data.blocks.push(block);save();
        console.log(`r${round+1} ${variant.padEnd(13)} ${profile.name.padEnd(10)} ${mode}=${load} goodput=${block.goodput.toFixed(1)}/s p50=${block.p50?.toFixed(2)} p95=${block.p95?.toFixed(2)} reject=${block.counts[503]??0} drop=${block.dropped} originPeak=${upstream.peak}`);
      }
    }catch(e){if(app)console.error(app.log());throw e;}finally{if(app)await app.stop();}
  }
  data.meta.complete=true;
}catch(e){data.meta.error=e.stack;throw e;}finally{data.meta.finished=new Date().toISOString();data.meta.loadEnd=os.loadavg();save();await origin.stop();agent.destroy();}
