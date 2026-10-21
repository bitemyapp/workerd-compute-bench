import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readResults} from './io-archive.mjs';
import {verifyBuild,hashFile} from './io-manifest.mjs';
verifyBuild();
const hash=b=>createHash('sha256').update(b).digest('hex');
const audit={suites:{},totalSamples:0,validatedSuccesses:0,expectedRejections:0,droppedOffers:0};
for(const [mode,expectedBlocks] of [['closed',192],['open',48],['origin',18]]) {
  const data=readResults(mode);
  assert(data.meta.complete);assert(data.meta.requireNormalScheduler);assert.equal(data.blocks.length,expectedBlocks);
  // Measurements remain tied to the immutable source commit. Reporting and
  // lossless archiving can subsequently evolve without changing that evidence.
  for(const [path,sha] of Object.entries({...data.meta.build.sources,...data.meta.files})) {
    assert.equal(hash(execFileSync('git',['show',`${data.meta.git}:${path}`])),sha,`snapshot ${path}`);
    if(path!=='scripts/io-report.mjs')assert.equal(hashFile(path),sha,`current measurement source ${path}`);
  }
  for(const [path,sha] of Object.entries(data.meta.build.artifacts))assert.equal(hashFile(path),sha,path);
  assert.equal(new Set(data.blocks.map(b=>`${b.round}/${b.variant}/${b.profile}/${b.load}`)).size,expectedBlocks);
  let samples=0,successes=0,rejections=0,dropped=0;
  for(const b of data.blocks) {
    const counts={};
    for(const s of b.samples){assert(s.status===200||s.status===503);assert(Number.isFinite(s.latencyMs)&&s.latencyMs>0);assert(Number.isFinite(s.scheduledLatencyMs)&&s.scheduledLatencyMs>=s.latencyMs);counts[s.status]=(counts[s.status]??0)+1;}
    assert.deepEqual(counts,b.counts);assert.equal(b.successes,counts[200]??0);assert.equal(b.offered,b.samples.length+b.dropped);
    assert.equal(b.goodput,b.successes*1000/b.elapsedMs);
    for(const stats of [b.before,b.after])for(const s of Object.values(stats)){assert.equal(s.schedulerPolicy,0);assert.equal(s.nice,0);}
    for(const cpu of Object.values(b.cpuMs))assert(cpu>=0);
    assert.equal(b.upstream.active,0);
    const profile=data.meta.config.profiles.find(p=>p.name===b.profile),items=mode==='origin'?1:profile.spec.items??12,bytes=profile.spec.bytes??4096;
    assert.equal(b.upstream.completed,b.successes*items);assert.equal(b.upstream.bytes,b.successes*items*bytes);
    if(b.application){assert.equal(b.application.active,0);assert.equal(b.application.availablePermits,512);assert.equal(b.application.reservedBytes,0);assert(b.upstream.peak<=512);}
    samples+=b.samples.length;successes+=b.successes;rejections+=b.counts[503]??0;dropped+=b.dropped;
  }
  audit.suites[mode]={blocks:data.blocks.length,samples,successes,rejections,dropped,sourceCommit:data.meta.git};
  audit.totalSamples+=samples;audit.validatedSuccesses+=successes;audit.expectedRejections+=rejections;audit.droppedOffers+=dropped;
  console.log(`${mode}: ${expectedBlocks} blocks, ${samples} samples, ${successes} validated successes; source, artifacts, scheduler, origin accounting and recovery verified`);
}
if(existsSync('results/io-archives.json'))for(const [path,m] of Object.entries(JSON.parse(readFileSync('results/io-archives.json')))){
  const gzip=readFileSync(path);assert.equal(hash(gzip),m.gzipSha256);assert.equal(gzip.length,m.gzipBytes);
  const raw=gunzipSync(gzip);assert.equal(hash(raw),m.rawSha256);assert.equal(raw.length,m.rawBytes);
}
audit.passed=true;writeFileSync('results/io-audit.json',JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit));
