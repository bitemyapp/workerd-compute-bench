#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
base='-C link-arg=--max-memory=33554432 -C link-arg=-zstack-size=262144'
RUSTFLAGS="$base -C target-feature=-simd128" cargo build --locked --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/compute.wasm build/scalar.wasm
RUSTFLAGS="$base -C target-feature=+simd128" cargo build --locked --release --features simd --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/compute.wasm build/simd.wasm
RUSTFLAGS="$base -C target-feature=+simd128" cargo build --locked --release --features manual --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/compute.wasm build/manual.wasm
wasm-opt --all-features -O3 build/manual.wasm -o build/manual-o3.wasm
RUSTFLAGS="$base -C target-feature=+simd128" cargo build --locked --release --features unroll --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/compute.wasm build/unroll.wasm
wasm-opt --all-features -O3 build/unroll.wasm -o build/unroll-o3.wasm
RUSTFLAGS="$base -C target-feature=+simd128" cargo build --locked --profile small --features simd --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/small/compute.wasm build/small.wasm
wasm-opt --all-features -O3 build/simd.wasm -o build/simd-o3.wasm
wasm-opt --all-features -Oz build/simd.wasm -o build/simd-oz.wasm
node scripts/config.mjs
node scripts/build-manifest.mjs
