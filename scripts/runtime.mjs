import {spawn,execFileSync} from 'node:child_process';
import {request,Agent,createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {once} from 'node:events';
import {fixture} from './fixtures.mjs';
export const agent=new Agent({keepAlive:true,maxSockets:4});
export function call(path,bytes,method='POST') {
  return new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:8787,path,method,agent,headers:{'content-type':'application/octet-stream','content-length':bytes?.length??0}},res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c)); res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks)}));
    });
    req.setTimeout(30000,()=>req.destroy(new Error('HTTP timeout')));
    req.on('error',reject); req.end(bytes);
  });
}
export async function start(variant) {
  const args=['scripts/workerd.sh','serve',`build/${variant}.capnp`];
  if(process.env.TRACE_JIT) {
    const config=readFileSync(args[2],'utf8').replace('const config :Workerd.Config = (','const config :Workerd.Config = (\n v8Flags = ["--trace-opt", "--trace-deopt"],');
    args[2]=`build/trace-${variant}.capnp`;writeFileSync(args[2],config);
  }
  if(process.env.PROFILE) args.push('--inspector-addr','127.0.0.1:9229');
  const child=process.env.BENCH_CPU ? spawn('taskset',['-c',process.env.BENCH_CPU,'bash',...args],{stdio:['ignore','pipe','pipe']}) : spawn('bash',args,{stdio:['ignore','pipe','pipe']});
  let log=''; child.stdout.on('data',c=>log+=c); child.stderr.on('data',c=>log+=c);
  const begin=performance.now();
  try {
    while(true) {
      if(child.exitCode!==null) throw new Error(`workerd exited: ${log}`);
      try { const r=await call('/health',null,'GET'); if(r.status===200) break; } catch {}
      if(performance.now()-begin>15000) throw new Error(`workerd startup timeout: ${log}`);
      await new Promise(r=>setTimeout(r,10));
    }
  } catch(e) { child.kill(); throw e; }
  return {child,startupMs:performance.now()-begin,log:()=>log,async stop(){
    agent.destroy();
    if(child.exitCode===null) {
      const done=once(child,'exit'); child.kill('SIGTERM');
      // Inspector sessions can keep workerd's graceful shutdown alive.
      const timeout=setTimeout(()=>child.kill('SIGKILL'),3000);
      await done;clearTimeout(timeout);
    }
    if(log.trim()) console.error(log.trim());
  }};
}
export function procStats(pid) {
  try {
    const stat=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ');
    const status=readFileSync(`/proc/${pid}/status`,'utf8');
    return {cpuTicks:Number(stat[11])+Number(stat[12]),schedulerPolicy:Number(stat[38]),nice:Number(stat[16]),affinity:status.match(/Cpus_allowed_list:\s+([^\n]+)/)?.[1],rssKB:Number(status.match(/VmRSS:\s+(\d+)/)?.[1]??0),peakRssKB:Number(status.match(/VmHWM:\s+(\d+)/)?.[1]??0)};
  } catch {return null;}
}
export const clockTicks=process.platform==='linux'?Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'})):null;
export async function origin() {
  const cache=new Map();
  const server=createServer((req,res)=>{
    try {
      if(!cache.has(req.url)) cache.set(req.url,fixture(req.url).bytes);
      const bytes=cache.get(req.url);
      setTimeout(()=>{res.writeHead(200,{'content-length':bytes.length});res.end(bytes);},10);
    } catch {res.writeHead(400);res.end();}
  });
  server.listen(8790,'127.0.0.1'); await once(server,'listening');
  return server;
}
