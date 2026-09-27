# Earn

**Earn money through token fees.** [justearn.money](https://justearn.money) · [@earndotmoney](https://x.com/earndotmoney)

Earn is a fee bridge for [pump.fun](https://pump.fun). A token launched through Earn names one to
eight creator accounts on X, Twitch, GitHub, Spotify or FOMO, with shares that add up to exactly
100%. Its creator fees go to an on-chain address owned by the Earn program; the program divides every
harvest by those shares into each creator's own balance, and the creator signs in with the named
account to withdraw in USDC, network fee paid by Earn. **Earn takes no cut** and the program refuses
any setting that would.

Every Earn token's mint address ends in `earn`.

| | |
|---|---|
| Program | `irfCxPWpdsFS3fH73dfNZPpYfyABz5Xu1LYgtQnearn` (Solana mainnet) |
| pump.fun | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` · PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |

## How it works

1. **Launch.** The site builds a pump.fun `create_v2` whose `creator` is the Earn fee address for the
   named account (or for the split). pump.fun fixes that field for the life of the coin.
2. **Harvest.** A keeper collects accrued creator fees (curve and PumpSwap) and calls `harvest` or
   `harvest_split`; the program credits 100% to the creators, to the lamport.
3. **Withdraw.** The creator signs in (OAuth) and withdraws as USDC (swapped through Jupiter in the same
   transaction, protected by an on-chain minimum) or as SOL. FOMO creators are paid to the wallet they
   trade with, once it is confirmed on chain as theirs.

[`DESIGN.md`](DESIGN.md) has the full design, what was measured on mainnet, and the review history.

## Layout

```
programs/earn/     the Anchor program (Rust)
lib/               shared JS: addresses, splits, pump.fun client, lookup table
api/               the server: sign-in, lookups, launch builder, withdrawals, keeper, reconciliation
web/               the site (Vite + React, no web3.js in the bundle)
tests/             end-to-end tests against the real pump.fun program on a local validator
tools/grind/       the …earn address grinder (Rust)
deploy/            systemd units and the mainnet deploy/upgrade/set-ca scripts
research/          the mainnet probes the design was built on
```

## Running it

Requirements: Node 22+, Rust, Anchor 0.31.1, the Solana CLI (4.x), and a mainnet RPC for cloning.

```sh
npm install && (cd web && npm install)
anchor build
node tests/fixtures/make-fixtures.mjs     # throwaway validator keys (never committed)
./run-tests.sh                            # fresh local validator with pump.fun cloned, all suites
scripts/dev-stack.sh                      # validator + API (dev sign-in stubs) + site on :5270
node scripts/seed-dev.mjs                 # launches, trades, a keeper pass and a withdrawal over HTTP
node scripts/probe-guards.mjs             # the API's guards, exercised like an attacker would
```

Secrets (RPC key, OAuth apps, hot keys) live outside the repo in `keys/mainnet/` and are checked with
`node scripts/check-secrets.mjs`, which never prints a value.

## License

MIT. Not affiliated with X Corp, Spotify, Twitch, GitHub, FOMO or pump.fun.
