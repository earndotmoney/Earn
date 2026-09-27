#!/usr/bin/env bash
# Upgrades the EARN program on MAINNET to target/deploy/earn.so. Run by the operator:
#   ! CONFIRM=UPGRADE ~/earn/deploy/mainnet-upgrade.sh
# Needs the deployer (upgrade authority) to hold ~2.6 SOL: the new bytes go through a buffer account
# whose rent comes back when the upgrade lands, plus a permanent top-up if the program grew.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/releases/4.0.0/solana-release/bin:$PATH"
PROGRAM_ID=irfCxPWpdsFS3fH73dfNZPpYfyABz5Xu1LYgtQnearn
K="${EARN_KEYS:-keys/mainnet}"
if [[ -n "${EARN_RPC:-}" ]]; then RPC="$EARN_RPC"
else HELIUS=$(grep -E '^HELIUS_API_KEY=' keys/mainnet/secrets.env | cut -d= -f2- | tr -d '[:space:]'); RPC="https://mainnet.helius-rpc.com/?api-key=$HELIUS"; fi
EXPECTED_SHA=$(grep -E '^EXPECTED_SHA=' deploy/mainnet-program.sh | cut -d= -f2)
actual=$(shasum -a 256 target/deploy/earn.so | cut -d' ' -f1)
[[ "$actual" == "$EXPECTED_SHA" ]] || { echo "✗ target/deploy/earn.so ($actual) is not the pinned tested build"; exit 1; }
DEPLOYER=$(solana-keygen pubkey $K/deployer.json)
size=$(stat -f%z target/deploy/earn.so)
current=$(solana program show "$PROGRAM_ID" --keypair $K/deployer.json --url "$RPC" | awk '/Data Length/ {print $3}')
echo "Program   $PROGRAM_ID"
echo "Deployer  $DEPLOYER  ($(solana balance "$DEPLOYER" --url "$RPC"))"
echo "New build $size bytes (sha $EXPECTED_SHA); on-chain data length $current bytes"
have=$(solana balance "$DEPLOYER" --url "$RPC" --lamports | cut -d' ' -f1)
(( have >= 3200000000 )) || { echo "✗ the deployer needs 3.2 SOL at peak (2.8 SOL buffer comes back; ~0.35 SOL stays as rent for the bigger program); it holds $have lamports"; exit 1; }
ok="${CONFIRM:-}"; [[ "$ok" == UPGRADE ]] || read -r -p "Type UPGRADE to continue: " ok || true
[[ "$ok" == UPGRADE ]] || { echo "stopped, nothing sent (run with CONFIRM=UPGRADE)"; exit 1; }
if (( size > current )); then
  echo "==> extending the program account by $((size - current)) bytes"
  solana program extend "$PROGRAM_ID" $((size - current)) --keypair $K/deployer.json --url "$RPC"
fi
echo "==> upgrade"
solana program deploy target/deploy/earn.so --program-id "$PROGRAM_ID" --keypair $K/deployer.json --upgrade-authority $K/deployer.json \
  --url "$RPC" --with-compute-unit-price 20000 --max-sign-attempts 30
echo "==> verify"
tmp=$(mktemp); solana program dump "$PROGRAM_ID" "$tmp" --keypair $K/deployer.json --url "$RPC" >/dev/null
onchain=$(head -c "$size" "$tmp" | shasum -a 256 | cut -d' ' -f1); rm -f "$tmp"
[[ "$onchain" == "$EXPECTED_SHA" ]] && echo "   ✓ on chain == tested build" || { echo "   ✗ MISMATCH $onchain"; exit 1; }
echo "✓ done. Deployer left: $(solana balance "$DEPLOYER" --url "$RPC")"
