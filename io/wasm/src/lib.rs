use js_sys::{Function, Promise, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
pub async fn aggregate(
    fetch: Function,
    seed: u32,
    items: u32,
    parallel: usize,
    bytes: usize,
) -> Result<Vec<u8>, JsValue> {
    io_core::aggregate(seed, items, parallel, bytes, |item| {
        let fetch = fetch.clone();
        async move {
            let value = fetch
                .call1(&JsValue::NULL, &JsValue::from(item))
                .map_err(|_| "fetch callback failed".to_string())?;
            let value = JsFuture::from(Promise::resolve(&value))
                .await
                .map_err(|_| "upstream request failed".to_string())?;
            Ok(Uint8Array::new(&value).to_vec())
        }
    })
    .await
    .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn memory_bytes() -> usize {
    core::arch::wasm32::memory_size(0) * 65536
}
