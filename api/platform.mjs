/**
 * The platform token and the launch gate.
 *
 * Launching through EARN stays CLOSED until the operator's $EARN exists. $EARN is launched on
 * another platform; setting its CA here (deploy/set-ca.sh → POST /api/admin/platform) checks it on
 * chain, lists it as EARN's first token, and opens launching for everyone — no redeploy.
 *
 * ⛔ The gate fails CLOSED: no platform record, or an unreadable one, means launching is disabled.
 */
import { PublicKey } from '@solana/web3.js'
import { BorshCoder } from '@coral-xyz/anchor'
import { bondingCurveAddress, decodeBondingCurve, pumpAmmIdl } from '../lib/pump.mjs'
import { kvGet, kvSet, now, upsertCreator } from './db.mjs'
import { pumpCoinUrl } from './market.mjs'
import { addressesOf } from './identity.mjs'

export const PLATFORM_SYMBOL = 'EARN'
export const PLATFORM_SUFFIX = 'earn'

export function platformState(db) {
  try {
    const v = kvGet(db, 'platform')
    const p = v ? JSON.parse(v) : null
    return p?.mint ? { launchesOpen: true, mint: p.mint } : { launchesOpen: false, mint: null }
  } catch { return { launchesOpen: false, mint: null } }
}

export class PlatformError extends Error { constructor(m, status = 400) { super(m); this.status = status } }

/**
 * Proves the CA is the operator's $EARN before anything is written:
 * ends in `earn`, pump.fun knows it with ticker EARN, and its creator (the fee recipient) is `founder`.
 * A graduated coin's curve reads all zeroes, so its creator is read off the PumpSwap pool instead.
 */
export async function verifyPlatformToken({ conn, mint, founder, fetchImpl = fetch }) {
  let pk
  try { pk = new PublicKey(mint) } catch { throw new PlatformError('Not a Solana address') }
  if (!mint.endsWith(PLATFORM_SUFFIX)) throw new PlatformError(`The CA must end in "${PLATFORM_SUFFIX}"`)
  const coinRes = await fetchImpl(pumpCoinUrl(mint), { signal: AbortSignal.timeout(8000) })
  if (!coinRes.ok) throw new PlatformError(`pump.fun does not know this coin (${coinRes.status})`)
  const coin = await coinRes.json()
  if (String(coin.symbol).toUpperCase() !== PLATFORM_SYMBOL) throw new PlatformError(`Ticker is ${coin.symbol}, not ${PLATFORM_SYMBOL}`)

  const curveInfo = await conn.getAccountInfo(bondingCurveAddress(pk))
  if (!curveInfo) throw new PlatformError('No pump.fun bonding curve for this mint')
  const curve = decodeBondingCurve(curveInfo.data)
  let creator = curve.complete ? null : curve.creator.toBase58()
  if (!creator && coin.pump_swap_pool) {
    const pool = await conn.getAccountInfo(new PublicKey(coin.pump_swap_pool))
    if (pool) creator = new BorshCoder(pumpAmmIdl).accounts.decode('Pool', pool.data).coin_creator.toBase58()
  }
  if (creator !== founder) throw new PlatformError(`Its fee recipient is ${creator ?? 'unknown'}, not ${founder}`)
  return { coin, creator }
}

/** Records the platform token (listed first, creator shown as the EARN account) and opens the gate. */
export function setPlatformToken(db, { mint, coin, creator, displayIdentity }) {
  const a = addressesOf(displayIdentity)
  upsertCreator(db, { ...displayIdentity, ...a })
  const createdAt = Math.floor(Number(coin.created_timestamp ?? Date.now()) / 1000)
  db.prepare(`
    INSERT INTO tokens (mint, name, symbol, image, description, metadata_uri, creator_key, launcher, launch_sig, created_at, platform, fee_recipient, market_cap_usd, graduated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)
    ON CONFLICT (mint) DO UPDATE SET platform = 1, fee_recipient = excluded.fee_recipient, name = excluded.name, symbol = excluded.symbol, image = excluded.image
  `).run(mint, coin.name, coin.symbol, coin.image_uri ?? '', coin.description ?? '', coin.metadata_uri ?? '', a.keyHex, creator, createdAt, creator,
    Number(coin.usd_market_cap ?? 0), coin.complete ? 1 : 0)
  kvSet(db, 'platform', JSON.stringify({ mint, setAt: now() }))
}

export function clearPlatformToken(db) {
  const p = platformState(db)
  if (p.mint) db.prepare('DELETE FROM tokens WHERE mint = ? AND platform = 1').run(p.mint)
  db.prepare("DELETE FROM kv WHERE k = 'platform'").run()
}
