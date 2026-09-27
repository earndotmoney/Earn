/**
 * Reconciliation: the chain is the ledger, the database is a cache of it.
 *
 * `sendAndRecord` records a claim or payout right after it lands, but a crash or an RPC hiccup
 * between landing and recording would leave the database short one row forever — and a third
 * party can call `harvest` themselves, which the keeper never sees. This walks the EARN program's
 * recent signatures and records any Claimed/Paid event the database is missing. Keyed on the
 * signature, so it can run as often as it likes.
 */
import { EARN } from '../lib/earn.mjs'
import { kvGet, kvSet } from './db.mjs'
import { recordEvents } from './keeper.mjs'

export async function reconcile({ conn, db, solUsd, log = console, limit = 200 }) {
  const newestKnown = kvGet(db, 'reconcile_newest')
  const sigs = await conn.getSignaturesForAddress(EARN, { limit, ...(newestKnown ? { until: newestKnown } : {}) }, 'confirmed')
  const known = new Set([
    ...db.prepare('SELECT signature FROM claims').all().map((r) => r.signature),
    ...db.prepare('SELECT signature FROM payouts').all().map((r) => r.signature),
  ])
  let added = 0
  for (const s of sigs) {
    if (s.err || known.has(s.signature)) continue
    // ⛔ Raw request: web3.js 1.98 cannot parse version-1 transactions, and anyone may call harvest
    // from a transaction of any version.
    const r = await conn._rpcRequest('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }])
    const t = r?.result
    if (!t?.meta) continue
    const before = db.prepare('SELECT count(*) n FROM claims').get().n + db.prepare('SELECT count(*) n FROM payouts').get().n
    recordEvents(db, { signature: s.signature, slot: t.slot, time: t.blockTime ?? s.blockTime, logs: t.meta.logMessages, solUsd })
    const after = db.prepare('SELECT count(*) n FROM claims').get().n + db.prepare('SELECT count(*) n FROM payouts').get().n
    if (after > before) { added++; log.info?.(`reconciled ${s.signature} (priced at today's SOL)`) }
  }
  if (sigs.length) kvSet(db, 'reconcile_newest', sigs[0].signature)
  return { scanned: sigs.length, added }
}
