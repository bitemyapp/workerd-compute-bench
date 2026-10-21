# Local workerd benchmark results

Measured 2026-10-21T09:03:48.573Z through 2026-10-21T09:09:36.721Z. Runtime: workerd 2026-10-21; Node client v24.21.0; rustc 1.99.0 (b940084d7 2026-09-28); wasm-opt version 132. CPU: Intel(R) Core(TM) Ultra 7 365; 7.2.10. Server CPU 2,3; pid 667289's current affinity list: 0; governor powersave.

All reported quantiles and request rates below are **medians of per-round statistics**, not a single fastest run. See the round ranges for variability. Latency includes HTTP, request reading, compute, Wasm copies where applicable, and the complete response body. Process CPU is measured independently and is not Cloudflare billing data. Every measured response was byte-validated.

## Optimized comparison

5 fresh-process rounds per entrant, at least 120 requests and 1.2 seconds per case/round, concurrency 1. Warm-up: at least 80 calls and 1 seconds per case.

| Workload | js-flat p50 ms | rust-manual-o3 p50 ms | JS / Rust latency |
|---|---:|---:|---:|
| noop | 0.066 | 0.068 | 0.98× |
| transfer-image | 1.396 | 1.443 | 0.97× |
| transfer-search | 1.545 | 1.566 | 0.99× |
| image-256 | 0.829 | 0.253 | 3.28× |
| image-1024 | 8.632 | 2.345 | 3.68× |
| search-small | 0.633 | 0.232 | 2.73× |
| search-large | 25.096 | 4.213 | 5.96× |
| image-io | 13.267 | 11.729 | 1.13× |

| Variant | Workload | p50 ms | p95 ms | p99 ms | req/s | CPU ms/req | Round p50 range ms |
|---|---|---:|---:|---:|---:|---:|---|
| js-flat | noop | 0.066 | 0.082 | 0.183 | 13232.8 | 0.041 | 0.062–0.068 |
| rust-manual-o3 | noop | 0.068 | 0.100 | 0.300 | 11600.5 | 0.044 | 0.066–0.069 |
| js-flat | transfer-image | 1.396 | 3.881 | 5.981 | 576.4 | 0.853 | 1.354–1.459 |
| rust-manual-o3 | transfer-image | 1.443 | 4.167 | 6.562 | 552.9 | 0.838 | 1.342–1.518 |
| js-flat | transfer-search | 1.545 | 1.915 | 2.274 | 625.4 | 1.331 | 1.525–1.591 |
| rust-manual-o3 | transfer-search | 1.566 | 2.004 | 2.627 | 610.3 | 1.301 | 1.517–1.737 |
| js-flat | image-256 | 0.829 | 1.261 | 3.300 | 1076.5 | 0.657 | 0.687–1.084 |
| rust-manual-o3 | image-256 | 0.253 | 0.607 | 3.259 | 2774.5 | 0.208 | 0.248–0.256 |
| js-flat | image-1024 | 8.632 | 11.865 | 13.306 | 109.3 | 8.030 | 8.077–14.756 |
| rust-manual-o3 | image-1024 | 2.345 | 4.575 | 7.108 | 369.7 | 1.770 | 2.196–2.609 |
| js-flat | search-small | 0.633 | 1.069 | 2.987 | 1409.1 | 0.507 | 0.623–0.696 |
| rust-manual-o3 | search-small | 0.232 | 0.313 | 0.841 | 3897.5 | 0.202 | 0.214–0.237 |
| js-flat | search-large | 25.096 | 27.233 | 27.714 | 39.6 | 24.667 | 23.810–33.424 |
| rust-manual-o3 | search-large | 4.213 | 4.635 | 4.902 | 235.2 | 3.852 | 3.975–4.783 |
| js-flat | image-io | 13.267 | 15.122 | 16.515 | 74.0 | 2.500 | 13.131–33.743 |
| rust-manual-o3 | image-io | 11.729 | 14.289 | 16.225 | 81.3 | 1.083 | 11.702–12.307 |

The transfer controls use the same payload and response sizes as the large compute cases, with no compute kernel. They help reveal transport overhead; subtracting their medians would not be an exact isolated-kernel measurement. `image-io` includes a real local origin fetch delayed by a 10 ms timer.

## Concurrent requests

Four closed-loop clients share one workerd process and one isolate. CPU kernels remain single-threaded; queueing affects latency. This is achieved throughput at concurrency four, not an open-loop saturation or global capacity claim.

| Variant | Workload | p50 ms | p95 ms | p99 ms | req/s | CPU ms/req | Round p50 range ms |
|---|---|---:|---:|---:|---:|---:|---|
| js-flat | image-1024 | 36.158 | 39.855 | 48.328 | 109.5 | 9.111 | 34.534–37.969 |
| rust-manual-o3 | image-1024 | 7.545 | 14.519 | 17.693 | 476.9 | 1.878 | 6.765–8.205 |
| js-flat | search-large | 109.888 | 111.619 | 113.282 | 36.4 | 27.250 | 107.539–131.466 |
| rust-manual-o3 | search-large | 17.070 | 19.054 | 22.422 | 232.3 | 4.255 | 16.786–19.135 |
| js-flat | image-io | 20.041 | 25.029 | 28.489 | 198.1 | 2.365 | 19.990–21.819 |
| rust-manual-o3 | image-io | 13.020 | 15.873 | 17.833 | 300.4 | 0.687 | 13.005–13.039 |

## Algorithm baselines under the final HTTP reader

These independent runs use the same BYOB transport for every entrant, separating algorithm choices from the earlier body-reader improvement. Baselines do a direct 25-tap blur and full score sort; optimized versions use separable filtering and bounded top-k selection.

| Variant | Workload | p50 ms | p95 ms | p99 ms | req/s | CPU ms/req | Round p50 range ms |
|---|---|---:|---:|---:|---:|---:|---|
| js-baseline | image-1024 | 34.032 | 36.164 | 38.077 | 29.1 | 33.500 | 31.193–41.740 |
| js-flat | image-1024 | 9.713 | 12.409 | 14.290 | 98.4 | 8.784 | 8.695–10.172 |
| rust-baseline | image-1024 | 15.572 | 18.102 | 20.177 | 62.6 | 14.500 | 13.885–16.003 |
| rust-manual-o3 | image-1024 | 2.555 | 6.043 | 7.193 | 328.3 | 1.862 | 2.350–3.007 |
| js-baseline | search-large | 81.982 | 83.930 | 85.217 | 12.2 | 81.333 | 75.820–84.914 |
| js-flat | search-large | 29.348 | 30.005 | 32.059 | 34.1 | 28.500 | 26.924–29.457 |
| rust-baseline | search-large | 22.292 | 23.581 | 24.572 | 44.5 | 21.667 | 20.288–22.381 |
| rust-manual-o3 | search-large | 4.495 | 6.639 | 7.319 | 207.9 | 3.974 | 4.101–4.585 |

## Optimization experiments retained

Each table uses its own experiment, host state, and source hashes. Compare variants within an experiment; absolute timings across experiments can drift. Early experiments used shorter warm-ups. The final runs above use the final code and longer warm-ups.

### tuning-initial.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-baseline | image-1024 | 31.836 |
| js-baseline | search-large | 80.232 |
| js-scalar | image-1024 | 10.350 |
| js-scalar | search-large | 34.592 |
| js-optimized | image-1024 | 10.538 |
| js-optimized | search-large | 31.301 |
| rust-baseline | image-1024 | 15.178 |
| rust-baseline | search-large | 27.170 |
| rust-scalar | image-1024 | 10.327 |
| rust-scalar | search-large | 22.195 |
| rust-simd | image-1024 | 4.519 |
| rust-simd | search-large | 12.170 |
| rust-small | image-1024 | 10.036 |
| rust-small | search-large | 11.731 |
| rust-simd-o3 | image-1024 | 4.606 |
| rust-simd-o3 | search-large | 11.596 |
| rust-simd-oz | image-1024 | 4.664 |
| rust-simd-oz | search-large | 11.275 |

### tuning-simd-unroll.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-optimized | image-1024 | 10.473 |
| js-optimized | search-large | 31.386 |
| js-unrolled | image-1024 | 17.333 |
| js-unrolled | search-large | 37.255 |
| js-specialized | image-1024 | 10.829 |
| js-specialized | search-large | 38.825 |
| rust-simd | image-1024 | 4.475 |
| rust-simd | search-large | 11.323 |
| rust-manual | image-1024 | 4.169 |
| rust-manual | search-large | 11.114 |
| rust-manual-o3 | image-1024 | 4.138 |
| rust-manual-o3 | search-large | 11.170 |

### tuning-body-reader.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-chunked | transfer-image | 3.452 |
| js-chunked | transfer-search | 8.981 |
| js-chunked | image-1024 | 10.585 |
| js-chunked | search-large | 31.772 |
| js-optimized | transfer-image | 1.540 |
| js-optimized | transfer-search | 1.789 |
| js-optimized | image-1024 | 9.407 |
| js-optimized | search-large | 25.520 |
| rust-chunked | transfer-image | 3.404 |
| rust-chunked | transfer-search | 9.182 |
| rust-chunked | image-1024 | 4.350 |
| rust-chunked | search-large | 11.585 |
| rust-manual | transfer-image | 1.519 |
| rust-manual | transfer-search | 1.680 |
| rust-manual | image-1024 | 2.445 |
| rust-manual | search-large | 4.334 |

### tuning-final-kernels.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-optimized | image-1024 | 11.438 |
| js-optimized | search-large | 29.992 |
| js-linear | image-1024 | 10.870 |
| js-linear | search-large | 31.078 |
| rust-manual | image-1024 | 3.898 |
| rust-manual | search-large | 6.637 |
| rust-unroll | image-1024 | 3.890 |
| rust-unroll | search-large | 7.143 |
| rust-unroll-o3 | image-1024 | 3.865 |
| rust-unroll-o3 | search-large | 6.634 |

### tuning-js-fast.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-optimized | image-1024 | 9.089 |
| js-optimized | search-large | 25.672 |
| js-fast | image-1024 | 8.684 |
| js-fast | search-large | 25.502 |

### tuning-scratch-growth.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-fast | image-256 | 0.954 |
| js-fast | image-1024 | 75.762 |
| js-fast | image-io | 29.986 |
| js-fixed | image-256 | 0.968 |
| js-fixed | image-1024 | 135.831 |
| js-fixed | image-io | 44.343 |

### tuning-split-passes.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-split | noop | 0.067 |
| js-split | transfer-image | 1.443 |
| js-split | transfer-search | 1.700 |
| js-split | image-256 | 0.853 |
| js-split | image-1024 | 11.439 |
| js-split | search-small | 2.002 |
| js-split | search-large | 28.300 |
| js-split | image-io | 14.165 |

### tuning-vector-phases.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-phased | image-256 | 1.126 |
| js-phased | image-1024 | 16.693 |
| js-phased | search-small | 0.784 |
| js-phased | search-large | 33.493 |
| js-phased | image-io | 33.351 |

### tuning-flat-loops.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-flat | image-256 | 1.174 |
| js-flat | image-1024 | 16.265 |
| js-flat | search-small | 0.692 |
| js-flat | search-large | 31.026 |
| js-flat | image-io | 15.538 |

### tuning-prime.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-primed | image-256 | 1.080 |
| js-primed | image-1024 | 14.801 |
| js-primed | search-small | 0.719 |
| js-primed | search-large | 31.144 |
| js-primed | image-io | 15.598 |

### tuning-normal-scheduler.json

| Variant | Workload | Median round p50 ms |
|---|---|---:|
| js-flat | image-256 | 0.874 |
| js-flat | image-1024 | 8.242 |
| js-flat | search-small | 0.669 |
| js-flat | search-large | 24.845 |
| js-flat | image-io | 13.153 |
| rust-simd | image-256 | 0.280 |
| rust-simd | image-1024 | 2.743 |
| rust-simd | search-small | 0.224 |
| rust-simd | search-large | 4.063 |
| rust-simd | image-io | 11.944 |
| rust-manual-o3 | image-256 | 0.248 |
| rust-manual-o3 | image-1024 | 2.271 |
| rust-manual-o3 | search-small | 0.222 |
| rust-manual-o3 | search-large | 4.059 |
| rust-manual-o3 | image-io | 11.858 |

The final JavaScript entry loads only its small dedicated hot kernels; the experimental branches and generated dot-product code are excluded. Rust uses explicit image SIMD and SIMD dot products, `opt-level=3`, LTO, one codegen unit, aborting panics, and Binaryen `-O3`. More aggressive dot unrolling did not establish a consistent end-to-end benefit. The size-first Rust profile was slower on image processing. The initial CPU profiles revealed body-reading overhead; both implementations received the same bounded BYOB improvement. Optimization remains hardware/workload dependent.

Mixed-size runs exposed severe JavaScript phase-transition regressions. [Before](results/deopt-before.log) and [after](results/deopt-after.log) diagnostic traces show that splitting image phases removed repeated Maglev deoptimizations in that diagnostic and allowed TurboFan optimization. The final `js-flat` variant also separates vector scoring/selection and flattens the image loops, computing and then clearing unused border values. Maximum scratch preallocation and tiny startup priming did not establish consistent improvements, so they were rejected. Fresh-process timing still varies substantially: the final tables include every round and all outliers rather than promising complete JIT stability. The [mixed-workload trace](results/trace-mixed.log) is diagnostic only; tracing changes scheduling and its timings are excluded. Diagnostic V8 flags are absent from the final runs. `mixed-size-regression.json` and `search-phase-regression.json` are interrupted investigative runs, not final results. `incomplete-order-run.json` was interrupted when an audit found the two-entrant order was not counterbalanced; the final scheduler is tested and corrected.

Scheduler audit: directly executed Node was automatically demoted to Linux SCHED_IDLE/nice 16 on this workstation, and its later children inherited that policy. The final launcher runs the same Node binary through the glibc loader and checks SCHED_OTHER (policy 0) for both client and workerd before and after every block. Earlier experiments predate that control and are exploratory, not fair final latency estimates. `idle-scheduler-run.json` and `tuning-normal-rejected.json` are interrupted and excluded; the latter also confirmed severe regressions in the rejected monolithic JS variant at normal priority. The final workerd affinity permits two P-cores so background V8 compiler/GC threads are not artificially confined with the single application isolate to one core; client affinity is separate. Application kernels remain single-threaded. No other processes or global scheduler settings were changed.

The three runs in `results/pre-client-fix/` were superseded after removing eager full-response UTF-8 decoding from a success-path assertion message. The final client decodes only a short error prefix on failure; byte-for-byte validation still occurs after each latency measurement. See `results/rebuild-verification.json` for byte-identical clean-install/build verification.

## Footprint and startup observations

| Wasm artifact | Raw bytes | gzip bytes |
|---|---:|---:|
| manual-o3.wasm | 33605 | 14653 |
| manual.wasm | 35992 | 15002 |
| scalar.wasm | 29338 | 12167 |
| simd-o3.wasm | 33322 | 14614 |
| simd-oz.wasm | 33306 | 14639 |
| simd.wasm | 35791 | 15092 |
| small.wasm | 23564 | 9665 |
| unroll-o3.wasm | 33991 | 14749 |
| unroll.wasm | 36322 | 15100 |

| Entrant | Maximum observed scratch/linear memory MiB | Peak process RSS MiB | Median process launch-to-health ms |
|---|---:|---:|---:|
| js-flat | 3.00 | 399.80 | 16.077 |
| rust-manual-o3 | 24.31 | 412.93 | 15.934 |

Scratch/linear memory is not total isolate memory. RSS covers the complete local workerd process and cannot be compared directly with the hosted 128 MB isolate limit. The 24 MiB Rust arena has a 32 MiB linked maximum; input admission and result sizes are bounded. Gzip sizes cover each Wasm artifact, not a deployable bundle. Process launch-to-health includes the health request and polling interval; it is not a Cloudflare cold-start measurement. Per-case first invocation times are preserved in raw JSON.

## Evidence and limitations

- [Sequential raw samples](results/final-sequential.json), [concurrency-four samples](results/final-concurrency4.json), [baseline samples](results/final-baselines.json).
- [Correctness test output](results/validation.txt): independent oracle cases, all build variants, HTTP equivalence, boundaries, chunked bodies, concurrent distinct inputs, and maximum sizes.
- [README](README.md) describes protocols, reproduction, and primary runtime references.
- Final source commit: `036c578cb32ab15bc783bee02a690a86e4cf257a`. The JSON embeds exact source/build hashes and toolchain metadata. Results/report commits occur afterward.
- Load averages at sequential run start/end: [1.54,3.23,4.13] / [24.45,11.71,7.02]. This workstation was not an isolated lab machine; scheduling, frequency changes, GC, and background work can affect tails. No outliers were removed.
- Early `incomplete-build-run.json` is explicitly incomplete and excluded: an unrooted Binaryen tool was garbage-collected by Nix, causing the build to stop before all artifacts existed. The tool was rooted, builds gained hash manifests, and the experiment was rerun successfully.
- Synthetic images contain gradients, edges, and noise; vectors use deterministic int8 values. Results describe these workloads, not every Node/Rust application.
- No native Rust entrant, hosted Workers execution, multiregion network tests, billing estimate, or universal optimality claim is made.
