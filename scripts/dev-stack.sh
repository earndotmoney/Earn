#!/usr/bin/env bash
# Local EARN: validator (pump.fun cloned) + program config + launch lookup table + API (:8820,
# DEV_STUBS) + site (:5270). Everything lives in data/dev/ and is thrown away on the next run.
#   scripts/dev-stack.sh          start everything, leave it running
#   scripts/dev-stack.sh stop     stop it
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/releases/4.0.0/solana-release/bin:$PATH"
PORT=8997
if [[ "${1:-}" == stop ]]; then
  # ⛔ By PID file only: other projects run their own `node api/server.mjs` and vite on this machine.
  for f in data/dev/*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null || true; done
  pkill -f "solana-test-validator.*--rpc-port $PORT" || true
  exit 0
fi
rm -rf data/dev && mkdir -p data/dev/keys
for k in admin signer relayer keeper treasury; do solana-keygen new --no-bip39-passphrase --silent -o data/dev/keys/$k.json >/dev/null; done
pkill -f "solana-test-validator.*--rpc-port $PORT" 2>/dev/null || true; sleep 1
./validator.sh > data/dev/validator.log 2>&1 &
for i in $(seq 1 120); do curl -s -m 2 "http://127.0.0.1:$PORT" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q ok && break; sleep 1; done
for k in admin relayer keeper; do solana airdrop 100 "$(solana-keygen pubkey data/dev/keys/$k.json)" --url "http://127.0.0.1:$PORT" >/dev/null; done
solana airdrop 5 "$(solana-keygen pubkey tests/fixtures/upgrade-authority.json)" --url "http://127.0.0.1:$PORT" >/dev/null
RPC_URL="http://127.0.0.1:$PORT" node scripts/init-config.mjs --authority tests/fixtures/upgrade-authority.json --admin "$(solana-keygen pubkey data/dev/keys/admin.json)" \
  --signer "$(solana-keygen pubkey data/dev/keys/signer.json)" --treasury "$(solana-keygen pubkey data/dev/keys/treasury.json)"
LUT=$(RPC_URL="http://127.0.0.1:$PORT" node scripts/make-lookup-table.mjs data/dev/keys/keeper.json)
echo "lookup table $LUT"
# The vanity pool: a few real …earn keys, ground here.
mkdir -p data/dev/vanity && tools/grind/target/release/earn-grind earn 3 "$(sysctl -n hw.ncpu)" data/dev/vanity >/dev/null
cat > data/dev/api.env <<EOF
PORT=8820
PUBLIC_URL=http://localhost:5270
DATA_DIR=data/dev
RPC_URL=http://127.0.0.1:$PORT
SIGNER_KEY=data/dev/keys/signer.json
RELAYER_KEY=data/dev/keys/relayer.json
KEEPER_KEY=data/dev/keys/keeper.json
LAUNCH_LUT=$LUT
VANITY_DIR=data/dev/vanity
VANITY_TARGET=3
GRIND_BIN=tools/grind/target/release/earn-grind
DEV_STUBS=1
EOF
set -a; . data/dev/api.env; set +a
node api/server.mjs > data/dev/api.log 2>&1 < /dev/null &
echo $! > data/dev/api.pid
(cd web && API_ORIGIN=http://127.0.0.1:8820 exec node node_modules/.bin/vite --port 5270 --strictPort > ../data/dev/web.log 2>&1 < /dev/null) &
echo $! > data/dev/web.pid
for i in $(seq 1 60); do curl -s -m 2 http://127.0.0.1:8820/api/health | grep -q ok && break; sleep 1; done
echo "api $(curl -s http://127.0.0.1:8820/api/health)  site http://localhost:5270"
