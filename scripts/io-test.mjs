import assert from 'node:assert/strict';
import {start,call,health,reset,path,expected,agent,sleep} from './io-runtime.mjs';
import {verifyBuild} from './io-manifest.mjs';
verifyBuild();
const origin=await start('origin');
try {
  for(const variant of ['js-io','rust-io','tokio-current','tokio-multi']){
    const app=await start(variant);
    try{
      for(const spec of [{},{seed:4294967295,items:7,parallel:3,bytes:257,delay:0,chunks:4},{items:32,parallel:32,bytes:65536,delay:0,chunks:8},{items:1,bytes:1,parallel:1,delay:0}]){
        const r=await call(path(spec));assert.equal(r.status,200,`${variant}: ${r.bytes}`);assert(r.bytes.equals(expected(spec)));
      }
      for(const query of ['items=0','parallel=0','bytes=65537','delay=1001','headers=1001','chunks=0','seed=-1','fail=12','items=2&fail=2','unknown=1','toString=1','items=1&items=2'])assert.equal((await call(`/aggregate?${query}`)).status,400,query);
      for(const spec of [{fail:5},{truncate:0}])assert.equal((await call(path(spec))).status,502);
      assert.equal((await health()).availablePermits,512);
      await reset();
      await Promise.all(Array.from({length:128},async(_,seed)=>{const spec={seed,items:12,parallel:3,bytes:1024,delay:5,chunks:2};const r=await call(path(spec));assert.equal(r.status,200);assert(r.bytes.equals(expected(spec)));}));
      let upstream=await health(8790);assert.equal(upstream.completed,128*12);assert.equal(upstream.bytes,128*12*1024);assert(upstream.peak<=512&&upstream.peak>6,JSON.stringify(upstream));
      assert.equal(upstream.active,0);assert.equal((await health()).availablePermits,512);
      await reset();
      const memoryStatuses=await Promise.all(Array.from({length:16},async(_,seed)=>{
        const spec={seed,items:32,parallel:32,bytes:65536,headers:100,delay:0};const r=await call(path(spec));
        if(r.status===200)assert(r.bytes.equals(expected(spec)));return r.status;
      }));
      assert(memoryStatuses.includes(503));assert(memoryStatuses.every(s=>s===200||s===503));
      assert.equal((await health()).reservedBytes,0);assert.equal((await health()).availablePermits,512);
      await reset();
      // A sustained backlog must reject excess work, then recover all permits.
      const statuses=await Promise.all(Array.from({length:512},async(_,seed)=>{
        const spec={seed,items:2,parallel:1,bytes:1,delay:100};const r=await call(path(spec));
        if(r.status===200)assert(r.bytes.equals(expected(spec)));return r.status;
      }));
      assert(statuses.includes(503),'admission limit not exercised');assert(statuses.every(s=>s===200||s===503));
      assert.equal((await health()).active,0);assert.equal((await health()).availablePermits,512);assert.equal((await health()).reservedBytes,0);
      assert.equal((await health(8790)).active,0);
      const recovery=await call(path({seed:777}));assert.equal(recovery.status,200);assert(recovery.bytes.equals(expected({seed:777})));
      console.log(`${variant}: oracle, streaming, boundaries, 128 concurrent distinct requests, failures, body-size errors, memory admission, 512-client overload and recovery passed; origin peak ${upstream.peak}`);
    }catch(e){console.error(app.log());throw e;}finally{await app.stop();}
  }
}finally{await origin.stop();agent.destroy();}
