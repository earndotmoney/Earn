#!/usr/bin/env bash
# Fresh validator (pump.fun cloned), then the suites in order: earn.test initialises the config
# that api-flow.test builds on.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${LOCAL_RPC_PORT:-8997}"
pkill -f "solana-test-validator.*--rpc-port $PORT" 2>/dev/null || true
sleep 1
./validator.sh > validator.log 2>&1 &
VPID=$!
trap 'kill $VPID 2>/dev/null || true' EXIT
for i in $(seq 1 120); do
  curl -s -m 2 "http://127.0.0.1:$PORT" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q ok && break
  sleep 1
done
node --test tests/earn.test.mjs
node --test tests/api-flow.test.mjs
node --test tests/platform.test.mjs
node --test tests/market.test.mjs
