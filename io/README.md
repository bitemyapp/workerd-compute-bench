# I/O concurrency benchmark

A gateway fans out to independent record shards, reads each complete response, computes FNV-1a checksums, and returns records in shard order. The Tokio origin generates request-specific data and delays response headers and/or individual body chunks. Each output is checked by an independent client oracle. There is no result cache. This is a controlled local HTTP workload, not a model of Cloudflare network, storage, or billing latency.

## Implementations and where Tokio runs

| Entrant | Application executor | I/O and concurrency |
|---|---|---|
| `js-io` | One workerd isolate | Worker fetch, bounded JavaScript async lanes |
| `rust-io` | One workerd isolate; `wasm-bindgen-futures` polls Rust futures | Worker fetch bridge; real `tokio::sync::Semaphore` bounds each request's Rust futures |
| `tokio-current` | One native Tokio current-thread executor | Axum/Hyper server, pooled Reqwest client, Tokio sockets/timers |
| `tokio-multi` | One native process, two Tokio executor threads | Same native application and limits, parallel task execution |

The two Rust entrants share `core/src/lib.rs`: the exact same asynchronous fan-out, Tokio semaphore, checksum, and response encoding. Native and Wasm have different transports, allocators, admission shells, and HTTP stacks. This comparison does **not** isolate the cost of Tokio itself. The native process is a control; it cannot be deployed inside a standard Cloudflare Worker.

Tokio's native socket reactor, multithread runtime and blocking pool cannot be inserted into Workers Wasm. Only its supported executor-independent pieces are used here. `wasm-bindgen-futures` and workerd remain responsible for polling and I/O. The origin is a separate two-thread native Tokio process for every entrant. It is not counted as application throughput or application CPU.

Sources: [Tokio Wasm support](https://docs.rs/tokio/latest/tokio/#wasm-support), [Cloudflare Wasm constraints](https://developers.cloudflare.com/workers/runtime-apis/webassembly/), [Cloudflare connection limits](https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections).

## Run

Use the root README's pinned development shell first, then:

```sh
npm run build:io
npm run test:io

# Choose valid, separate physical CPUs for your machine, or omit affinities.
BENCH_CPU=2,3 ORIGIN_CPU=4,5 taskset -c 0 bash scripts/io-run.sh
MODE=open CASES=fanout6 BENCH_CPU=2,3 ORIGIN_CPU=4,5 \
  taskset -c 0 bash scripts/io-run.sh
MODE=origin CASES=fanout6,stream64k CONCURRENCIES=128,256,512 \
  BENCH_CPU=2,3 ORIGIN_CPU=4,5 taskset -c 0 bash scripts/io-run.sh
node scripts/io-report.mjs
```

The isolated `io/Cargo.lock` pins the added dependencies without changing the original compute crate. The build installs pinned wasm-bindgen CLI 0.2.129 into ignored `.tools/`, compiles native and Wasm artifacts, and generates workerd configs plus an integrity manifest. Wasm linear memory is capped at 64 MiB. Tests and benchmarks reject stale artifacts. Ports 8787 and 8790 must be free. Processes bind only to loopback; the harness cleans up its children. No Cloudflare credentials or deployment are involved.

For manual use, run `TOKIO_THREADS=2 target/io/release/io-native origin` in one terminal, then `bash scripts/workerd.sh serve build/rust-io.capnp`, `build/js-io.capnp`, or `TOKIO_THREADS=1 target/io/release/io-native app` in another. `curl 'http://127.0.0.1:8787/aggregate?items=12&parallel=6&seed=42' --output result.bin` invokes the service.

## Protocol and resource limits

`GET /aggregate` accepts these integer query parameters; unknown, duplicate, malformed, and out-of-range values are rejected:

| Parameter | Default | Range / meaning |
|---|---:|---|
| `seed` | 1 | 0–4294967295, varies payload and echoed request ID |
| `items` | 12 | 1–32 shards |
| `parallel` | 6 | 1–32 outstanding shard bodies per request |
| `bytes` | 4096 | 1–65536 bytes per shard |
| `headers` | 10 | 0–1000 ms before sending response headers |
| `delay` | 0 | 0–1000 ms total body delay, split among chunks |
| `chunks` | 1 | 1–8, no more than `bytes` |
| `fail` | -1 | -1 or shard ID; injects upstream HTTP 502 |
| `truncate` | -1 | -1 or shard ID; sends one fewer byte |

The binary response starts with little-endian `u32 seed, u32 items`, followed by `items` records of `u32 shard_id, u32 bytes, u32 checksum`. This checks full data consumption and correct pairing despite out-of-order completion. `/health` reports live counters and capacity; `/reset` clears counters only when idle. Failure injections are test controls on this local benchmark, not a production API design.

Every entrant admits at most 256 requests, reserves at most 512 outbound slots, and reserves at most 32 MiB of body capacity. A request reserves `min(items,parallel)` slots and twice that number times `bytes` of capacity, covering a body plus its Rust copy. Admission is immediate: insufficient capacity produces HTTP 503. Inside an admitted request, futures/lanes wait for its own bounded fan-out permits. These conservative application reservations are not a measurement or proof of total isolate heap usage; transport and runtime allocations are additional. Wasm high-water memory and process RSS are reported separately.

The initial prototype used a shared async semaphore queue across requests. Stress testing showed workerd canceling requests that waited only for another request's in-memory queue. The final design uses synchronous cross-request reservation and request-owned asynchronous work; it does not keep requests alive with artificial timers. Tests exercise rejection, full permit recovery, injected errors, body-size mismatches, and memory admission.

All started shards are drained even if one fails, then the app returns 502. Native Reqwest and Worker fetch have five-second per-shard timeouts. Response bodies are consumed before permits are released. Client disconnects can cancel Worker I/O; the benchmark does not model disconnected clients or promise completion after a Worker context is canceled.

Cloudflare currently documents six connections **waiting for response headers** per invocation; a connection no longer counts once headers arrive. This differs from a blanket six-body limit. The suite measures delayed-header fan-out 1/6/12 separately from delayed body streaming. Local workerd external service bindings may differ from hosted limit enforcement, so observed local parallelism is reported without claiming it proves hosted behavior. TCP_NODELAY is enabled on the native origin and gateway; otherwise delayed ACK/Nagle interaction added about 40 ms per small streamed response in an early smoke test.

## Measurement

Closed-loop sweeps use 1, 8, 32, and 64 clients for serial fetching, fan-out 6, fan-out 12 (12 × 4 KiB, 10 ms header delay), and streaming (8 × 64 KiB in four chunks, 8 ms requested body delay, fan-out 6). Timer granularity and scheduling add to requested delays. The open-loop suite schedules 500, 1500, 3000, and 6000 requests/s independently of completions. It caps client outstanding requests at 512 and records dropped offers, HTTP 503, dispatch lateness, and scheduled-to-completion latency. There are no retries. A separate direct-origin sweep checks upstream capacity without a gateway.

Defaults are three fresh-process rounds per entrant, a 0.5-second warm-up **at the tested load**, and two measured seconds per block. `ROUNDS`, `SECONDS`, `WARMUP_SECONDS`, `CASES`, `CONCURRENCIES`, `RATES`, `VARIANTS`, `MODE`, and `OUTPUT` are configurable. Longer runs are useful for deployments with different hardware or service distributions. Entrant, profile, and load order rotate/reverse across rounds. Warm-up completes and counters reset before measurement.

External HTTP timings include complete response bodies, with correctness checking after the latency timestamp. Goodput counts only successful validated aggregates, never fast 503s. Total goodput includes drain time; open-loop results also expose completions during the fixed arrival window. Success latency and scheduled latency are reported alongside rejection/drop rates, avoiding claims based on successful survivors alone. The 256 request-specific payload patterns cycle, but every request performs real upstream HTTP work and origin byte/request accounting is checked for each block.

Linux process CPU, RSS/HWM, before/after scheduler state, origin active/peak connections, checksums, source/artifact hashes, toolchain and CPU affinity are retained in JSON. Scheduler policy/nice checks include the client, application, and origin. These are process measurements, not Cloudflare billed CPU or isolate memory. In the published setup, the application has two P cores available (one JavaScript/Wasm execution thread), the origin has two E cores, and the client has a separate P core. Native two-thread capacity uses both assigned app cores; it is not a single-thread fairness claim.

See [../IO-RESULTS.md](../IO-RESULTS.md) for measured findings and all round ranges.

The published raw samples are losslessly compressed as `results/io-{closed,open,origin}.json.gz`, with compressed and original SHA-256 hashes in `results/io-archives.json`. The benchmark writes uncompressed JSON locally; `npm run report:io` archives it before generating the report. The report also works directly from the compressed files in a fresh checkout. `gzip -dk results/io-closed.json.gz` produces a plain JSON file if desired. `bash scripts/io-run.sh scripts/io-audit.mjs` verifies the published suite's 258 blocks, source commit, rebuilt artifacts, scheduling, accounting, capacity recovery, and archives; it requires `npm run build:io` first.
