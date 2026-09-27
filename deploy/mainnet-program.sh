#!/usr/bin/env bash
# EARN program → Solana MAINNET. Run by the operator:  ! CONFIRM=DEPLOY ~/earn/deploy/mainnet-program.sh
#
#   1. deploy target/deploy/earn.so to irfCxPWpdsFS3fH73dfNZPpYfyABz5Xu1LYgtQnearn (deployer = upgrade authority)
#   2. read the program back from chain and prove it is byte-for-byte the tested build
#   3. fund the keeper and relayer (0.05 SOL each) from the deployer
#   4. initialise the config: admin = the operator's wallet, 100% to creators (no cut), daily ceiling 50 SOL
#   5. create the launch lookup table
# Every step is idempotent: re-running after a failure skips what is already done.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/releases/4.0.0/solana-release/bin:$PATH"

PROGRAM_ID=irfCxPWpdsFS3fH73dfNZPpYfyABz5Xu1LYgtQnearn
OPERATOR=fomosZ2wByGHXygzSzDg1J7uFVCiAj9KbZVjr342hnX
EXPECTED_SHA=3f065416278b69f7376c9663f5a61bce1ac8b5001761a0d67a67f4d396cceb48
# REHEARSAL ONLY: EARN_RPC + EARN_KEYS point the whole script at a local validator and a copy of the keys.
K="${EARN_KEYS:-keys/mainnet}"
if [[ -n "${EARN_RPC:-}" ]]; then RPC="$EARN_RPC"
else HELIUS=$(grep -E '^HELIUS_API_KEY=' keys/mainnet/secrets.env | cut -d= -f2- | tr -d '[:space:]'); RPC="https://mainnet.helius-rpc.com/?api-key=$HELIUS"; fi
DEPLOYER=$(solana-keygen pubkey $K/deployer.json)
SIGNER=$(solana-keygen pubkey $K/signer.json)
RELAYER=$(solana-keygen pubkey $K/relayer.json)
KEEPER=$(solana-keygen pubkey $K/keeper.json)

actual=$(shasum -a 256 target/deploy/earn.so | cut -d' ' -f1)
[[ "$actual" == "$EXPECTED_SHA" ]] || { echo "✗ target/deploy/earn.so is not the tested build ($actual)"; exit 1; }

echo "Program     $PROGRAM_ID"
echo "Deployer    $DEPLOYER  ($(solana balance "$DEPLOYER" --url "$RPC"))"
echo "Admin       $OPERATOR   (named, never signs here)"
echo "Treasury    $OPERATOR"
echo "Signer      $SIGNER"
echo "Relayer     $RELAYER"
echo "Keeper      $KEEPER"
echo "Split       100% to the named creator, EARN takes no cut; withdrawals capped at 50 SOL per day"
echo
need=2600000000
have=$(solana balance "$DEPLOYER" --url "$RPC" --lamports | cut -d' ' -f1)
if (( have < need )); then echo "✗ the deployer holds $have lamports; the rehearsal needed 2.6 SOL. Top it up first."; exit 1; fi
# Confirmation: CONFIRM=DEPLOY on the command line (a `!` command in Claude Code has no keyboard
# input, so a prompt there reads end-of-file), or typed at the prompt in a normal terminal.
ok="${CONFIRM:-}"
if [[ "$ok" != DEPLOY ]]; then read -r -p "This spends real SOL on mainnet. Type DEPLOY to continue: " ok || true; fi
[[ "$ok" == DEPLOY ]] || { echo "stopped, nothing sent (run with CONFIRM=DEPLOY to confirm)"; exit 1; }

echo "==> 1. deploy"
if solana program show "$PROGRAM_ID" --keypair $K/deployer.json --url "$RPC" >/dev/null 2>&1; then
  echo "   already deployed, skipping"
else
  # ⚠ MEASURED (local rehearsal, solana-cli 4.0.0): the program account ends up 344,888 bytes whatever
  # --max-len says, ~2.40 SOL of rent. The whole script costs ~2.51 SOL (rehearsed with 2.6 → 0.093 left).
  # (No comments INSIDE the continued command below: they break the line continuation.)
  solana program deploy target/deploy/earn.so \
    --program-id "keys/program/$PROGRAM_ID.json" \
    --keypair $K/deployer.json --upgrade-authority $K/deployer.json \
    --max-len "$(stat -f%z target/deploy/earn.so)" \
    --url "$RPC" --with-compute-unit-price 20000 --max-sign-attempts 30
fi

echo "==> 2. verify the on-chain bytes"
tmp=$(mktemp)
solana program dump "$PROGRAM_ID" "$tmp" --keypair $K/deployer.json --url "$RPC" >/dev/null
size=$(stat -f%z target/deploy/earn.so)
onchain=$(head -c "$size" "$tmp" | shasum -a 256 | cut -d' ' -f1)
rest=$(tail -c +$((size + 1)) "$tmp" | tr -d '\0' | wc -c | tr -d ' ')
rm -f "$tmp"
if [[ "$onchain" == "$EXPECTED_SHA" && "$rest" == 0 ]]; then echo "   ✓ on chain == tested build ($EXPECTED_SHA)"
else echo "   ✗ MISMATCH: on chain $onchain, trailing non-zero bytes $rest — stopping"; exit 1; fi
solana program show "$PROGRAM_ID" --keypair $K/deployer.json --url "$RPC" | grep -E "Authority|Data Length"

echo "==> 3. fund keeper and relayer"
for who in "$KEEPER" "$RELAYER"; do
  bal=$(solana balance "$who" --url "$RPC" --lamports | cut -d' ' -f1)
  if (( bal < 20000000 )); then solana transfer "$who" 0.05 --from $K/deployer.json --keypair $K/deployer.json --allow-unfunded-recipient --url "$RPC" --with-compute-unit-price 20000 >/dev/null && echo "   funded $who"
  else echo "   $who already has $bal lamports"; fi
done

echo "==> 4. initialise the config"
RPC_URL="$RPC" node scripts/init-config.mjs --authority $K/deployer.json --admin "$OPERATOR" --signer "$SIGNER" --treasury "$OPERATOR" --bps 10000 --daily-cap-sol 50

echo "==> 5. launch lookup table"
if [[ -f $K/launch-lut.txt ]]; then echo "   exists: $(cat $K/launch-lut.txt)"
else RPC_URL="$RPC" node scripts/make-lookup-table.mjs $K/keeper.json > $K/launch-lut.txt && echo "   created $(cat $K/launch-lut.txt)"; fi

echo
echo "✓ done. Deployer left: $(solana balance "$DEPLOYER" --url "$RPC")"
