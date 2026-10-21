#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null || { [[ -e /etc/NIXOS ]] && [[ -z "${WORKERD_LOADER:-}" ]]; }; then
  mkdir -p .tools
  nix print-dev-env > .tools/env
  source .tools/env
  eval "$shellHook"
fi
if [[ "$(uname -s)" == Linux ]]; then
  export REQUIRE_NORMAL_SCHEDULER="${REQUIRE_NORMAL_SCHEDULER:-1}"
fi
# This host automatically demotes ordinary Node executables to SCHED_IDLE.
# Loading the same binary through glibc preserves normal scheduling, as it does
# for workerd. The benchmark verifies policies at both ends of every block.
bench_loader="${BENCH_NODE_LOADER:-${WORKERD_LOADER:-}}"
if [[ -n "$bench_loader" ]]; then
  exec "$bench_loader" "$(command -v node)" scripts/bench.mjs "$@"
fi
exec node scripts/bench.mjs "$@"
