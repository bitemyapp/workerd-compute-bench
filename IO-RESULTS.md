# I/O concurrency results

Measured 2026-10-21T09:35:39.812Z through 2026-10-21T09:50:07.457Z. CPU: Intel(R) Core(TM) Ultra 7 365; workerd 2026-10-21; Node v24.21.0. Source commit: `16c95614c21b7e76269481871e46d9fa18e79e72`. Each application gets CPUs 2,3; the native Tokio origin gets CPUs 4,5; client: pid 678363's current affinity list: 0.

These are local, workload-specific measurements. JavaScript and Rust/Wasm each run in one workerd isolate. Native Tokio runs outside workerd and uses one or two executor threads as labeled. All four implementations perform equivalent HTTP fan-out and checksum aggregation; both Rust implementations share the same async core. Tokio synchronization runs inside the Wasm app, while workerd supplies its event loop and fetch.

Statistics are medians of 3 per-round statistics, with fresh application processes, 0.5s warm-up at each tested load and 2s measured per block. Every successful response was independently byte-validated. Origin byte/request totals, idle state, capacity recovery, artifact hashes and normal process scheduling were checked. No outliers were removed. See [io/README.md](io/README.md) for protocols, resource limits and reproduction.

## Closed-loop goodput without rejection

For each workload/entrant, this selects the highest median among tested client concurrencies whose **every round** had zero rejection or dropped offers. It is a point in this finite sweep, not proof of a global throughput maximum.

| Entrant | Workload | Clients | Successful aggregates/s | MiB/s from origin | p50 ms | p95 ms | App CPU ms/success |
|---|---|---:|---:|---:|---:|---:|---:|
| js-io | serial | 64 | 410.1 | 19.2 | 151.31 | 167.49 | 0.938 |
| js-io | fanout6 | 64 | 1239.8 | 58.1 | 47.51 | 80.04 | 0.743 |
| js-io | fanout12 | 32 | 1291.8 | 60.6 | 23.07 | 32.51 | 0.723 |
| js-io | stream64k | 32 | 794.0 | 397.0 | 38.66 | 46.18 | 1.222 |
| rust-io | serial | 64 | 399.9 | 18.7 | 149.20 | 199.24 | 0.919 |
| rust-io | fanout6 | 64 | 1124.2 | 52.7 | 52.19 | 92.22 | 0.802 |
| rust-io | fanout12 | 32 | 1229.8 | 57.6 | 24.12 | 32.52 | 0.763 |
| rust-io | stream64k | 32 | 759.4 | 379.7 | 40.61 | 46.55 | 1.277 |
| tokio-current | serial | 64 | 455.8 | 21.4 | 139.62 | 144.46 | 0.271 |
| tokio-current | fanout6 | 64 | 2587.5 | 121.3 | 24.47 | 26.37 | 0.172 |
| tokio-current | fanout12 | 32 | 2551.1 | 119.6 | 12.44 | 13.72 | 0.166 |
| tokio-current | stream64k | 32 | 1095.6 | 547.8 | 28.75 | 32.77 | 0.672 |
| tokio-multi | serial | 64 | 460.9 | 21.6 | 137.59 | 141.90 | 0.385 |
| tokio-multi | fanout6 | 64 | 2535.3 | 118.8 | 25.22 | 27.43 | 0.238 |
| tokio-multi | fanout12 | 32 | 2445.8 | 114.6 | 13.03 | 14.48 | 0.230 |
| tokio-multi | stream64k | 32 | 1178.4 | 589.2 | 26.81 | 29.24 | 0.799 |

## Closed-loop scaling

`serial`, `fanout6` and `fanout12` fetch 12 × 4 KiB with 10 ms of requested header delay. `stream64k` fetches 8 × 64 KiB with immediate headers and four delayed body chunks (8 ms requested total, plus timer/scheduling overhead). Concurrency is incoming clients; fan-out is within each request. Goodput excludes HTTP 503 responses. Latency quantiles below are for successful responses only; rejection percentage must be read alongside them.

| Entrant | Workload | Clients | Goodput/s | Round goodput range | p50 ms | p95 ms | Rejected % | Origin peak in flight |
|---|---|---:|---:|---|---:|---:|---:|---:|
| js-io | fanout12 | 1 | 76.7 | 76.2–77.0 | 12.95 | 13.91 | 0.00 | 12 |
| js-io | fanout12 | 8 | 581.5 | 532.2–595.3 | 13.02 | 16.21 | 0.00 | 96 |
| js-io | fanout12 | 32 | 1291.8 | 1029.4–1296.8 | 23.07 | 32.51 | 0.00 | 384 |
| js-io | fanout12 | 64 | 807.1 | 687.9–808.7 | 52.46 | 82.46 | 91.71 | 504 |
| rust-io | fanout12 | 1 | 75.7 | 74.3–76.5 | 13.21 | 13.92 | 0.00 | 12 |
| rust-io | fanout12 | 8 | 555.6 | 547.9–574.8 | 13.67 | 16.87 | 0.00 | 96 |
| rust-io | fanout12 | 32 | 1229.8 | 1195.7–1231.0 | 24.12 | 32.52 | 0.00 | 384 |
| rust-io | fanout12 | 64 | 750.5 | 739.3–751.6 | 54.52 | 128.95 | 91.78 | 504 |
| tokio-current | fanout12 | 1 | 82.7 | 82.4–83.1 | 12.02 | 12.61 | 0.00 | 12 |
| tokio-current | fanout12 | 8 | 646.0 | 638.1–646.1 | 12.33 | 13.56 | 0.00 | 96 |
| tokio-current | fanout12 | 32 | 2551.1 | 2532.1–2552.8 | 12.44 | 13.72 | 0.00 | 384 |
| tokio-current | fanout12 | 64 | 3342.0 | 3339.8–3351.7 | 12.84 | 14.28 | 93.89 | 504 |
| tokio-multi | fanout12 | 1 | 82.9 | 82.7–83.0 | 12.01 | 12.57 | 0.00 | 12 |
| tokio-multi | fanout12 | 8 | 652.6 | 645.3–656.7 | 12.34 | 13.06 | 0.00 | 96 |
| tokio-multi | fanout12 | 32 | 2445.8 | 2392.2–2486.2 | 13.03 | 14.48 | 0.00 | 384 |
| tokio-multi | fanout12 | 64 | 3439.5 | 3416.6–3450.6 | 12.41 | 13.91 | 94.89 | 504 |
| js-io | fanout6 | 1 | 40.0 | 40.0–40.6 | 24.96 | 25.99 | 0.00 | 6 |
| js-io | fanout6 | 8 | 309.7 | 301.7–311.0 | 25.20 | 28.50 | 0.00 | 48 |
| js-io | fanout6 | 32 | 1087.3 | 965.9–1096.2 | 27.35 | 39.82 | 0.00 | 192 |
| js-io | fanout6 | 64 | 1239.8 | 1047.4–1263.3 | 47.51 | 80.04 | 0.00 | 384 |
| rust-io | fanout6 | 1 | 39.8 | 38.7–39.9 | 25.13 | 25.91 | 0.00 | 6 |
| rust-io | fanout6 | 8 | 310.6 | 309.9–314.7 | 25.18 | 28.69 | 0.00 | 48 |
| rust-io | fanout6 | 32 | 1035.4 | 1031.3–1042.1 | 27.89 | 44.87 | 0.00 | 192 |
| rust-io | fanout6 | 64 | 1124.2 | 1011.4–1158.6 | 52.19 | 92.22 | 0.00 | 384 |
| tokio-current | fanout6 | 1 | 42.3 | 42.2–42.3 | 23.64 | 24.21 | 0.00 | 6 |
| tokio-current | fanout6 | 8 | 336.7 | 336.1–337.1 | 23.63 | 25.06 | 0.00 | 48 |
| tokio-current | fanout6 | 32 | 1324.5 | 1322.1–1327.2 | 23.95 | 25.70 | 0.00 | 192 |
| tokio-current | fanout6 | 64 | 2587.5 | 2568.8–2605.6 | 24.47 | 26.37 | 0.00 | 384 |
| tokio-multi | fanout6 | 1 | 42.3 | 42.2–42.5 | 23.67 | 24.14 | 0.00 | 6 |
| tokio-multi | fanout6 | 8 | 335.7 | 332.5–336.7 | 23.94 | 24.93 | 0.00 | 48 |
| tokio-multi | fanout6 | 32 | 1299.9 | 1278.0–1314.6 | 24.54 | 26.14 | 0.00 | 192 |
| tokio-multi | fanout6 | 64 | 2535.3 | 2529.9–2537.7 | 25.22 | 27.43 | 0.00 | 384 |
| js-io | serial | 1 | 6.9 | 6.8–7.0 | 144.70 | 148.14 | 0.00 | 1 |
| js-io | serial | 8 | 54.0 | 52.3–55.3 | 148.58 | 152.70 | 0.00 | 8 |
| js-io | serial | 32 | 211.3 | 197.6–215.4 | 150.40 | 158.25 | 0.00 | 32 |
| js-io | serial | 64 | 410.1 | 389.3–424.5 | 151.31 | 167.49 | 0.00 | 64 |
| rust-io | serial | 1 | 7.0 | 7.0–7.1 | 142.24 | 144.32 | 0.00 | 1 |
| rust-io | serial | 8 | 55.2 | 54.8–55.6 | 144.32 | 148.88 | 0.00 | 8 |
| rust-io | serial | 32 | 211.8 | 209.4–213.5 | 149.53 | 161.57 | 0.00 | 32 |
| rust-io | serial | 64 | 399.9 | 390.6–424.9 | 149.20 | 199.24 | 0.00 | 64 |
| tokio-current | serial | 1 | 7.3 | 7.2–7.3 | 137.56 | 138.79 | 0.00 | 1 |
| tokio-current | serial | 8 | 57.5 | 56.9–57.8 | 139.06 | 140.78 | 0.00 | 8 |
| tokio-current | serial | 32 | 229.1 | 227.0–229.1 | 139.10 | 143.35 | 0.00 | 32 |
| tokio-current | serial | 64 | 455.8 | 454.8–456.9 | 139.62 | 144.46 | 0.00 | 64 |
| tokio-multi | serial | 1 | 7.2 | 7.2–7.3 | 138.08 | 139.98 | 0.00 | 1 |
| tokio-multi | serial | 8 | 57.9 | 57.9–58.1 | 138.23 | 139.96 | 0.00 | 8 |
| tokio-multi | serial | 32 | 231.5 | 231.3–231.7 | 137.12 | 142.78 | 0.00 | 32 |
| tokio-multi | serial | 64 | 460.9 | 460.0–461.7 | 137.59 | 141.90 | 0.00 | 64 |
| js-io | stream64k | 1 | 35.9 | 35.6–37.3 | 27.01 | 27.78 | 0.00 | 6 |
| js-io | stream64k | 8 | 292.4 | 230.7–295.1 | 27.00 | 29.92 | 0.00 | 48 |
| js-io | stream64k | 32 | 794.0 | 297.9–823.9 | 38.66 | 46.18 | 0.00 | 192 |
| js-io | stream64k | 64 | 560.5 | 262.1–569.4 | 73.59 | 92.16 | 91.02 | 252 |
| rust-io | stream64k | 1 | 37.1 | 36.6–37.3 | 26.94 | 27.60 | 0.00 | 6 |
| rust-io | stream64k | 8 | 292.8 | 288.1–292.9 | 27.08 | 29.79 | 0.00 | 48 |
| rust-io | stream64k | 32 | 759.4 | 756.4–769.6 | 40.61 | 46.55 | 0.00 | 192 |
| rust-io | stream64k | 64 | 555.1 | 545.6–555.3 | 75.40 | 98.67 | 91.11 | 243 |
| tokio-current | stream64k | 1 | 38.4 | 38.4–38.4 | 26.20 | 26.89 | 0.00 | 6 |
| tokio-current | stream64k | 8 | 294.6 | 289.7–297.4 | 26.75 | 29.79 | 0.00 | 48 |
| tokio-current | stream64k | 32 | 1095.6 | 1086.2–1104.8 | 28.75 | 32.77 | 0.00 | 192 |
| tokio-current | stream64k | 64 | 1294.6 | 1280.9–1304.7 | 32.81 | 36.26 | 93.89 | 252 |
| tokio-multi | stream64k | 1 | 37.8 | 37.7–37.9 | 26.67 | 27.12 | 0.00 | 6 |
| tokio-multi | stream64k | 8 | 303.6 | 302.8–304.0 | 26.12 | 28.12 | 0.00 | 48 |
| tokio-multi | stream64k | 32 | 1178.4 | 1173.7–1190.6 | 26.81 | 29.24 | 0.00 | 192 |
| tokio-multi | stream64k | 64 | 1537.1 | 1531.0–1538.3 | 27.41 | 30.21 | 97.20 | 252 |

## Fixed arrival rates and overload

Offers are scheduled independently of prior completions. The client admits at most 512 outstanding requests; excess offers count as dropped. There are no retries. Goodput includes draining outstanding responses after arrivals stop; window goodput counts successes completed during the fixed arrival interval. Scheduled p95 includes client dispatch delay. Read rejection/drop rates with success latency to avoid survivor bias.

| Entrant | Workload | Offered/s | Goodput/s | Window goodput/s | Rejected % | Dropped % | Success p95 ms | Scheduled p95 ms | Dispatch lag p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| js-io | fanout6 | 500 | 494.5 | 494.0 | 0.00 | 0.00 | 25.61 | 26.13 | 1.04 |
| js-io | fanout6 | 1500 | 1146.4 | 1124.5 | 22.20 | 0.00 | 101.55 | 101.97 | 1.28 |
| js-io | fanout6 | 3000 | 1058.9 | 1040.5 | 63.87 | 0.00 | 115.21 | 116.01 | 1.39 |
| js-io | fanout6 | 6000 | 907.9 | 889.0 | 84.47 | 0.00 | 145.22 | 145.29 | 1.42 |
| rust-io | fanout6 | 500 | 494.5 | 494.0 | 0.00 | 0.00 | 58.26 | 58.55 | 1.05 |
| rust-io | fanout6 | 1500 | 1081.2 | 1071.5 | 26.00 | 0.00 | 109.37 | 110.05 | 1.25 |
| rust-io | fanout6 | 3000 | 1017.1 | 1027.0 | 64.35 | 0.00 | 123.77 | 124.28 | 1.37 |
| rust-io | fanout6 | 6000 | 832.0 | 808.5 | 84.48 | 0.64 | 158.76 | 159.94 | 1.44 |
| tokio-current | fanout6 | 500 | 494.8 | 494.5 | 0.00 | 0.00 | 24.18 | 25.10 | 1.57 |
| tokio-current | fanout6 | 1500 | 1482.9 | 1481.5 | 0.00 | 0.00 | 24.31 | 25.23 | 1.50 |
| tokio-current | fanout6 | 3000 | 2964.7 | 2962.5 | 0.00 | 0.00 | 25.09 | 25.99 | 1.46 |
| tokio-current | fanout6 | 6000 | 3361.8 | 3358.5 | 43.32 | 0.00 | 26.47 | 27.32 | 1.46 |
| tokio-multi | fanout6 | 500 | 494.4 | 494.0 | 0.00 | 0.00 | 24.07 | 25.02 | 1.52 |
| tokio-multi | fanout6 | 1500 | 1482.9 | 1482.5 | 0.00 | 0.00 | 24.26 | 25.17 | 1.47 |
| tokio-multi | fanout6 | 3000 | 2964.4 | 2962.0 | 0.00 | 0.00 | 24.82 | 25.96 | 1.56 |
| tokio-multi | fanout6 | 6000 | 3376.7 | 3373.0 | 43.08 | 0.00 | 25.69 | 26.61 | 1.48 |

## Direct origin control

These requests bypass the application and consume one shard each. Rates are **shards/s**, not aggregate requests/s. Compare against gateway goodput multiplied by shard count (12 or 8). The origin uses two native Tokio threads on separate cores. This control and per-process CPU help identify upstream/client limitations; they do not eliminate all shared-host interference.

| Profile | Clients | Shards/s | MiB/s | p95 ms | Origin CPU ms/shard | Client CPU ms/shard |
|---|---:|---:|---:|---:|---:|---:|
| fanout6 | 128 | 11028.3 | 43.1 | 12.49 | 0.016 | 0.027 |
| fanout6 | 256 | 21716.9 | 84.8 | 12.59 | 0.012 | 0.021 |
| fanout6 | 512 | 42714.9 | 166.9 | 14.43 | 0.011 | 0.020 |
| stream64k | 128 | 6477.0 | 404.8 | 33.80 | 0.049 | 0.125 |
| stream64k | 256 | 9377.6 | 586.1 | 38.98 | 0.055 | 0.103 |
| stream64k | 512 | 7907.3 | 494.2 | 82.91 | 0.053 | 0.124 |

The highest median small-shard control is 42715 shards/s; the highest median native Tokio open-loop result consumes 40520 shards/s. Compare these rates before interpreting native saturation: the origin is not an unlimited dependency.

The direct streaming control's highest median Node client CPU usage is 98.2% of one core. Near 100%, this control becomes client-limited and cannot establish the origin's intrinsic ceiling.

JavaScript streaming at 32 clients ranges from 298 to 824 aggregates/s. The slower rounds are retained. These measurements do not diagnose variation as a particular JIT, GC, or scheduling effect.

Low-concurrency serial blocks contain few observations; their tail quantiles need longer runs for reliable capacity planning.

## Memory and interpretation

| Entrant | Maximum process RSS MiB | Maximum process HWM MiB | Maximum Wasm linear memory MiB |
|---|---:|---:|---:|
| js-io | 496.4 | 496.4 | — |
| rust-io | 501.2 | 510.2 | 0.6 |
| tokio-current | 59.2 | 60.0 | — |
| tokio-multi | 51.4 | 55.6 | — |

RSS includes the whole process (V8/compiler/runtime code and native allocations), not just Worker isolate memory. Application body reservations cap at 32 MiB; Wasm linear memory caps at 64 MiB. Neither alone proves total hosted isolate memory compliance. Native two-thread throughput uses two application cores; workerd still has one application execution thread even though its runtime can use background threads.

Cloudflare documents a six-connection limit while waiting for headers; local external-service bindings are not proof of hosted enforcement. Observed fan-out above six here must not be interpreted as permission to bypass hosted limits. The delayed-body profile measures a different phase: headers have already arrived. See [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections).

All overload rejections are explicit admission decisions; they are excluded from goodput. At high offered rates, check client CPU and dispatch lag as well as application/origin CPU before attributing a limit to one runtime. Two-second samples are suitable for this controlled comparison, not a long-duration production capacity guarantee.

The first prototype’s cross-request promise queue failed workerd liveness detection under load; final admission reserves capacity synchronously. TCP_NODELAY was also necessary to avoid a delayed-ACK/Nagle artifact in the controlled origin. Both changes are included in every final entrant.

## Artifacts

- [Correctness and overload validation](results/io-validation.txt)
- [Closed-loop raw samples and provenance, gzip JSON](results/io-closed.json.gz)
- [Fixed-arrival raw samples and provenance, gzip JSON](results/io-open.json.gz)
- [Direct-origin raw samples and provenance, gzip JSON](results/io-origin.json.gz)
- [Archive byte counts and SHA-256 hashes](results/io-archives.json)
- [Final integrity audit](results/io-audit.json)
