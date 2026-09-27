/**
 * Prices and market data. Figures are for display; nothing on chain depends on them.
 *
 * ⛔ A graduated pump.fun coin's BondingCurve reads ALL ZEROES (memory: pumpfun-migrated-curve-reads-zero),
 * so a curve-priced market cap would show a live coin as $0. pump.fun's own API is read first, and
 * the curve is used only while `complete` is false.
 */
import { PublicKey } from '@solana/web3.js'
import { COIN_DECIMALS, POOL_INDEXES, bondingCurveAddress, decodeBondingCurve, decodePool, poolAddress, tokenAccountAmount } from '../lib/pump.mjs'

const SOL = 'So11111111111111111111111111111111111111112'
let solCache = { usd: 0, at: 0 }

/** SOL in USD from two sources; the last good price is kept through an outage. */
export async function solUsd() {
  if (Date.now() - solCache.at < 60_000 && solCache.usd) return solCache.usd
  const sources = [
    async () => (await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL}`, { signal: AbortSignal.timeout(5000) })).json())[SOL]?.usdPrice,
    async () => (await (await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot', { signal: AbortSignal.timeout(5000) })).json()).data?.amount,
  ]
  for (const s of sources) {
    try { const v = Number(await s()); if (v > 0) { solCache = { usd: v, at: Date.now() }; return v } } catch {}
  }
  if (solCache.usd) return solCache.usd
  throw new Error('SOL price unavailable')
}

export const lamportsToUsd = (lamports, price) => (Number(lamports) / 1e9) * price

/** pump.fun's public coin endpoint (the same one its site uses). */
// pump.fun moved single-coin lookups to /coins-v2 (Sep 2026); the old /coins/<mint> answers 404 for every coin.
export const pumpCoinUrl = (mint) => `https://frontend-api-v3.pump.fun/coins-v2/${mint}`

async function pumpCoin(mint) {
  const res = await fetch(pumpCoinUrl(mint), { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`pump.fun coin ${res.status}`)
  return res.json()
}

/**
 * A migrated coin's market cap from its PumpSwap pool: price = quote reserve / base reserve, times the
 * total supply. ⛔ The bonding curve of a migrated coin reads ALL ZEROES (memory
 * pumpfun-migrated-curve-reads-zero), so a curve-priced cap would show a live coin as $0.
 * Returns { marketCapUsd, pool } or null. Tries the pool address the API named first, then the PDAs.
 */
export async function poolMarketCap(conn, mint, price, knownPool = null) {
  const m = new PublicKey(mint)
  const candidates = [...(knownPool ? [new PublicKey(knownPool)] : []), ...POOL_INDEXES.map((i) => poolAddress(m, undefined, i))]
  const infos = await conn.getMultipleAccountsInfo(candidates)
  const i = infos.findIndex((x) => x && x.data.length > 200)
  if (i < 0) return null
  const pool = decodePool(infos[i].data)
  const [base, quote] = await conn.getMultipleAccountsInfo([pool.pool_base_token_account, pool.pool_quote_token_account])
  if (!base || !quote) return null
  const b = Number(tokenAccountAmount(base.data)) / 10 ** COIN_DECIMALS, q = Number(tokenAccountAmount(quote.data)) / 1e9
  if (!(b > 0) || !(q > 0)) return null
  const supply = Number((await conn.getTokenSupply(m)).value.amount) / 10 ** COIN_DECIMALS
  return { marketCapUsd: (q / b) * price * supply, pool: candidates[i].toBase58() }
}

/** Market fields for one token row. Never throws: a failed read keeps the previous figures. */
export async function refreshMarket(db, conn, mint, price) {
  const update = {}
  const current = db.prepare('SELECT image, pool FROM tokens WHERE mint = ?').get(mint)
  const curveInfo = await conn.getAccountInfo(bondingCurveAddress(new PublicKey(mint))).catch(() => null)
  try {
    const c = await pumpCoin(mint)
    update.market_cap_usd = Number(c.usd_market_cap ?? 0)
    update.graduated = c.complete ? 1 : 0
    if (c.pump_swap_pool) update.pool = c.pump_swap_pool
    if (c.total_supply) update.price_usd = update.market_cap_usd / (Number(c.total_supply) / 1e6)
    if (c.image_uri && !current?.image) update.image = c.image_uri // never let the API replace a stored logo
  } catch {
    try {
      if (curveInfo) {
        const curve = decodeBondingCurve(curveInfo.data)
        if (!curve.complete) {
          const priceSol = Number(curve.virtual_quote_reserves) / 1e9 / (Number(curve.virtual_token_reserves) / 1e6)
          update.price_usd = priceSol * price
          update.market_cap_usd = update.price_usd * (Number(curve.token_total_supply) / 1e6)
        } else update.graduated = 1
      }
    } catch {}
  }
  // Graduated (by either source): the pool is the price, whatever the API said the cap was.
  if (update.graduated === 1 || (curveInfo && decodeBondingCurve(curveInfo.data).complete)) {
    update.graduated = 1
    try {
      const pm = await poolMarketCap(conn, mint, price, update.pool ?? current?.pool ?? null)
      if (pm) { update.market_cap_usd = pm.marketCapUsd; update.pool = pm.pool; update.price_usd = pm.marketCapUsd / 1e9 }
    } catch {}
  }
  try {
    if (curveInfo) {
      const curve = decodeBondingCurve(curveInfo.data)
      // 793.1M of the 1B supply is sold on the curve; progress is how much of that is gone.
      const INITIAL_REAL = 793_100_000_000_000
      update.curve_progress = curve.complete ? 1 : Math.max(0, Math.min(1, 1 - Number(curve.real_token_reserves) / INITIAL_REAL))
    }
  } catch {}
  if (!Object.keys(update).length) return
  update.market_at = Math.floor(Date.now() / 1000)
  const cols = Object.keys(update)
  db.prepare(`UPDATE tokens SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE mint = ?`).run(...cols.map((c) => update[c]), mint)
}
