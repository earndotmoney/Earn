#!/usr/bin/env bash
# $EARN go-live in one command: check the CA, set it, then prove the live site shows it and launching is open.
#
#   deploy/go-live.sh <CA>
#
# Stops before changing anything if the check fails. Undo with: deploy/set-ca.sh --clear
set -euo pipefail
cd "$(dirname "$0")/.."
CA="${1:?usage: deploy/go-live.sh <CA>}"
SITE="${SITE:-https://justearn.money}"

echo "==> check (changes nothing)"
out=$(deploy/set-ca.sh "$CA" --dry)
echo "$out" | head -2
echo "$out" | grep -q '"ok":true' || { echo "⛔ refused, nothing changed" >&2; exit 1; }

echo "==> set"
out=$(deploy/set-ca.sh "$CA")
echo "$out" | head -2
echo "$out" | grep -q '"launchesOpen":true' || { echo "⛔ not set" >&2; exit 1; }

echo "==> live checks"
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1"; else echo "  ⛔ $1: got '$2', want '$3'"; fail=1; fi }
p=$(curl -s "$SITE/api/platform")
check "gate open"                "$(echo "$p" | node -pe 'JSON.parse(require("fs").readFileSync(0)).launchesOpen')" true
check "platform token is the CA" "$(echo "$p" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token?.mint')" "$CA"
check "listed first (recent)"    "$(curl -s "$SITE/api/tokens?sort=recent&limit=1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).items[0]?.mint')" "$CA"
check "listed first (mcap)"      "$(curl -s "$SITE/api/tokens?sort=mcap&limit=1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).items[0]?.mint')" "$CA"
check "token page"               "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/api/token/$CA")" 200
check "in top creators"          "$(curl -s "$SITE/api/creators/top" | node -pe 'JSON.parse(require("fs").readFileSync(0)).items.some((c) => c.creator.handle === "earndotmoney")')" true
img=$(echo "$p" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token?.image ?? ""')
check "logo loads"               "$(curl -s -o /dev/null -w '%{http_code}' "$img")" 200
# The hero's CA pill renders from /api/platform (checked above); this proves the deployed site carries it.
js=$(curl -s "$SITE/" | grep -o 'assets/index-[^"]*\.js' | head -1)
check "homepage CA pill deployed" "$(curl -s "$SITE/$js" | grep -c 'ca-pill' | tr -d ' ' | sed 's/^[1-9][0-9]*$/yes/')" yes
check "launching past the gate"  "$(curl -s -X POST "$SITE/api/launch/prepare" -H 'content-type: application/json' -H "Origin: $SITE" -d '{}' | grep -c 'currently disabled')" 0
[ "$fail" = 0 ] && echo "✅ \$EARN is live: $SITE (CA pill under the hero buttons), $SITE/token/$CA — now eyeball the homepage in Chrome" || { echo "⛔ some checks failed (see above)"; exit 1; }
