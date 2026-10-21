import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=p=>JSON.parse(readFileSync(p));
const median=a=>{a=[...a].sort((a,b)=>a-b);const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
function load(p) {
  const r=read(p);assert.equal(r.meta.complete,true,p);
  assert.equal(r.meta.diagnosticTrace,false,p);
  assert.equal(r.meta.requireNormalScheduler,true,p);
  const c=r.meta.config;
  assert.equal(r.blocks.length,c.rounds*c.selected.length*c.cases.length,p);
  for(const b of r.blocks){
    assert.equal(b.requests,b.samples.length);
    for(const key of ['serverBefore','serverAfter','clientBefore','clientAfter'])assert.equal(b.scheduling[key],0,p);
  }
  return r;
}
const main=load('results/final-sequential.json'),parallel=load('results/final-concurrency4.json'),base=load('results/final-baselines.json');
const f=n=>n.toFixed(3);
function group(r,v,c){return r.blocks.filter(b=>b.variant===v&&b.case===c);}
function value(r,v,c,key){return median(group(r,v,c).map(b=>key==='cpu'?b.cpuMs/b.requests:b[key]));}
const [js,rust]=main.meta.config.selected;
let text=`# Local workerd benchmark results\n\nMeasured ${main.meta.date} through ${parallel.meta.finished}. Runtime: ${main.meta.workerd}; Node client ${main.meta.node}; ${main.meta.rust}; ${main.meta.binaryen}. CPU: ${main.meta.cpu[0].model}; ${main.meta.kernel}. Server CPU ${main.meta.serverCPU}; ${main.meta.clientAffinity}; governor ${main.meta.governor}.\n\nAll reported quantiles and request rates below are **medians of per-round statistics**, not a single fastest run. See the round ranges for variability. Latency includes HTTP, request reading, compute, Wasm copies where applicable, and the complete response body. Process CPU is measured independently and is not Cloudflare billing data. Every measured response was byte-validated.\n\n## Optimized comparison\n\n${main.meta.config.rounds} fresh-process rounds per entrant, at least ${main.meta.config.minSamples} requests and ${main.meta.config.seconds} seconds per case/round, concurrency 1. Warm-up: at least ${main.meta.config.warmups} calls and ${main.meta.config.warmupSeconds} seconds per case.\n\n| Workload | ${js} p50 ms | ${rust} p50 ms | JS / Rust latency |\n|---|---:|---:|---:|\n`;
for(const c of main.meta.config.cases)text+=`| ${c} | ${f(value(main,js,c,'p50'))} | ${f(value(main,rust,c,'p50'))} | ${(value(main,js,c,'p50')/value(main,rust,c,'p50')).toFixed(2)}× |\n`;
function detail(r) {
  let s='| Variant | Workload | p50 ms | p95 ms | p99 ms | req/s | CPU ms/req | Round p50 range ms |\n|---|---|---:|---:|---:|---:|---:|---|\n';
  for(const c of r.meta.config.cases)for(const v of r.meta.config.selected){const bs=group(r,v,c),p=bs.map(b=>b.p50);s+=`| ${v} | ${c} | ${f(value(r,v,c,'p50'))} | ${f(value(r,v,c,'p95'))} | ${f(value(r,v,c,'p99'))} | ${value(r,v,c,'rps').toFixed(1)} | ${f(value(r,v,c,'cpu'))} | ${f(Math.min(...p))}–${f(Math.max(...p))} |\n`;}
  return s;
}
text+='\n'+detail(main);
text+='\nThe transfer controls use the same payload and response sizes as the large compute cases, with no compute kernel. They help reveal transport overhead; subtracting their medians would not be an exact isolated-kernel measurement. `image-io` includes a real local origin fetch delayed by a 10 ms timer.\n\n## Concurrent requests\n\nFour closed-loop clients share one workerd process and one isolate. CPU kernels remain single-threaded; queueing affects latency. This is achieved throughput at concurrency four, not an open-loop saturation or global capacity claim.\n\n'+detail(parallel);
text+='\n## Algorithm baselines under the final HTTP reader\n\nThese independent runs use the same BYOB transport for every entrant, separating algorithm choices from the earlier body-reader improvement. Baselines do a direct 25-tap blur and full score sort; optimized versions use separable filtering and bounded top-k selection.\n\n'+detail(base);
text+='\n## Optimization experiments retained\n\nEach table uses its own experiment, host state, and source hashes. Compare variants within an experiment; absolute timings across experiments can drift. Early experiments used shorter warm-ups. The final runs above use the final code and longer warm-ups.\n';
for(const file of ['tuning-initial.json','tuning-simd-unroll.json','tuning-body-reader.json','tuning-final-kernels.json','tuning-js-fast.json','tuning-scratch-growth.json','tuning-split-passes.json','tuning-vector-phases.json','tuning-flat-loops.json','tuning-prime.json','tuning-normal-scheduler.json']){
  const r=read(`results/${file}`);
  if(r.meta.complete===false)throw new Error(`Incomplete experiment ${file}`);
  text+=`\n### ${file}\n\n| Variant | Workload | Median round p50 ms |\n|---|---|---:|\n`;
  for(const v of r.meta.config.selected)for(const c of r.meta.config.cases)text+=`| ${v} | ${c} | ${f(value(r,v,c,'p50'))} |\n`;
}
text+='\nThe final JavaScript entry loads only its small dedicated hot kernels; the experimental branches and generated dot-product code are excluded. Rust uses explicit image SIMD and SIMD dot products, `opt-level=3`, LTO, one codegen unit, aborting panics, and Binaryen `-O3`. More aggressive dot unrolling did not establish a consistent end-to-end benefit. The size-first Rust profile was slower on image processing. The initial CPU profiles revealed body-reading overhead; both implementations received the same bounded BYOB improvement. Optimization remains hardware/workload dependent.\n';
text+='\nMixed-size runs exposed severe JavaScript phase-transition regressions. [Before](results/deopt-before.log) and [after](results/deopt-after.log) diagnostic traces show that splitting image phases removed repeated Maglev deoptimizations in that diagnostic and allowed TurboFan optimization. The final `js-flat` variant also separates vector scoring/selection and flattens the image loops, computing and then clearing unused border values. Maximum scratch preallocation and tiny startup priming did not establish consistent improvements, so they were rejected. Fresh-process timing still varies substantially: the final tables include every round and all outliers rather than promising complete JIT stability. The [mixed-workload trace](results/trace-mixed.log) is diagnostic only; tracing changes scheduling and its timings are excluded. Diagnostic V8 flags are absent from the final runs. `mixed-size-regression.json` and `search-phase-regression.json` are interrupted investigative runs, not final results. `incomplete-order-run.json` was interrupted when an audit found the two-entrant order was not counterbalanced; the final scheduler is tested and corrected.\n';
text+='\nScheduler audit: directly executed Node was automatically demoted to Linux SCHED_IDLE/nice 16 on this workstation, and its later children inherited that policy. The final launcher runs the same Node binary through the glibc loader and checks SCHED_OTHER (policy 0) for both client and workerd before and after every block. Earlier experiments predate that control and are exploratory, not fair final latency estimates. `idle-scheduler-run.json` and `tuning-normal-rejected.json` are interrupted and excluded; the latter also confirmed severe regressions in the rejected monolithic JS variant at normal priority. The final workerd affinity permits two P-cores so background V8 compiler/GC threads are not artificially confined with the single application isolate to one core; client affinity is separate. Application kernels remain single-threaded. No other processes or global scheduler settings were changed.\n';
text+='\n## Footprint and startup observations\n\n| Wasm artifact | Raw bytes | gzip bytes |\n|---|---:|---:|\n';
for(const [name,m] of Object.entries(main.meta.wasm))text+=`| ${name} | ${m.bytes} | ${m.gzipBytes} |\n`;
text+='\n| Entrant | Maximum observed scratch/linear memory MiB | Peak process RSS MiB | Median process launch-to-health ms |\n|---|---:|---:|---:|\n';
for(const v of [js,rust]){
  const b=[...main.blocks,...parallel.blocks].filter(b=>b.variant===v);
  const launches=main.blocks.filter(b=>b.variant===v&&b.case===main.meta.config.cases[0]);
  text+=`| ${v} | ${(Math.max(...b.map(b=>b.scratchBytes))/1048576).toFixed(2)} | ${(Math.max(...b.map(b=>b.processPeakRssKB))/1024).toFixed(2)} | ${f(median(launches.map(b=>b.processStartupMs)))} |\n`;
}
text+='\nScratch/linear memory is not total isolate memory. RSS covers the complete local workerd process and cannot be compared directly with the hosted 128 MB isolate limit. The 24 MiB Rust arena has a 32 MiB linked maximum; input admission and result sizes are bounded. Gzip sizes cover each Wasm artifact, not a deployable bundle. Process launch-to-health includes the health request and polling interval; it is not a Cloudflare cold-start measurement. Per-case first invocation times are preserved in raw JSON.\n';
text+=`\n## Evidence and limitations\n\n- [Sequential raw samples](results/final-sequential.json), [concurrency-four samples](results/final-concurrency4.json), [baseline samples](results/final-baselines.json).\n- [Correctness test output](results/validation.txt): independent oracle cases, all build variants, HTTP equivalence, boundaries, chunked bodies, concurrent distinct inputs, and maximum sizes.\n- [README](README.md) describes protocols, reproduction, and primary runtime references.\n- Final source commit: \`${main.meta.git}\`. The JSON embeds exact source/build hashes and toolchain metadata. Results/report commits occur afterward.\n- Load averages at sequential run start/end: ${JSON.stringify(main.meta.loadStart)} / ${JSON.stringify(main.meta.loadEnd)}. This workstation was not an isolated lab machine; scheduling, frequency changes, GC, and background work can affect tails. No outliers were removed.\n- Early \`incomplete-build-run.json\` is explicitly incomplete and excluded: an unrooted Binaryen tool was garbage-collected by Nix, causing the build to stop before all artifacts existed. The tool was rooted, builds gained hash manifests, and the experiment was rerun successfully.\n- Synthetic images contain gradients, edges, and noise; vectors use deterministic int8 values. Results describe these workloads, not every Node/Rust application.\n- No native Rust entrant, hosted Workers execution, multiregion network tests, billing estimate, or universal optimality claim is made.\n`;
writeFileSync('RESULTS.md',text);
console.log('Wrote RESULTS.md');
