#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null || { [[ -e /etc/NIXOS ]] && [[ -z "${WORKERD_LOADER:-}" ]]; }; then
  mkdir -p .tools
  nix print-dev-env > .tools/env
  source .tools/env
  eval "$shellHook"
fi
if [[ "$(uname -s)" == Linux ]]; then export REQUIRE_NORMAL_SCHEDULER="${REQUIRE_NORMAL_SCHEDULER:-1}"; fi
script="${1:-scripts/io-bench.mjs}"
shift || true
loader="${BENCH_NODE_LOADER:-${WORKERD_LOADER:-}}"
if [[ -n "$loader" ]]; then exec "$loader" "$(command -v node)" "$script" "$@"; fi
exec node "$script" "$@"
