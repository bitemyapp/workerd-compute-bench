#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
binary="$PWD/node_modules/workerd/bin/workerd"
if [[ -n "${WORKERD_BIN:-}" ]]; then binary="$WORKERD_BIN"; fi
# NixOS cannot execute an ordinary dynamically linked ELF directly.
if [[ -n "${WORKERD_LOADER:-}" ]]; then
  exec "$WORKERD_LOADER" "$binary" "$@"
fi
exec "$binary" "$@"
