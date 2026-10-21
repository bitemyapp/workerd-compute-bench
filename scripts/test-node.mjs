import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {call,agent} from './runtime.mjs';
import {fixture} from './fixtures.mjs';
import {createKernels} from '../js/kernels.js';
for(const variant of ['js-flat','rust-manual-o3']) {
  const child=spawn(process.execPath,['scripts/node-server.mjs'],{env:{...process.env,VARIANT:variant},stdio:['ignore','pipe','pipe']});
  let log='';child.stderr.on('data',c=>log+=c);child.stdout.on('data',()=>{});
  try {
    for(let i=0;;i++) {
      assert.equal(child.exitCode,null,log);
      try{if((await call('/health',null,'GET')).status===200)break;}catch{}
      assert(i<200,'Node adapter startup timeout');await new Promise(r=>setTimeout(r,10));
    }
    for(const path of ['/image?w=127&h=91','/search?n=137&d=128&q=3&k=10']) {
      const {s,bytes}=fixture(path),r=await call(path,bytes);
      assert.equal(r.status,200);
      assert.deepEqual(r.bytes,Buffer.from(createKernels('baseline')[s.kind](bytes,...s.args)));
    }
    console.log(`${variant}: Node adapter parity passed`);
  } finally {agent.destroy();const done=once(child,'exit');child.kill();await done;}
}
