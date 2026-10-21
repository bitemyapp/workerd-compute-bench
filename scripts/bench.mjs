import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createKernels} from '../js/kernels.js';
import {cases,fixture} from './fixtures.mjs';
import {variants} from './config.mjs';
import {call,start,origin,agent,procStats,clockTicks} from './runtime.mjs';
import {verifyBuild} from './build-manifest.mjs';

const selected=(process.env.VARIANTS??'js-fast,rust-manual-o3').split(',');
const chosen=cases.filter(c=>!process.env.CASES||process.env.CASES.split(',').includes(c.name));
const rounds=Number(process.env.ROUNDS??3), minSamples=Number(process.env.SAMPLES??80);
const seconds=Number(process.env.SECONDS??1), concurrency=Number(process.env.CONCURRENCY??1);
const warmups=Number(process.env.WARMUPS??50), warmupSeconds=Number(process.env.WARMUP_SECONDS??1), output=process.env.OUTPUT??'results/benchmark.json';
assert(selected.every(v=>variants.includes(v)));assert(chosen.length>0);
assert(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4);
assert(Number.isInteger(rounds)&&rounds>0&&Number.isInteger(minSamples)&&minSamples>0&&seconds>0);
assert(Number.isInteger(warmups)&&warmups>0&&warmupSeconds>=0);
const hash=b=>createHash('sha256').update(b).digest('hex');
function command(cmd,args=[]) {try{return execFileSync(cmd,args,{encoding:'utf8'}).trim();}catch{return null;}}
function file(path){try{return readFileSync(path,'utf8').trim();}catch{return null;}}
const meta={build:verifyBuild(),date:new Date().toISOString(),node:process.version,rust:command('rustc',['--version']),
  workerd:command('bash',['scripts/workerd.sh','--version']),binaryen:command('wasm-opt',['--version']),
  kernel:os.release(),platform:os.platform(),arch:os.arch(),cpu:os.cpus().map(c=>({model:c.model,mhz:c.speed})),
  lscpu:command('lscpu',['-J']),loadStart:os.loadavg(),serverCPU:process.env.BENCH_CPU??null,
  clientAffinity:command('taskset',['-pc',String(process.pid)]),clockTicks,
  governor:file(`/sys/devices/system/cpu/cpu${process.env.BENCH_CPU??0}/cpufreq/scaling_governor`),
  git:command('git',['rev-parse','HEAD']),gitStatus:command('git',['status','--short']),
  complete:false,config:{rounds,minSamples,seconds,concurrency,warmups,warmupSeconds,selected,cases:chosen.map(c=>c.name)},
  files:Object.fromEntries(['js','rust','scripts'].flatMap(dir=>readdirSync(dir).filter(f=>/\.(js|mjs|rs|sh)$/.test(f)).map(f=>`${dir}/${f}`)).concat(['Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','package-lock.json']).map(f=>[f,hash(readFileSync(f))])),
  wasm:Object.fromEntries(readdirSync('build').filter(f=>f.endsWith('.wasm')).map(f=>{const b=readFileSync(`build/${f}`);return [f,{bytes:b.length,gzipBytes:gzipSync(b).length,sha256:hash(b)}];}))};
const oracle=createKernels('baseline');
const fixtures=chosen.map(c=>({...c,inputs:Array.from({length:c.path.includes('origin')?1:4},(_,i)=>{
  const {s,bytes}=fixture(c.path,42+i*97),expected=Buffer.from(oracle[s.kind](bytes,...s.args));
  return {bytes,expected,inputHash:hash(bytes),outputHash:hash(expected)};
})}));
const results={meta,fixtures:fixtures.map(c=>({name:c.name,path:c.path,inputs:c.inputs.map(({bytes,expected,...v})=>({...v,inputBytes:bytes.length,outputBytes:expected.length}))})),blocks:[]};
mkdirSync('results',{recursive:true});
const save=()=>writeFileSync(output,JSON.stringify(results,null,2)+'\n');
const originServer=await origin();
function percentile(a,q){const s=[...a].sort((a,b)=>a-b);return s[Math.max(0,Math.ceil(s.length*q)-1)];}
async function invoke(c,index) {
  const f=c.inputs[index%c.inputs.length],t=performance.now();
  const r=await call(c.path,c.path.includes('origin')?null:f.bytes);
  const ms=performance.now()-t;
  assert.equal(r.status,200,`${c.name}: ${r.bytes.toString().slice(0,100)}`);
  assert(r.bytes.equals(f.expected),`incorrect result: ${c.name}`);
  return ms;
}
try {
  for(let round=0;round<rounds;round++) {
    // Deterministic rotations/reversals reduce fixed-order thermal bias.
    const order=selected.slice(round%selected.length).concat(selected.slice(0,round%selected.length));
    if(round%2)order.reverse();
    for(const variant of order) {
      const runtime=await start(variant);
      try {
        for(const c of fixtures) {
          const firstMs=await invoke(c,0);
          const warmupStart=performance.now();
          for(let i=0;i<warmups || performance.now()-warmupStart < warmupSeconds*1000;i++)await invoke(c,i);
          const samples=[],before=procStats(runtime.child.pid),begin=performance.now();
          let next=0;
          await Promise.all(Array.from({length:concurrency},async()=>{
            do {const i=next++;samples.push(await invoke(c,i));}
            while(next<minSamples||performance.now()-begin<seconds*1000);
          }));
          const elapsedMs=performance.now()-begin,after=procStats(runtime.child.pid);
          const health=JSON.parse((await call('/health',null,'GET')).bytes);
          const block={round,variant,case:c.name,concurrency,samples,elapsedMs,requests:samples.length,
            p50:percentile(samples,.50),p95:percentile(samples,.95),p99:percentile(samples,.99),
            rps:samples.length*1000/elapsedMs,cpuMs:before&&after?(after.cpuTicks-before.cpuTicks)*1000/clockTicks:null,
            processRssKB:after?.rssKB,processPeakRssKB:after?.peakRssKB,scratchBytes:health.scratchBytes,
            processStartupMs:runtime.startupMs,firstInvocationMs:firstMs};
          results.blocks.push(block);save();
          console.log(`r${round+1} ${variant.padEnd(13)} ${c.name.padEnd(13)} p50 ${block.p50.toFixed(3)}ms p95 ${block.p95.toFixed(3)}ms ${block.rps.toFixed(1)} req/s CPU ${(block.cpuMs/block.requests).toFixed(3)}ms/req`);
        }
      } finally {await runtime.stop();}
    }
  }
  results.meta.complete=true;
} catch(e) {
  results.meta.error=e.stack;throw e;
} finally {
  results.meta.loadEnd=os.loadavg();results.meta.finished=new Date().toISOString();save();
  originServer.closeAllConnections();await new Promise(r=>originServer.close(r));agent.destroy();
}
