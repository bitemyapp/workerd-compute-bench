#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/io
bindgen=.tools/wasm-bindgen/bin/wasm-bindgen
if [[ ! -x "$bindgen" ]] || [[ "$($bindgen --version)" != 'wasm-bindgen 0.2.129' ]]; then
  cargo install wasm-bindgen-cli --version 0.2.129 --locked --root .tools/wasm-bindgen
fi
cargo build --locked --manifest-path io/Cargo.toml --target-dir target/io --release -p io-native
RUSTFLAGS='-C link-arg=--max-memory=67108864 -C link-arg=-zstack-size=262144' \
  cargo build --locked --manifest-path io/Cargo.toml --target-dir target/io --release -p io-wasm --target wasm32-unknown-unknown
"$bindgen" --target web --out-dir build/io/pkg target/io/wasm32-unknown-unknown/release/io_wasm.wasm
node scripts/io-config.mjs
node scripts/io-manifest.mjs
