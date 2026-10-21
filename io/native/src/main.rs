use axum::{
    body::{Body, Bytes},
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    serve::ListenerExt,
    Json, Router,
};
use futures_util::stream;
use serde::Deserialize;
use serde_json::json;
use std::{
    convert::Infallible,
    sync::{
        atomic::{AtomicUsize, Ordering::Relaxed},
        Arc,
    },
    time::Duration,
};
use tokio::sync::Semaphore;

#[derive(Default)]
struct Metrics {
    active: AtomicUsize,
    peak: AtomicUsize,
    completed: AtomicUsize,
    bytes: AtomicUsize,
    errors: AtomicUsize,
}
struct Guard(Arc<Metrics>);
impl Guard {
    fn new(m: Arc<Metrics>) -> Self {
        let n = m.active.fetch_add(1, Relaxed) + 1;
        m.peak.fetch_max(n, Relaxed);
        Self(m)
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Relaxed);
        self.0.completed.fetch_add(1, Relaxed);
    }
}
#[derive(Clone)]
struct App {
    metrics: Arc<Metrics>,
    requests: Arc<Semaphore>,
    outbound: Arc<Semaphore>,
    buffers: Arc<Semaphore>,
    client: reqwest::Client,
}

#[derive(Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Spec {
    seed: u32,
    items: u32,
    parallel: usize,
    bytes: usize,
    delay: u64,
    headers: u64,
    chunks: usize,
    fail: i32,
    truncate: i32,
}
impl Default for Spec {
    fn default() -> Self {
        Self {
            seed: 1,
            items: 12,
            parallel: 6,
            bytes: 4096,
            delay: 0,
            headers: 10,
            chunks: 1,
            fail: -1,
            truncate: -1,
        }
    }
}
impl Spec {
    fn valid(&self) -> bool {
        (1..=32).contains(&self.items)
            && (1..=32).contains(&self.parallel)
            && (1..=65536).contains(&self.bytes)
            && self.delay <= 1000
            && self.headers <= 1000
            && (1..=8).contains(&self.chunks)
            && self.chunks <= self.bytes
            && (-1..self.items as i32).contains(&self.fail)
            && (-1..self.items as i32).contains(&self.truncate)
    }
}
#[derive(Deserialize)]
struct Shard {
    seed: u32,
    item: u32,
    bytes: usize,
    delay: u64,
    headers: u64,
    chunks: usize,
    fail: i32,
    truncate: i32,
}

async fn shard(State(app): State<App>, Query(s): Query<Shard>) -> Response {
    if s.bytes == 0
        || s.bytes > 65536
        || s.delay > 1000
        || s.headers > 1000
        || s.chunks == 0
        || s.chunks > 8
        || s.chunks > s.bytes
        || s.item >= 32
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let guard = Guard::new(app.metrics.clone());
    if s.headers > 0 {
        tokio::time::sleep(Duration::from_millis(s.headers)).await;
    }
    if s.fail == s.item as i32 {
        app.metrics.errors.fetch_add(1, Relaxed);
        return (StatusCode::BAD_GATEWAY, "injected origin failure").into_response();
    }
    let size = if s.truncate == s.item as i32 {
        s.bytes - 1
    } else {
        s.bytes
    };
    let data = Bytes::from(io_core::payload(s.seed, s.item, size));
    // Delay headers and body independently. Completion/active counts
    // cover the entire streaming body lifetime, including client cancellation.
    let body = stream::unfold((0usize, data, guard), move |(i, data, guard)| async move {
        if i == s.chunks {
            return None;
        }
        if s.delay > 0 {
            tokio::time::sleep(Duration::from_micros(s.delay * 1000 / s.chunks as u64)).await;
        }
        let chunk = data.slice(i * size / s.chunks..(i + 1) * size / s.chunks);
        guard.0.bytes.fetch_add(chunk.len(), Relaxed);
        Some((Ok::<_, Infallible>(chunk), (i + 1, data, guard)))
    });
    (
        [("content-type", "application/octet-stream")],
        Body::from_stream(body),
    )
        .into_response()
}

async fn aggregate(State(app): State<App>, Query(s): Query<Spec>) -> Response {
    if !s.valid() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(_request) = app.requests.try_acquire() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let slots = s.parallel.min(s.items as usize);
    let Ok(_outbound) = app.outbound.try_acquire_many(slots as u32) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(_buffers) = app.buffers.try_acquire_many((slots * s.bytes * 2) as u32) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let _guard = Guard::new(app.metrics.clone());
    let result=io_core::aggregate(s.seed,s.items,s.parallel,s.bytes,|item| {
        let client=app.client.clone(); let s=s.clone();
        async move {
            let url=format!("http://127.0.0.1:8790/shard?seed={}&item={}&bytes={}&delay={}&headers={}&chunks={}&fail={}&truncate={}",s.seed,item,s.bytes,s.delay,s.headers,s.chunks,s.fail,s.truncate);
            let response=client.get(url).send().await.map_err(|e|e.to_string())?;
            let status=response.status();
            let body=response.bytes().await.map_err(|e|e.to_string())?;
            if !status.is_success() {return Err("upstream status".into());}
            Ok(body.to_vec())
        }
    }).await;
    match result {
        Ok(data) => ([("content-type", "application/octet-stream")], data).into_response(),
        Err(_) => {
            app.metrics.errors.fetch_add(1, Relaxed);
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}
async fn health(State(a): State<App>) -> Json<serde_json::Value> {
    Json(
        json!({"active":a.metrics.active.load(Relaxed),"peak":a.metrics.peak.load(Relaxed),"completed":a.metrics.completed.load(Relaxed),"bytes":a.metrics.bytes.load(Relaxed),"errors":a.metrics.errors.load(Relaxed),"availablePermits":a.outbound.available_permits(),"reservedBytes":io_core::BUFFER_LIMIT-a.buffers.available_permits(),"requestLimit":io_core::REQUEST_LIMIT,"outboundLimit":io_core::OUTBOUND_LIMIT,"bufferLimit":io_core::BUFFER_LIMIT}),
    )
}
async fn reset(State(a): State<App>) -> Response {
    if a.metrics.active.load(Relaxed) != 0 {
        return StatusCode::CONFLICT.into_response();
    }
    for counter in [
        &a.metrics.peak,
        &a.metrics.completed,
        &a.metrics.bytes,
        &a.metrics.errors,
    ] {
        counter.store(0, Relaxed);
    }
    StatusCode::NO_CONTENT.into_response()
}
fn main() {
    let mode = std::env::args().nth(1).unwrap_or("origin".into());
    let threads = std::env::var("TOKIO_THREADS")
        .unwrap_or("2".into())
        .parse::<usize>()
        .expect("TOKIO_THREADS");
    let mut builder = if threads == 1 {
        tokio::runtime::Builder::new_current_thread()
    } else {
        let mut b = tokio::runtime::Builder::new_multi_thread();
        b.worker_threads(threads);
        b
    };
    builder.enable_all().build().unwrap().block_on(async {
        let app = App {
            metrics: Arc::default(),
            requests: Arc::new(Semaphore::new(io_core::REQUEST_LIMIT)),
            outbound: Arc::new(Semaphore::new(io_core::OUTBOUND_LIMIT)),
            buffers: Arc::new(Semaphore::new(io_core::BUFFER_LIMIT)),
            client: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .pool_max_idle_per_host(512)
                .build()
                .unwrap(),
        };
        let (port, router) = if mode == "origin" {
            (8790, Router::new().route("/shard", get(shard)))
        } else {
            (8787, Router::new().route("/aggregate", get(aggregate)))
        };
        let router = router
            .route("/health", get(health))
            .route("/reset", get(reset))
            .with_state(app);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .unwrap();
        eprintln!("{mode} listening on {port}, Tokio threads {threads}");
        let listener = listener.tap_io(|socket| socket.set_nodelay(true).expect("TCP_NODELAY"));
        axum::serve(listener, router).await.unwrap();
    });
}
