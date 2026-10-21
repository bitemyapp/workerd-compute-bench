export const REQUEST_LIMIT=256, OUTBOUND_LIMIT=512, BUFFER_LIMIT=32*1024*1024;
const defaults={seed:1,items:12,parallel:6,bytes:4096,delay:0,headers:10,chunks:1,fail:-1,truncate:-1};
export function parse(url) {
  const s={...defaults};
  for(const [key,value] of url.searchParams) {
    if(!Object.hasOwn(defaults,key)||! /^-?\d+$/.test(value)||url.searchParams.getAll(key).length!==1)throw new Error('invalid parameter');
    s[key]=Number(value);
  }
  const between=(key,lo,hi)=>Number.isInteger(s[key])&&s[key]>=lo&&s[key]<=hi;
  if(!between('seed',0,4294967295)||!between('items',1,32)||!between('parallel',1,32)||!between('bytes',1,65536)||!between('delay',0,1000)||!between('headers',0,1000)||!between('chunks',1,Math.min(8,s.bytes))||!between('fail',-1,s.items-1)||!between('truncate',-1,s.items-1))throw new Error('invalid range');
  return s;
}
export async function shard(env,s,item) {
  const query=new URLSearchParams({seed:s.seed,item,bytes:s.bytes,delay:s.delay,headers:s.headers,chunks:s.chunks,fail:s.fail,truncate:s.truncate});
  const response=await env.ORIGIN.fetch(`http://origin/shard?${query}`,{signal:AbortSignal.timeout(5000)});
  // Always consume the body, including errors, before releasing a permit.
  const data=await response.arrayBuffer();
  if(!response.ok||data.byteLength!==s.bytes)throw new Error('upstream failure');
  return data;
}
export function worker(aggregate,stats) {
  let active=0,peak=0,completed=0,errors=0,slots=0,reservedBytes=0;
  return {async fetch(request,env) {
    const url=new URL(request.url);
    if(request.method!=='GET')return new Response(null,{status:405});
    if(url.pathname==='/health')return Response.json({active,peak,completed,errors,availablePermits:OUTBOUND_LIMIT-slots,reservedBytes,requestLimit:REQUEST_LIMIT,outboundLimit:OUTBOUND_LIMIT,bufferLimit:BUFFER_LIMIT,...stats()});
    if(url.pathname==='/reset') {
      if(active)return new Response(null,{status:409});
      peak=completed=errors=0;return new Response(null,{status:204});
    }
    if(url.pathname!=='/aggregate')return new Response(null,{status:404});
    let s;try{s=parse(url);}catch{return new Response(null,{status:400});}
    const needed=Math.min(s.parallel,s.items),memory=needed*s.bytes*2;
    // Cross-request promise queues are unsafe in workerd: a request with no
    // request-owned I/O can be canceled as hung. Reserve synchronously instead.
    if(active>=REQUEST_LIMIT||slots+needed>OUTBOUND_LIMIT||reservedBytes+memory>BUFFER_LIMIT)return new Response(null,{status:503});
    active++;slots+=needed;reservedBytes+=memory;peak=Math.max(peak,active);
    try {return new Response(await aggregate(env,s),{headers:{'content-type':'application/octet-stream'}});}
    catch {errors++;return new Response(null,{status:502});}
    finally {active--;slots-=needed;reservedBytes-=memory;completed++;}
  }};
}
