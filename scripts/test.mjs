import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {request} from 'node:http';
import {createKernels} from '../js/kernels.js';
import {createFastKernels} from '../js/kernels-fast.js';
import {createSplitKernels} from '../js/kernels-split.js';
import {search as phasedSearch} from '../js/vector-phased.js';
import {createFlatKernels} from '../js/kernels-flat.js';
import {wasmKernels} from '../js/wasm-kernels.js';
import {fixture} from './fixtures.mjs';
import {variants} from './config.mjs';
import {call,start,origin,agent} from './runtime.mjs';
import {verifyBuild} from './build-manifest.mjs';

verifyBuild();

function chunked(path,bytes) {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:8787,path,method:'POST'},res=>{
      const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(parts)}));res.on('error',reject);
    });
    req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('chunked test timeout')));
    req.write(bytes.subarray(0,3));
    setImmediate(()=>{req.write(bytes.subarray(3,19));setImmediate(()=>req.end(bytes.subarray(19)));});
  });
}
async function admissionTest() {
  const held=[];
  try {
    for(let i=0;i<4;i++) {
      const req=request({hostname:'127.0.0.1',port:8787,path:'/image?w=7&h=7',method:'POST',headers:{'content-length':49}},res=>res.resume());
      req.on('error',()=>{});req.write(Buffer.alloc(1));held.push(req);
    }
    for(let tries=0;;tries++) {
      const h=JSON.parse((await call('/health',null,'GET')).bytes);
      if(h.activeRequests===4)break;
      assert(tries<100,'admission test requests never became active');
      await new Promise(r=>setTimeout(r,5));
    }
    assert.equal((await call('/image?w=7&h=7',Buffer.alloc(49))).status,503);
  } finally {for(const req of held)req.end(Buffer.alloc(48));}
  for(let tries=0;;tries++){
    const h=JSON.parse((await call('/health',null,'GET')).bytes);
    if(h.activeRequests===0){assert.equal(h.reservedBytes,0);break;}
    assert(tries<100,'admission slots were not released');
    await new Promise(r=>setTimeout(r,5));
  }
}

// Independent, intentionally simple mathematical oracle.
function oracle(s,bytes) {
  if(s.kind==='search') {
    const [n,d,q,k]=s.args,a=new Int8Array(bytes.buffer,bytes.byteOffset,bytes.length),out=Buffer.alloc(q*k*8);
    for(let qi=0;qi<q;qi++) {
      const scores=Array.from({length:n},(_,id)=>({id,score:Array.from({length:d},(_,j)=>a[id*d+j]*a[(n+qi)*d+j]).reduce((s,x)=>s+x,0)}));
      scores.sort((a,b)=>b.score-a.score||a.id-b.id);
      scores.slice(0,k).forEach((v,j)=>{out.writeUInt32LE(v.id,(qi*k+j)*8);out.writeInt32LE(v.score,(qi*k+j)*8+4);});
    }
    return out;
  }
  const [w,h]=s.args,blur=new Uint8Array(w*h),out=Buffer.alloc(w*h),g=[1,4,6,4,1];
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    let sum=0;for(let j=0;j<5;j++)for(let i=0;i<5;i++)sum+=g[j]*g[i]*bytes[(y+j-2)*w+x+i-2];
    blur[y*w+x]=Math.floor((sum+128)/256);
  }
  const sx=[[-1,0,1],[-2,0,2],[-1,0,1]],sy=[[-1,-2,-1],[0,0,0],[1,2,1]];
  for(let y=3;y<h-3;y++)for(let x=3;x<w-3;x++){
    let gx=0,gy=0;for(let j=0;j<3;j++)for(let i=0;i<3;i++){let v=blur[(y+j-1)*w+x+i-1];gx+=v*sx[j][i];gy+=v*sy[j][i];}
    out[y*w+x]=Math.min(255,Math.abs(gx)+Math.abs(gy));
  }
  return out;
}
const engines=['baseline','scalar','optimized','linear','unrolled','specialized'].map(v=>[v,createKernels(v)]);
engines.push(['fast',createFastKernels()]);
engines.push(['fixed',createFastKernels(true)]);
engines.push(['split',createSplitKernels()]);
engines.push(['phased',{...createSplitKernels(),search:phasedSearch}]);
engines.push(['flat',createFlatKernels()]);
for(const v of ['scalar','simd','small','simd-o3','simd-oz','manual','manual-o3','unroll','unroll-o3']) {
  const module=new WebAssembly.Module(readFileSync(`build/${v}.wasm`));
  engines.push([`wasm-${v}`,wasmKernels(module)]);
  if(v==='scalar')engines.push(['wasm-baseline',wasmKernels(module,true)]);
}
const fixtures=[];
for(let i=0;i<24;i++) {
  fixtures.push(fixture(`/image?w=${7+i*3}&h=${7+i*2}`,i+1));
  fixtures.push(fixture(`/search?n=${1+i*9}&d=${16*(1+i%16)}&q=${1+i%4}&k=${Math.min(1+i%13,1+i*9)}`,i+1));
}
for(const value of [0,127,128,255]) {
  for(const path of ['/search?n=101&d=256&q=2&k=100','/image?w=31&h=29']){
    const f=fixture(path); f.bytes.fill(value); fixtures.push(f);
  }
}
for(const w of [8,15,16,17,31,32,33,63,64,65]) {
  const f=fixture(`/image?w=${w}&h=37`,w);
  for(let i=0;i<f.bytes.length;i++)f.bytes[i]=(i*73+(i*i)%251)&255;
  fixtures.push(f);
}
for(const {s,bytes} of fixtures) {
  const expected=oracle(s,bytes);
  for(const [name,engine] of engines)assert.deepEqual(Buffer.from(engine[s.kind](bytes,...s.args)),expected,name);
}
console.log(`${fixtures.length} oracle cases × ${engines.length} engines passed`);
const os=await origin();
try {
  for(const variant of variants) {
    const runtime=await start(variant);
    try {
      for(const path of ['/image?w=67&h=59','/search?n=137&d=128&q=3&k=10','/image?w=53&h=47&source=origin']) {
        const {s,bytes}=fixture(path),r=await call(path,path.includes('origin')?null:bytes);
        assert.equal(r.status,200);assert.deepEqual(r.bytes,oracle(s,bytes),variant);
      }
      const f=fixture('/image?w=256&h=256');
      const rs=await Promise.all(Array.from({length:4},(_,i)=>{const b=f.bytes.slice();b[i]^=255;return call('/image?w=256&h=256',b).then(r=>{assert.equal(r.status,200);assert.deepEqual(r.bytes,Buffer.from(createKernels().image(b,256,256)));});}));
      for(const [path,bytes,method,status] of [
        ['/image?w=1',null,'POST',400],['/search?d=17',null,'POST',400],['/search?n=1&k=2',null,'POST',400],
        ['/image?w=7&h=7',Buffer.alloc(48),'POST',400],['/image?w=7&h=7',Buffer.alloc(50),'POST',400],
        ['/image',null,'GET',405],['/unknown',null,'POST',400],['/search?n=32768&d=256',null,'POST',400],
      ])assert.equal((await call(path,bytes,method)).status,status,`${variant} ${path}`);
      // Exercise the maximum image size and scratch reuse across differently sized calls.
      const big=fixture('/image?w=2048&h=2048');
      const r=await call('/image?w=2048&h=2048',big.bytes);
      assert.equal(r.status,200);assert.deepEqual(r.bytes,Buffer.from(createKernels().image(big.bytes,2048,2048)));
      const small=fixture('/image?w=7&h=7');
      assert.deepEqual((await call('/image?w=7&h=7',small.bytes)).bytes,oracle(small.s,small.bytes));
      for(const length of [48,49,50]) {
        const r=await chunked('/image?w=7&h=7',Buffer.alloc(length,127));
        assert.equal(r.status,length===49?200:400,`${variant}: chunked ${length}`);
      }
      const max=fixture('/search?n=32752&d=256&q=16&k=100');
      const mr=await call('/search?n=32752&d=256&q=16&k=100',max.bytes);
      assert.equal(mr.status,200);
      assert.deepEqual(mr.bytes,Buffer.from(createKernels().search(max.bytes,...max.s.args)));
      assert.equal((await call('/transfer?bytes=49&out=13',Buffer.alloc(49))).bytes.length,13);
      await admissionTest();
      console.log(`${variant}: HTTP, origin, concurrency, admission, chunked bodies, maximum image/search passed`);
    } finally {await runtime.stop();}
  }
} finally {os.closeAllConnections();await new Promise(r=>os.close(r));agent.destroy();}
