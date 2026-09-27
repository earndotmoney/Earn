/**
 * One keeper run (systemd timer, every 5 minutes):
 *   1. claim: collect + harvest for every creator whose fees are worth more than the fee;
 *   2. push: fomo creators are paid in USDC to the wallet they trade with — only once that wallet
 *      is confirmed on chain as a fomo wallet, only when ≥ $20 is owed, at most every 30 minutes.
 *   3. market: refresh market caps for tokens not read in the last 5 minutes.
 *
 *   node api/keeper-run.mjs            (env as for the server: RPC_URL, DB_PATH, KEEPER_KEY, SIGNER_KEY, RELAYER_KEY)
 *   node api/keeper-run.mjs --dry      report what would happen, send nothing
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { openDb, now, kvGet, kvSet } from './db.mjs'
import { keeperPass, programs, sendAndRecord, buildClaim } from './keeper.mjs'
import { buildUsdcWithdraw, owedLamports } from './payout.mjs'
import { isFomoWallet } from './providers/fomo.mjs'
import { lamportsToUsd, refreshMarket, solUsd } from './market.mjs'
import { reconcile } from './reconcile.mjs'
import { confirmLaunch } from './launch.mjs'
import { cacheImage } from './images.mjs'
import { configAddress } from '../lib/earn.mjs'
import { pumpProgram } from '../lib/pump.mjs'

const env = process.env
const dry = process.argv.includes('--dry')
const key = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))))
// Every RPC request of this pass is counted per method and printed at the end (journalctl -u earn-keeper).
const rpcCounts = new Map()
const conn = new Connection(env.RPC_URL ?? 'https://solana-rpc.publicnode.com', { commitment: 'confirmed', fetchMiddleware: (url, options, fetch) => {
  try { for (const r of [].concat(JSON.parse(options.body))) rpcCounts.set(r.method, (rpcCounts.get(r.method) ?? 0) + 1) } catch {}
  return fetch(url, options)
} })
process.on('exit', () => console.log('rpc calls this pass:', JSON.stringify(Object.fromEntries(rpcCounts))))
const db = openDb(env.DB_PATH ?? `${env.DATA_DIR ?? './data'}/earn.db`)
const keeper = key(env.KEEPER_KEY)
const price = await solUsd()
const pump = pumpProgram(conn)
const { earn } = programs(conn, keeper.publicKey)
const cfg = await earn.account.config.fetch(configAddress())
const log = { info: (m) => console.log(new Date().toISOString(), m), error: (m) => console.error(new Date().toISOString(), m) }

// 1. claims
if (dry) {
  const creators = db.prepare('SELECT DISTINCT c.* FROM creators c JOIN tokens t ON t.creator_key = c.key_hex WHERE c.key_hex NOT IN (SELECT key_hex FROM optout)').all()
  for (const c of creators) {
    const claim = await buildClaim({ conn, pump, earn, amm: programs(conn, keeper.publicKey).amm, payer: keeper.publicKey, treasury: cfg.treasury, creator: c, minLamports: Number(env.MIN_CLAIM_LAMPORTS ?? 5_000_000) })
    log.info(`[dry] ${c.provider}:${c.handle} ${claim ? `would claim ${claim.expected} lamports` : 'nothing worth claiming'}`)
  }
} else {
  await keeperPass({ conn, db, pump, payer: keeper, treasury: cfg.treasury, solUsd: price, minLamports: Number(env.MIN_CLAIM_LAMPORTS ?? 5_000_000), log })
}

// 2. fomo pushes
if (env.SIGNER_KEY && env.RELAYER_KEY) {
  const signer = key(env.SIGNER_KEY), relayer = key(env.RELAYER_KEY)
  // Only fomo creators a token actually pays: confirming a wallet costs ~9 RPC reads and checking a balance one.
  const fomos = db.prepare(`SELECT * FROM creators WHERE provider = 'fomo' AND wallet IS NOT NULL AND key_hex NOT IN (SELECT key_hex FROM optout) AND key_hex IN (SELECT key_hex FROM token_recipients)`).all()
  for (const c of fomos) {
    try {
      if (!c.wallet_confirmed) {
        const ok = await isFomoWallet(conn, c.wallet)
        if (!ok) { log.info(`fomo ${c.handle}: wallet ${c.wallet} not confirmed yet`); continue }
        db.prepare('UPDATE creators SET wallet_confirmed = 1 WHERE provider = ? AND id = ?').run(c.provider, c.id)
      }
      const last = Number(kvGet(db, `push:${c.key_hex}`) ?? 0)
      if (now() - last < 30 * 60) continue
      const { owed } = await owedLamports(earn, c.key_hex)
      if (lamportsToUsd(owed, price) < Number(env.PUSH_MIN_USD ?? 20)) continue
      if (dry) { log.info(`[dry] would push ${owed} lamports to fomo ${c.handle} (${c.wallet})`); continue }
      const built = await buildUsdcWithdraw({ conn, earn, keyHex: c.key_hex, lamports: owed, owner: new PublicKey(c.wallet), signer: signer.publicKey, relayer: relayer.publicKey })
      const sig = await sendAndRecord({ conn, db, payer: relayer, extraSigners: [signer], ixs: built.ixs, lookupTables: built.lookupTables, solUsd: price })
      kvSet(db, `push:${c.key_hex}`, now())
      log.info(`pushed ${owed} lamports to fomo ${c.handle} ${sig}`)
    } catch (e) { log.error(`push to fomo ${c.handle} failed: ${e.message}`) }
  }
}

// 2b. launches the site never confirmed (tab closed after signing): record what landed, expire the rest
for (const r of db.prepare("SELECT k, v FROM kv WHERE k LIKE 'pending:%'").all()) {
  const mint = r.k.slice(8), at = JSON.parse(r.v).at ?? 0
  if (dry) continue
  try { await confirmLaunch({ db, conn, mint }); log.info(`recorded unconfirmed launch ${mint}`) }
  catch (e) { if (e.status === 409 && now() - at > 86400) { db.prepare('DELETE FROM kv WHERE k = ?').run(r.k); log.info(`expired pending launch ${mint}`) } else if (e.status !== 409) log.error(`pending ${mint}: ${e.message}`) }
}

// 2c. images: any token whose picture is not served from this site gets our own copy (one try per pass).
{
  const publicUrl = env.PUBLIC_URL ?? 'http://localhost:5270', logoDir = `${env.DATA_DIR ?? './data'}/logos`
  for (const t of db.prepare(`SELECT mint, image FROM tokens WHERE image != '' AND image NOT LIKE ? LIMIT 5`).all(`${publicUrl}/api/logos/%`)) {
    if (dry) { log.info(`[dry] would cache image of ${t.mint}`); continue }
    const ours = await cacheImage({ logoDir, publicUrl }, t.image, { log })
    if (ours) { db.prepare('UPDATE tokens SET image = ? WHERE mint = ?').run(ours, t.mint); log.info(`cached image of ${t.mint}`) }
  }
}

// 3. anything the ledger missed (a crash between landing and recording, or a third-party harvest)
if (!dry) { const r = await reconcile({ conn, db, solUsd: price, log }); if (r.added) log.info(`reconcile added ${r.added} of ${r.scanned}`) }

// 4. market data
// Market caps: young tokens every 30 min, older ones every 6 hours, 20 per pass. A viewed token page refreshes itself.
for (const t of db.prepare('SELECT mint FROM tokens WHERE (created_at > ? AND market_at < ?) OR market_at < ? ORDER BY market_at LIMIT 20').all(now() - 86400, now() - 1800, now() - 6 * 3600)) {
  await refreshMarket(db, conn, t.mint, price)
}
