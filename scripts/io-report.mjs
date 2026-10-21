import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {archiveResults,readResults} from './io-archive.mjs';
await archiveResults();
const datasets=Object.fromEntries(['closed','open','origin'].map(mode=>[mode,readResults(mode)]));
for(const [mode,d]of Object.entries(datasets)){assert(d.meta.complete,`${mode} incomplete`);assert(d.blocks.length);}
const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const med=(blocks,f)=>median(blocks.map(f));
const fmt=(n,d=1)=>n==null?'—':n.toFixed(d);
function groups(blocks){const map=new Map();for(const b of blocks){const key=`${b.variant}/${b.profile}/${b.load}`;if(!map.has(key))map.set(key,[]);map.get(key).push(b);}return [...map.values()];}
const closed=groups(datasets.closed.blocks).sort((a,b)=>a[0].profile.localeCompare(b[0].profile)||a[0].variant.localeCompare(b[0].variant)||a[0].load-b[0].load);
const best=[];
for(const variant of datasets.closed.meta.config.variants)for(const p of datasets.closed.meta.config.profiles){
  const eligible=closed.filter(g=>g[0].variant===variant&&g[0].profile===p.name&&g.every(b=>!b.counts[503]&&!b.dropped));
  if(eligible.length)best.push(eligible.sort((a,b)=>med(b,x=>x.goodput)-med(a,x=>x.goodput))[0]);
}
const lines=['# I/O concurrency results','',`Measured ${datasets.closed.meta.date} through ${datasets.origin.meta.finished}. CPU: ${datasets.closed.meta.cpu}; ${datasets.closed.meta.workerd}; Node ${datasets.closed.meta.node}. Source commit: \`${datasets.closed.meta.git}\`. Each application gets CPUs ${datasets.closed.meta.affinity.app}; the native Tokio origin gets CPUs ${datasets.closed.meta.affinity.origin}; client: ${datasets.closed.meta.affinity.client}.`,'',
'These are local, workload-specific measurements. JavaScript and Rust/Wasm each run in one workerd isolate. Native Tokio runs outside workerd and uses one or two executor threads as labeled. All four implementations perform equivalent HTTP fan-out and checksum aggregation; both Rust implementations share the same async core. Tokio synchronization runs inside the Wasm app, while workerd supplies its event loop and fetch.','',
`Statistics are medians of ${datasets.closed.meta.config.rounds} per-round statistics, with fresh application processes, ${datasets.closed.meta.config.warmup}s warm-up at each tested load and ${datasets.closed.meta.config.seconds}s measured per block. Every successful response was independently byte-validated. Origin byte/request totals, idle state, capacity recovery, artifact hashes and normal process scheduling were checked. No outliers were removed. See [io/README.md](io/README.md) for protocols, resource limits and reproduction.`, '',
'## Closed-loop goodput without rejection','',
'For each workload/entrant, this selects the highest median among tested client concurrencies whose **every round** had zero rejection or dropped offers. It is a point in this finite sweep, not proof of a global throughput maximum.','',
'| Entrant | Workload | Clients | Successful aggregates/s | MiB/s from origin | p50 ms | p95 ms | App CPU ms/success |',
'|---|---|---:|---:|---:|---:|---:|---:|'];
for(const g of best){const b=g[0];lines.push(`| ${b.variant} | ${b.profile} | ${b.load} | ${fmt(med(g,b=>b.goodput))} | ${fmt(med(g,b=>b.mibPerSec))} | ${fmt(med(g,b=>b.p50),2)} | ${fmt(med(g,b=>b.p95),2)} | ${fmt(med(g,b=>b.cpuMs.app/b.successes),3)} |`);}
lines.push('','## Closed-loop scaling','','`serial`, `fanout6` and `fanout12` fetch 12 × 4 KiB with 10 ms of requested header delay. `stream64k` fetches 8 × 64 KiB with immediate headers and four delayed body chunks (8 ms requested total, plus timer/scheduling overhead). Concurrency is incoming clients; fan-out is within each request. Goodput excludes HTTP 503 responses. Latency quantiles below are for successful responses only; rejection percentage must be read alongside them.','',
'| Entrant | Workload | Clients | Goodput/s | Round goodput range | p50 ms | p95 ms | Rejected % | Origin peak in flight |',
'|---|---|---:|---:|---|---:|---:|---:|---:|');
for(const g of closed){const b=g[0],rates=g.map(b=>b.goodput);lines.push(`| ${b.variant} | ${b.profile} | ${b.load} | ${fmt(median(rates))} | ${fmt(Math.min(...rates))}–${fmt(Math.max(...rates))} | ${fmt(med(g,b=>b.p50),2)} | ${fmt(med(g,b=>b.p95),2)} | ${fmt(med(g,b=>100*(b.counts[503]??0)/b.offered),2)} | ${fmt(med(g,b=>b.upstream.peak),0)} |`);}
lines.push('','## Fixed arrival rates and overload','','Offers are scheduled independently of prior completions. The client admits at most 512 outstanding requests; excess offers count as dropped. There are no retries. Goodput includes draining outstanding responses after arrivals stop; window goodput counts successes completed during the fixed arrival interval. Scheduled p95 includes client dispatch delay. Read rejection/drop rates with success latency to avoid survivor bias.','',
'| Entrant | Workload | Offered/s | Goodput/s | Window goodput/s | Rejected % | Dropped % | Success p95 ms | Scheduled p95 ms | Dispatch lag p95 ms |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for(const g of groups(datasets.open.blocks).sort((a,b)=>a[0].variant.localeCompare(b[0].variant)||a[0].load-b[0].load)){const b=g[0];lines.push(`| ${b.variant} | ${b.profile} | ${b.load} | ${fmt(med(g,b=>b.goodput))} | ${fmt(med(g,b=>b.windowGoodput))} | ${fmt(med(g,b=>100*(b.counts[503]??0)/b.offered),2)} | ${fmt(med(g,b=>100*b.dropped/b.offered),2)} | ${fmt(med(g,b=>b.p95),2)} | ${fmt(med(g,b=>b.scheduledP95),2)} | ${fmt(med(g,b=>b.dispatchLagP95),2)} |`);}
lines.push('','## Direct origin control','','These requests bypass the application and consume one shard each. Rates are **shards/s**, not aggregate requests/s. Compare against gateway goodput multiplied by shard count (12 or 8). The origin uses two native Tokio threads on separate cores. This control and per-process CPU help identify upstream/client limitations; they do not eliminate all shared-host interference.','',
'| Profile | Clients | Shards/s | MiB/s | p95 ms | Origin CPU ms/shard | Client CPU ms/shard |',
'|---|---:|---:|---:|---:|---:|---:|');
for(const g of groups(datasets.origin.blocks).sort((a,b)=>a[0].profile.localeCompare(b[0].profile)||a[0].load-b[0].load)){const b=g[0];lines.push(`| ${b.profile} | ${b.load} | ${fmt(med(g,b=>b.goodput))} | ${fmt(med(g,b=>b.mibPerSec))} | ${fmt(med(g,b=>b.p95),2)} | ${fmt(med(g,b=>b.cpuMs.origin/b.successes),3)} | ${fmt(med(g,b=>b.cpuMs.client/b.successes),3)} |`);}
const smallControls=groups(datasets.origin.blocks).filter(g=>g[0].profile==='fanout6');
const nativeOpen=groups(datasets.open.blocks).filter(g=>g[0].variant.startsWith('tokio-')&&g[0].profile==='fanout6');
const streamControls=groups(datasets.origin.blocks).filter(g=>g[0].profile==='stream64k');
if(smallControls.length&&nativeOpen.length)lines.push('',`The highest median small-shard control is ${fmt(Math.max(...smallControls.map(g=>med(g,b=>b.goodput))),0)} shards/s; the highest median native Tokio open-loop result consumes ${fmt(12*Math.max(...nativeOpen.map(g=>med(g,b=>b.goodput))),0)} shards/s. Compare these rates before interpreting native saturation: the origin is not an unlimited dependency.`);
if(streamControls.length)lines.push('',`The direct streaming control's highest median Node client CPU usage is ${fmt(Math.max(...streamControls.map(g=>med(g,b=>100*b.cpuMs.client/b.elapsedMs))),1)}% of one core. Near 100%, this control becomes client-limited and cannot establish the origin's intrinsic ceiling.`);
const jsStream=closed.find(g=>g[0].variant==='js-io'&&g[0].profile==='stream64k'&&g[0].load===32);
if(jsStream)lines.push('',`JavaScript streaming at 32 clients ranges from ${fmt(Math.min(...jsStream.map(b=>b.goodput)),0)} to ${fmt(Math.max(...jsStream.map(b=>b.goodput)),0)} aggregates/s. The slower rounds are retained. These measurements do not diagnose variation as a particular JIT, GC, or scheduling effect.`);
lines.push('','Low-concurrency serial blocks contain few observations; their tail quantiles need longer runs for reliable capacity planning.');
lines.push('','## Memory and interpretation','','| Entrant | Maximum process RSS MiB | Maximum process HWM MiB | Maximum Wasm linear memory MiB |','|---|---:|---:|---:|');
for(const variant of datasets.closed.meta.config.variants){const b=[...datasets.closed.blocks,...datasets.open.blocks].filter(b=>b.variant===variant);lines.push(`| ${variant} | ${fmt(Math.max(...b.map(b=>b.after.app.rssKB))/1024)} | ${fmt(Math.max(...b.map(b=>b.after.app.peakRssKB))/1024)} | ${variant==='rust-io'?fmt(Math.max(...b.map(b=>b.application.wasmMemoryBytes))/1048576):'—'} |`);}
lines.push('','RSS includes the whole process (V8/compiler/runtime code and native allocations), not just Worker isolate memory. Application body reservations cap at 32 MiB; Wasm linear memory caps at 64 MiB. Neither alone proves total hosted isolate memory compliance. Native two-thread throughput uses two application cores; workerd still has one application execution thread even though its runtime can use background threads.','',
'Cloudflare documents a six-connection limit while waiting for headers; local external-service bindings are not proof of hosted enforcement. Observed fan-out above six here must not be interpreted as permission to bypass hosted limits. The delayed-body profile measures a different phase: headers have already arrived. See [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections).','',
'All overload rejections are explicit admission decisions; they are excluded from goodput. At high offered rates, check client CPU and dispatch lag as well as application/origin CPU before attributing a limit to one runtime. Two-second samples are suitable for this controlled comparison, not a long-duration production capacity guarantee.','',
'The first prototype’s cross-request promise queue failed workerd liveness detection under load; final admission reserves capacity synchronously. TCP_NODELAY was also necessary to avoid a delayed-ACK/Nagle artifact in the controlled origin. Both changes are included in every final entrant.','',
'## Artifacts','',
'- [Correctness and overload validation](results/io-validation.txt)',
'- [Closed-loop raw samples and provenance, gzip JSON](results/io-closed.json.gz)',
'- [Fixed-arrival raw samples and provenance, gzip JSON](results/io-open.json.gz)',
'- [Direct-origin raw samples and provenance, gzip JSON](results/io-origin.json.gz)',
'- [Archive byte counts and SHA-256 hashes](results/io-archives.json)',
'- [Final integrity audit](results/io-audit.json)','');
writeFileSync('IO-RESULTS.md',lines.join('\n'));console.log('Wrote IO-RESULTS.md');
