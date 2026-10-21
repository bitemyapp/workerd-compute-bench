# workerd compute benchmark

Equivalent JavaScript and Rust/Wasm services for image processing and exact vector search, with correctness tests, measured optimization experiments, and an external HTTP benchmark. See [RESULTS.md](RESULTS.md) for measurements and [results/](results/) for raw samples.

The JavaScript application runs unchanged in workerd or the supplied Node adapter. The comparison runs **both applications inside workerd**, with Rust compiled to `wasm32-unknown-unknown`. Node runs the load generator; it is not the measured JavaScript server. Rust uses a thin shared JavaScript HTTP shell and a dependency-free Wasm compute core. This repository does not benchmark native Rust or geographically distributed Cloudflare deployment.

## Reproduce

On this NixOS machine:

```sh
cd /home/callen/work/workerd-compute-bench
mkdir -p .tools
nix print-dev-env > .tools/env
source .tools/env
eval "$shellHook"
npm ci
npm run build
npm test
bash scripts/bench-local.sh
```

The locked Nix shell supplies Node 24, Binaryen, Rustup, and a glibc loader for the npm workerd ELF on NixOS. Rustup installs the version and Wasm target pinned in `rust-toolchain.toml`. Outside Nix, install those tools, then use the same npm commands. The workerd version is pinned in `package-lock.json`. No Cloudflare account or credentials are needed.

For less scheduler noise on Linux, reserve separate physical cores for the client and the workerd process (including its background compiler/GC threads):

```sh
BENCH_CPU=2,3 VARIANTS=js-flat,rust-manual-o3 \
  ROUNDS=5 SECONDS=1.5 SAMPLES=120 \
  OUTPUT=results/my-run.json taskset -c 0 bash scripts/bench-local.sh
```

Choose CPUs valid for your machine. Leave `BENCH_CPU` unset on macOS. Ports 8787 (workerd) and 8790 (controlled origin) must be free. Run benchmark processes sequentially. The harness stops its own workerd and origin processes, validates every response, and writes results after each measured block. A completed modern result has `meta.complete: true`.

This workstation automatically demotes directly executed Node processes to Linux `SCHED_IDLE`/nice 16. The launcher uses the same glibc loader for Node and workerd to preserve normal scheduling, without modifying other processes or global settings. On Linux it requires `SCHED_OTHER` for both processes at the start and end of every measured block; it aborts if the policy changes. Use the direct `bash scripts/bench-local.sh` command from a normal-priority shell on this host. `BENCH_NODE_LOADER` can override the loader; ordinary Linux/macOS systems can run Node directly. Early tuning artifacts predate this audit and are exploratory. The published final runs all pass the scheduling checks.

Run either service yourself:

```sh
npm run serve
# Or: bash scripts/workerd.sh serve build/rust-manual-o3.capnp
# Or, outside the comparison: VARIANT=js-flat node scripts/node-server.mjs
```

With a service running, `node scripts/example.mjs image` writes an input image and its edge mask as PGM files in `build/`; `node scripts/example.mjs search` prints actual ranked matches and scores.

## Services and binary protocol

Both services expose identical POST endpoints; all sizes and query parameters are validated before allocation. Inputs and results are actual data, with no hidden repeated-work multiplier or cached answers.

| Endpoint | Input | Result |
|---|---|---|
| `/image?w=1024&h=1024` | `w*h` grayscale bytes, row-major | `w*h` bytes: binomial Gaussian blur followed by Sobel edge magnitude |
| `/search?n=32768&d=128&q=8&k=10` | Signed int8 candidate matrix (`n*d` bytes), then query matrix (`q*d` bytes) | For each query, `k` records: uint32 candidate ID then int32 dot-product score, both little-endian |
| `/noop` | Empty | `ok`, framework/HTTP latency control |
| `/transfer?bytes=1048576&out=1048576` | Exact `bytes` bytes | `out` zero bytes, same transfer and bounded-reader path without a kernel |
| `/health` | GET | JSON status and current scratch/linear-memory bytes |

Images have width/height 7–2048. The Gaussian is the outer product of `[1,4,6,4,1]`, divided by 256 with round-half-up **after both passes**. Sobel returns `min(255, abs(gx)+abs(gy))`; the outer three rows and columns are zero. This is an image preprocessing/edge-mask workload, not a JPEG/PNG codec benchmark.

Search supports 1–32768 candidates, dimensions 16–256 in multiples of 16, 1–16 queries, and 1–100 results (`k <= n`). Total input must be at most 8 MiB. Results are descending by score, with ascending candidate ID breaking ties. This is exact maximum-inner-product search over already quantized vectors, useful for a bounded search shard or reranking batch. Quantization, model inference, approximate indexing, cosine normalization, and a persistent corpus cache are outside the workload. Synthetic vector fixtures have the same data shape as quantized embeddings but do not model semantic retrieval quality.

`source=origin` fetches the payload through a fixed service binding before computing. The harness's local HTTP origin returns a fixture after a 10 ms timer. This adds real asynchronous HTTP I/O with a controlled delay; it does not simulate Cloudflare's network, KV, or R2 latency. The benchmark submits four different deterministic payloads cyclically for direct requests and checks all output bytes. The origin case uses one fixture.

## Measurement and constraints

Each variant runs alone in a fresh workerd process for each round. The final launcher checks normal Linux scheduling for client and server before and after every block. Workerd may use two P-cores for its runtime/compiler threads; the application itself uses one isolate and executes kernels on one thread. Within a process the cases run in a fixed order. Variant order rotates and reverses between rounds. Before recording a case, the harness measures its first invocation and then warms it for a minimum count **and** duration. Recorded latency starts immediately before the Node HTTP request and ends after the full response body arrives. Validation happens after the latency clock stops. There are no internal Worker timers in the measurement.

The sequential runs measure warm end-to-end latency and achieved request rate. Separate concurrency-four runs show queueing/throughput under a closed-loop client. They are not open-loop capacity tests and are subject to coordinated omission. Each case stops only after both its minimum sample count and minimum time have elapsed. Quantiles use nearest rank. Per-block samples and summaries, source hashes, fixture/output hashes, toolchain versions, CPU details, affinity, governor, and load are retained. Reported process CPU uses Linux `/proc/PID/stat` deltas divided by requests; its granularity is recorded in `clockTicks`. It includes workerd's HTTP, GC, and runtime overhead and is **not** Cloudflare's billed CPU metric. RSS/high-water RSS cover the entire process, not a single isolate.

The fixed Rust arena reserves 24 MiB; the linked memory maximum is 32 MiB. No memory growth, threads, allocator, WASI, or native libraries are used by the compute core. Bulk input crosses into Wasm once, and the result is copied out before returning control. All scratch use is synchronous, so concurrent request bodies cannot interleave accesses to the arena. JavaScript reuses typed scratch arrays, with a fresh owned output for each response. Admission limits permit at most four body reads and at most 24 MiB of requested input concurrently. Excess demand receives 503. These application bounds leave headroom under the Workers memory budget, but local process RSS cannot certify hosted isolate accounting.

The optimized reader uses Workers' BYOB `readAtLeast` extension with a buffer one byte larger than the expected body. That both detects extra bytes and avoids the overhead of receiving/copying every small chunk in JavaScript. A bounded default-reader fallback supports the Node adapter. The `*-chunked` variants retain the previous reader for an apples-to-apples experiment.

The final comparison uses a tested order scheduler that balances each entrant's position over pairs of rounds. Earlier tuning had a rotation/reversal combination that kept two-entrant experiments in fixed order. An audit caught this before the published final runs; `incomplete-order-run.json` is the interrupted run and is excluded from the final report. Early tuning is exploratory evidence, not the final comparison.

Cold measurements are deliberately named `processStartupMs` (launch through first health response) and `firstInvocationMs` (first use of that case in a process). They are **not** hosted isolate cold starts. All correctness and benchmark execution is local. Do not derive cloud bills, global latency, or native-server comparisons from these results.

## Optimization experiments

The baseline already uses binary transport and typed arrays. It computes a direct 25-tap blur and sorts all vector scores. Optimized versions use a separable 5+5-tap blur and a bounded sorted top-k buffer, updating only when a candidate beats the current threshold. Small k makes the insertion work negligible compared with scoring. Exact answers and integer rounding are preserved.

JavaScript experiments include a scalar dot loop, four accumulators, 16-wide unrolling, and generated straight-line dot products for common dimensions. Rust experiments include scalar LLVM output, SIMD128 dot products, explicit eight-pixel SIMD image processing, speed versus size Rust profiles, and Binaryen `-O3`/`-Oz`. Raw experiment files preserve rejected choices as well as successful ones. Optimal code depends on workload size, CPU, V8 version, and latency versus binary-size priorities; this is an evidence-based local tuning exercise, not a proof of a universal optimum.

To inspect a CPU profile in Chrome DevTools:

```sh
node scripts/profile.mjs js-flat '/search?n=32768&d=128&q=8&k=10'
node scripts/profile.mjs rust-manual-o3 '/image?w=1024&h=1024'
```

Profiles go in `results/profiles/`. Inspector/profiling is disabled during all benchmark runs. Profile results include instrumentation overhead and are diagnostic only.

## Regenerate the published comparison

After building and testing, run the following inside the Nix shell on the recorded machine. They intentionally overwrite the three final JSON artifacts and regenerate `RESULTS.md`. On another system, choose appropriate CPU IDs or remove affinity settings. The default `npm run bench` instead writes `results/benchmark.json`, leaving the published evidence intact.

```sh
BENCH_CPU=2,3 ROUNDS=5 SAMPLES=120 SECONDS=1.2 WARMUPS=80 WARMUP_SECONDS=1 \
  OUTPUT=results/final-sequential.json taskset -c 0 bash scripts/bench-local.sh
BENCH_CPU=2,3 ROUNDS=3 SAMPLES=120 SECONDS=1.2 WARMUPS=80 WARMUP_SECONDS=1 \
  CONCURRENCY=4 CASES=image-1024,search-large,image-io \
  OUTPUT=results/final-concurrency4.json taskset -c 0 bash scripts/bench-local.sh
BENCH_CPU=2,3 ROUNDS=3 SAMPLES=60 SECONDS=0.75 WARMUPS=50 WARMUP_SECONDS=0.75 \
  VARIANTS=js-baseline,js-flat,rust-baseline,rust-manual-o3 CASES=image-1024,search-large \
  OUTPUT=results/final-baselines.json taskset -c 0 bash scripts/bench-local.sh
npm run report
```

## Runtime references

The supplied conversation guided the experiment. Current primary documentation was checked on 2026-10-21:

- [workerd](https://github.com/cloudflare/workerd): the JavaScript/Wasm runtime underlying Workers; local hosting is distinct from Cloudflare's platform.
- [Workers Wasm support](https://developers.cloudflare.com/workers/runtime-apis/webassembly/): SIMD is available, threading is unavailable, and larger modules affect startup.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 128 MB per-isolate memory including Wasm; CPU limits vary by plan. The current size table differs from the older figures in the pasted discussion, so this project records artifact sizes instead of relying on those figures.
- [Performance timers](https://developers.cloudflare.com/workers/runtime-apis/performance/): hosted timers advance with I/O; local behavior can differ. External measurement avoids relying on either behavior.
- [BYOB reader](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestreambyobreader/): `readAtLeast` supports efficient bounded bulk reads.
