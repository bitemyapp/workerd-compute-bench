use futures_util::{stream, StreamExt};
use std::{future::Future, sync::Arc};
use tokio::sync::Semaphore;

pub const OUTBOUND_LIMIT: usize = 512;
pub const REQUEST_LIMIT: usize = 256;
pub const BUFFER_LIMIT: usize = 32 * 1024 * 1024;

// Each byte depends on both the request and shard, making mix-ups observable.
pub fn payload(seed: u32, item: u32, bytes: usize) -> Vec<u8> {
    (0..bytes)
        .map(|j| {
            seed.wrapping_mul(31)
                .wrapping_add(item * 17)
                .wrapping_add(j as u32) as u8
        })
        .collect()
}

pub fn checksum(bytes: &[u8]) -> u32 {
    bytes.iter().fold(2_166_136_261u32, |h, &b| {
        (h ^ b as u32).wrapping_mul(16_777_619)
    })
}

// Both native Tokio and Wasm use this exact async orchestration and reduction.
// Tokio's semaphore is executor-independent. Wasm futures are polled by
// wasm-bindgen-futures on workerd's event loop, not a Tokio socket reactor.
pub async fn aggregate<F, Fut>(
    seed: u32,
    items: u32,
    parallel: usize,
    bytes: usize,
    fetch: F,
) -> Result<Vec<u8>, String>
where
    F: Fn(u32) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, String>>,
{
    let permits = Arc::new(Semaphore::new(parallel));
    let mut pending = stream::iter(0..items)
        .map(|item| {
            let permits = &permits;
            let fetch = &fetch;
            async move {
                let _permit = permits.acquire().await.map_err(|e| e.to_string())?;
                let data = fetch(item).await?;
                if data.len() != bytes {
                    return Err("incorrect upstream body size".into());
                }
                Ok((item, checksum(&data)))
            }
        })
        .buffer_unordered(items as usize);
    let mut hashes = vec![0u32; items as usize];
    let mut error = None;
    // Drain all started/queued shards on error. Neither backend leaves detached
    // I/O behind or releases its permit before the body has been consumed.
    while let Some(result) = pending.next().await {
        match result {
            Ok((item, hash)) => hashes[item as usize] = hash,
            Err(e) => error = Some(e),
        }
    }
    if let Some(e) = error {
        return Err(e);
    }
    let mut out = Vec::with_capacity(8 + items as usize * 12);
    out.extend_from_slice(&seed.to_le_bytes());
    out.extend_from_slice(&items.to_le_bytes());
    for (item, hash) in hashes.into_iter().enumerate() {
        out.extend_from_slice(&(item as u32).to_le_bytes());
        out.extend_from_slice(&(bytes as u32).to_le_bytes());
        out.extend_from_slice(&hash.to_le_bytes());
    }
    Ok(out)
}
