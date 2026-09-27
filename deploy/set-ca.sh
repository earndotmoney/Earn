#!/usr/bin/env bash
# Lists $EARN as the platform's first token and OPENS LAUNCHING for everyone. No redeploy, no restart.
#
#   deploy/set-ca.sh <CA>          check on chain, then set it live
#   deploy/set-ca.sh <CA> --dry    check only, change nothing
#   deploy/set-ca.sh --clear       remove it and close launching again
#
# The server refuses the CA unless it ends in "earn", pump.fun lists it with ticker EARN, and its
# creator (fee recipient) is fomosZ2wByGHXygzSzDg1J7uFVCiAj9KbZVjr342hnX.
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${SITE:-https://justearn.money}"
TOKEN_FILE="keys/mainnet/admin.token"
[[ -f "$TOKEN_FILE" ]] || { echo "missing $TOKEN_FILE" >&2; exit 1; }
case "${1:-}" in
  --clear) BODY='{"clear":true}' ;;
  "") echo "usage: deploy/set-ca.sh <CA> [--dry] | --clear" >&2; exit 1 ;;
  *) DRY=false; [[ "${2:-}" == --dry ]] && DRY=true; BODY="{\"mint\":\"$1\",\"dry\":$DRY}" ;;
esac
# The token goes in through stdin (curl -K -), never on the command line where `ps` would show it.
printf 'header = "Authorization: Bearer %s"\n' "$(cat "$TOKEN_FILE")" |
  curl -sS -K - -X POST "$SITE/api/admin/platform" -H 'content-type: application/json' -d "$BODY" -w '\nHTTP %{http_code}\n'
echo "gate now: $(curl -s "$SITE/api/platform" | head -c 200)"
