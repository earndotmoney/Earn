# EARN — design

cashed.money, rebuilt for pump.fun on Solana. A token names a creator (X, Twitch, GitHub, Spotify or
fomo); its pump.fun creator fees go to an EARN fee address for that account; EARN credits every claim
100% to that creator on chain (EARN takes NO cut: operator decision 27 Sep, enforced by the program);
the creator signs in with the named account and withdraws in USDC. Every token
launched through EARN has a mint address ending in `earn`.

## Proven on mainnet state (simulation, 27 Sep 2026) — `research/probe-*.mjs`

| fact | how it was shown |
|---|---|
| `create_v2` accepts an off-curve program PDA as `creator` | probe-fee-address.mjs, all 4 runs |
| `collect_creator_fee` pays the creator **without the creator signing** | 0.5 SOL buy → 1,481,482 lamports landed on the PDA (0.30%) |
| a collection below the rent floor is **silently skipped**, not failed | 0.02 SOL buy: PDA stayed at 0, vault kept the fee |
| pre-funding the fee address to 890,880 lamports lets small fees through | 0.02 SOL buy + prefund: +59,260 |
| `creator_fee_bps` (a "creator tax") is accepted but **changes nothing on a SOL pair** | same fee with 100 bps as with none; `CreatorFeeNotConfigurableForQuote` — EARN offers no creator tax |
| after graduation, `transfer_creator_fees_to_pump` is permissionless | probe-amm-collect.mjs on a real migrated pool |
| launch tx (create + ATA + buy + collect) is 1,166 bytes | limit 1,232 → launches use an address lookup table |
| Global: creator fee 5 bps base, fee schedule by market cap, max configurable 300 bps | decoded live |

## Addresses

For a creator account `provider:id` (id = the platform's stable id, never the handle, so a rename
changes nothing; Spotify ids are strings, so everything is hashed):

```
key         = sha256("x:44196397" | "twitch:…" | "github:…" | "spotify:user:…" | "spotify:artist:…" | "fomo:…")
fee address = PDA(["fee", key], EARN)      system-owned, no data — the pump.fun `creator`
account     = PDA(["account", key], EARN)  program-owned — holds the credited fees (100%) and the ledger
config      = PDA(["config"], EARN)
```

## Program instructions

- `initialize(admin, args)` (program upgrade authority only) / `set_config(…)` (admin only).
  `recipient_bps` must be 10000: the program refuses any protocol cut. `paused` stops withdrawals.
- **Fee splits (27 Sep):** a launch may name 1 to 8 accounts across platforms with whole-percent
  shares. `create_split(split_key, recipients)` registers the list (content-addressed: `split_key` =
  sha256 of key||bps in ascending key order; the program recomputes it) and refuses fewer than 2 or
  more than 8, a zero share, duplicates, or shares not totalling exactly 10,000 bps. The token's fee
  address is `["fee", split_key]`. `harvest_split(split_key)` divides everything above the rent floor
  by the shares into each recipient's `CreatorAccount` (remaining accounts, verified by key and PDA;
  the last takes the rounding remainder so the sum equals the gross), emitting `SplitClaimed` once and
  `Claimed` per recipient. `init_account(key)` creates a recipient account ahead of a harvest. A single
  recipient keeps the original path (`["fee", key]`, `harvest`). The description carries the split:
  `Fees: 60% @a, 40% github:b via EARN`.
- `harvest(key)` — **permissionless**. Moves everything above the rent floor out of the fee address
  (the program signs for its own PDA) into `account`: 100% to the creator, `to_treasury` always 0.
  Emits `Claimed { key, gross, to_recipient, to_treasury }`. The keeper sends
  `[transfer_creator_fees_to_pump?, collect_creator_fee, harvest]` in one transaction, so every
  claim is one transaction and is keyed on it — the ledger cannot count a claim twice.
- `withdraw(key, lamports, mode, min_out)` — `config.signer` (the server that checked the sign-in)
  and the relayer (fee payer) both co-sign the transaction; the signer chooses `destination`, which
  may never be the account, the config or the fee address. `mode`:
  - `Sol` — lamports straight to `destination`.
  - `Usdc` — lamports to the relayer, who swaps on Jupiter in the same transaction into
    `destination` (a USDC token account); a closing `settle` instruction, required by the
    instructions sysvar check, verifies `destination` grew by ≥ `min_out` or the whole transaction
    reverts. The relayer cannot keep the SOL.
- Signer = the server that checked the OAuth sign-in. Same trust model as Cashed ("signing in is
  what proves you are the account"). Admin can rotate it and pause; a per-day withdrawal ceiling
  limits what a stolen signer key could drain.

## Off-chain

- **api/** — OAuth (X, Twitch, GitHub, Spotify), handle lookups, fomo handle → wallet, the vanity
  mint pool, launch transaction builder (server co-signs with the mint key), withdrawal attester +
  relayer (pays gas, so the creator needs no SOL), indexer, opt-out / do-not-pay list.
- **keeper** — every few minutes: for each account with tokens, collect + harvest when the fee
  vault is worth more than the fee. Pushes: fomo (and X Money, if it ever opens an API) at payout
  milestones $5, $10, $20, $50, $100, $250, $500, $1,000, then every $1,000; fomo every 30 minutes
  once ≥ $20.
- **Vanity mints** — `solana-keygen grind --ends-with earn` (case-sensitive, ~11M tries, ~45s
  on 6 cores). A background grinder keeps a pool stocked. ⛔ A key is handed out ONCE: a mint
  address known before launch can be griefed forever (pre-created token account), so a key shown
  in an abandoned launch is burned, never reused.
- **web/** — Cashed's layout and pages: Home, Explore, Token, creator profile (`/x/…`,
  `/twitch/…`, `/github/…`, `/spotify/…`, `/fomo/…`), Payments, Analytics, Transparency,
  Launch, Payout status (claim), Docs, Terms, Privacy, Disclosures, Opt out.

## Not carried over from Cashed

- **Creator tax** — pump.fun ignores it on SOL pairs (above).
- **Register an existing token** — a pump.fun `creator` cannot be changed except by pump.fun's
  admin. Pointing an existing coin at EARN would need the fee-sharing program's
  `update_fee_shares_v2`, whose account layout has never been read off a real transaction
  (~/pumpfamily/PUMPFUN-OPTIONS.md). Phase 2.
- **X Money** — no public send API. X creators claim by signing in, as Cashed's do today.
- **$EARN burn** — operator decision 27 Sep: no.

## Pre-deploy review, 27 Sep 2026 (three independent reviewers + own pass) — what changed

Program (no critical/high found): `withdraw` refuses `destination` = account / config / fee address / program
(would strand or double-count); split arithmetic in u128. Known and accepted: the daily cap is a global
amount cap that a signer can spend twice across a window boundary; admin (the operator's wallet) can raise
it, so that key must stay cold; a stranger may call `harvest` first and make the keeper's own claim fail
(funds still land; reconciliation records it).

API: X-Forwarded-For last entry; OAuth `return` path hardened (`/\evil.com`, tabs, `//`); OAuth state bound
to the starting browser (cookie); Origin/Sec-Fetch-Site check on every POST; image type from magic bytes;
vanity keys reserved per launcher (retries reuse), balance ≥ dev buy + 0.03 SOL, ≤3 keys/wallet/day, ≤15
issued/hour overall, pool size no longer public; withdrawals ≥ 0.01 SOL and one per account per 10 min
(the relayer pays rent + fees); paid X lookups rate limited on every path, negative-cached, 2000/day budget;
Jupiter response checked (inAmount, ExactIn, pair, program allowlist, never touches the signer key);
`confirm` validates mint/signature and is rate limited; fomo wallet change resets its confirmation;
pump.fun's API can no longer replace a stored logo; `reconcile.mjs` records any Claimed/Paid event the
ledger missed (crash after landing, third-party harvest); unconfirmed launches are recorded or expired by the
keeper; a landed-but-unread withdrawal answers 200 with `recorded: false` instead of "failed".
