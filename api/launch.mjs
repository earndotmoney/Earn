/**
 * Builds an EARN launch: a pump.fun `create_v2` coin whose `creator` is the named creator's EARN fee
 * address, with an `…earn` mint from the vanity pool, and an optional dev buy.
 *
 * The server signs with the mint key and returns the transaction; the launcher's wallet signs as
 * fee payer and sends it. Nothing here holds the launcher's money.
 *
 * ⛔ pump.fun's `creator` is set once and cannot be changed by anyone but pump.fun. The fee address
 * is re-derived here from the creator's stable id — never taken from the request.
 */
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TOKEN_2022, ata, bondingCurveAddress, buyExactSolInIx, createV2Ix, decodeBondingCurve } from '../lib/pump.mjs'
import { addressesOf, feeLine, splitFeeLine } from './identity.mjs'
import { feeAddress as feeAddressOf } from '../lib/earn.mjs'
import { issueKey, markLaunched } from './vanity.mjs'
import { now } from './db.mjs'

export const NAME_MAX = 32
export const SYMBOL_MAX = 10
export const DESCRIPTION_MAX = 500
export const MAX_DEV_BUY_LAMPORTS = 100n * 1_000_000_000n
/** pump.fun rent + fees (~0.02 SOL measured) plus the fee-address top-up and priority fee. */
export const MIN_LAUNCH_LAMPORTS = 30_000_000n
export const MAX_KEYS_PER_WALLET_DAY = 3
/** Below the box's grind rate (~20-30 keys/hour at one thread), so no burst can empty the pool. */
export const HOURLY_KEY_BUDGET = Number(process.env.HOURLY_KEY_BUDGET ?? 15)

export class LaunchError extends Error { constructor(msg, status = 400) { super(msg); this.status = status } }

/** Checks and normalises the form. Throws LaunchError with a message the form can show. */
export function validateLaunch(body) {
  const name = String(body.name ?? '').trim()
  const symbol = String(body.symbol ?? '').trim().replace(/^\$/, '')
  if (!name || name.length > NAME_MAX) throw new LaunchError(`Name is 1 to ${NAME_MAX} characters`)
  if (!symbol || symbol.length > SYMBOL_MAX || /\s/.test(symbol)) throw new LaunchError(`Ticker is 1 to ${SYMBOL_MAX} characters, no spaces`)
  const description = String(body.description ?? '').trim()
  let devBuy = 0n
  try { devBuy = BigInt(body.devBuyLamports ?? 0) } catch { throw new LaunchError('Dev buy is not a number') }
  if (devBuy < 0n || devBuy > MAX_DEV_BUY_LAMPORTS) throw new LaunchError('Dev buy is 0 to 100 SOL')
  let launcher
  try { launcher = new PublicKey(String(body.launcher)) } catch { throw new LaunchError('Connect a wallet first') }
  const url = (v) => {
    const s = String(v ?? '').trim()
    if (!s) return ''
    try { const u = new URL(s); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw 0; return u.toString() } catch { throw new LaunchError(`Not a link: ${s}`) }
  }
  return { name, symbol, description, devBuy, launcher, website: url(body.website), twitter: url(body.twitter), telegram: url(body.telegram), imageUrl: String(body.imageUrl ?? '') }
}

/** The description written into the coin: the launcher's text, then the fee line. */
export function composeDescription(text, creator, split = null) {
  const line = split ? splitFeeLine(split.recipients) : feeLine(creator)
  const body = text.includes(line) ? text : [text, line].filter(Boolean).join('\n\n')
  if (body.length > DESCRIPTION_MAX) throw new LaunchError(`Description is too long with the fee line (${body.length}/${DESCRIPTION_MAX})`)
  return body
}

/**
 * pump.fun's metadata upload: multipart to pump.fun/api/ipfs. It REQUIRES an image (an empty file
 * is rejected) and returns { metadataUri }, which goes into create_v2 as `uri`.
 */
export async function uploadMetadata({ image, imageType, name, symbol, description, website, twitter, telegram }, fetchImpl = fetch) {
  const form = new FormData()
  form.append('file', new Blob([image], { type: imageType }), 'image')
  form.append('name', name)
  form.append('symbol', symbol)
  form.append('description', description)
  if (website) form.append('website', website)
  if (twitter) form.append('twitter', twitter)
  if (telegram) form.append('telegram', telegram)
  form.append('showName', 'true')
  const res = await fetchImpl('https://pump.fun/api/ipfs', { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new LaunchError(`pump.fun refused the metadata upload (${res.status})`, 502)
  const out = await res.json()
  if (typeof out.metadataUri !== 'string' || !/^https:\/\/[^\s]+$/.test(out.metadataUri) || out.metadataUri.length > 200) throw new LaunchError('pump.fun returned no usable metadata address', 502)
  return out
}

/**
 * Returns { mint, transaction } — a v0 transaction signed by the mint key, waiting for the
 * launcher's signature. `lookupTables` shrinks it under the 1,232-byte limit.
 */
/**
 * `split` (optional): { splitKeyHex, recipients: [{ identity, keyHex, bps }] } — the coin's creator is
 * then the split's fee address instead of the single creator's.
 */
export async function buildLaunch({ db, conn, program, global, creator, split = null, form, metadataUri, lookupTables = [], priorityMicroLamports = 200_000 }) {
  const creatorPk = split ? feeAddressOf(Buffer.from(split.splitKeyHex, 'hex')) : new PublicKey(addressesOf(creator).feeAddress)
  // ⛔ Keys are never reused, so one is only spent on a wallet that can actually pay for the launch.
  const balance = BigInt(await conn.getBalance(form.launcher))
  const needed = form.devBuy + MIN_LAUNCH_LAMPORTS
  if (balance < needed) throw new LaunchError(`This wallet holds ${(Number(balance) / 1e9).toFixed(4)} SOL; the launch needs about ${(Number(needed) / 1e9).toFixed(3)} SOL`)
  // Keys are finite: at most a few per wallet per day, and never faster overall than the grinder refills.
  const who = form.launcher.toBase58()
  const mineToday = db.prepare(`SELECT count(*) n FROM vanity WHERE launcher = ? AND issued_at > ?`).get(who, now() - 86400).n
  if (mineToday >= MAX_KEYS_PER_WALLET_DAY) throw new LaunchError('This wallet has prepared enough launches for today', 429)
  const lastHour = db.prepare(`SELECT count(*) n FROM vanity WHERE state != 'fresh' AND issued_at > ? AND (launcher IS NULL OR launcher != ?)`).get(now() - 3600, who).n
  if (lastHour >= HOURLY_KEY_BUDGET) throw new LaunchError('Launches are busy right now. Try again in a few minutes.', 503)
  const mint = issueKey(db, who)
  if (!mint) throw new LaunchError('No launch addresses ready. Try again in a minute.', 503)

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: form.devBuy > 0n ? 400_000 : 250_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }),
  ]
  // A fee address under the rent floor makes pump.fun skip small collections (DESIGN.md). Topping
  // it up once, from the launcher, lets the first small fees through; it is paid at most once per creator.
  const floor = await conn.getMinimumBalanceForRentExemption(0)
  const have = await conn.getBalance(creatorPk)
  if (have < floor) ixs.push(SystemProgram.transfer({ fromPubkey: form.launcher, toPubkey: creatorPk, lamports: floor - have }))

  ixs.push(await createV2Ix(program, { mint: mint.publicKey, user: form.launcher, name: form.name, symbol: form.symbol, uri: metadataUri, creator: creatorPk }))
  if (form.devBuy > 0n) {
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(form.launcher, ata(form.launcher, mint.publicKey, TOKEN_2022), form.launcher, mint.publicKey, TOKEN_2022))
    // minTokensOut 1: the create is in this same transaction, so no one can trade before this buy.
    ixs.push(await buyExactSolInIx(program, global, { mint: mint.publicKey, user: form.launcher, creator: creatorPk, lamports: form.devBuy }))
  }

  const { blockhash } = await conn.getLatestBlockhash('confirmed')
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: form.launcher, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lookupTables))
  tx.sign([mint])
  const bytes = tx.serialize().length
  if (bytes > 1232) throw new LaunchError(`Launch transaction is ${bytes} bytes, over Solana's 1,232`, 500)

  db.prepare(`INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)`).run(`pending:${mint.publicKey.toBase58()}`, JSON.stringify({
    creator: { provider: creator.provider, id: creator.id }, name: form.name, symbol: form.symbol, description: form.description,
    image: form.imageUrl, metadataUri, launcher: form.launcher.toBase58(), at: now(),
    split: split ? { splitKeyHex: split.splitKeyHex, feeAddress: creatorPk.toBase58(), recipients: split.recipients.map((r) => ({ provider: r.identity.provider, id: r.identity.id, keyHex: r.keyHex, bps: r.bps })) } : null,
  }))
  return { mint: mint.publicKey.toBase58(), transaction: Buffer.from(tx.serialize()).toString('base64'), bytes }
}

/**
 * Records a launch once the chain shows it: the curve exists AND its creator is the fee address we
 * built it for. Anything else is refused — the site lists only what pays the creator it names.
 */
export async function confirmLaunch({ db, conn, mint, signature }) {
  const pending = db.prepare('SELECT v FROM kv WHERE k = ?').get(`pending:${mint}`)
  if (!pending) throw new LaunchError('Unknown launch', 404)
  const p = JSON.parse(pending.v)
  const curveInfo = await conn.getAccountInfo(bondingCurveAddress(new PublicKey(mint)), 'confirmed')
  if (!curveInfo) throw new LaunchError('The launch has not landed yet', 409)
  const curve = decodeBondingCurve(curveInfo.data)
  const creatorRow = db.prepare('SELECT key_hex, fee_address FROM creators WHERE provider = ? AND id = ?').get(p.creator.provider, String(p.creator.id))
  const expectedFee = p.split ? p.split.feeAddress : creatorRow?.fee_address
  if (!creatorRow || curve.creator.toBase58() !== expectedFee) throw new LaunchError('This coin does not pay the creator it was built for', 409)
  db.prepare(`
    INSERT OR IGNORE INTO tokens (mint, name, symbol, image, description, metadata_uri, creator_key, launcher, launch_sig, created_at, split_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mint, p.name, p.symbol, p.image, p.description, p.metadataUri, creatorRow.key_hex, p.launcher, signature ?? null, p.at, p.split?.splitKeyHex ?? null)
  const recipients = p.split ? p.split.recipients : [{ keyHex: creatorRow.key_hex, bps: 10000 }]
  for (const r of recipients) db.prepare('INSERT OR IGNORE INTO token_recipients (mint, key_hex, bps) VALUES (?, ?, ?)').run(mint, r.keyHex, r.bps)
  if (p.split) db.prepare('INSERT OR IGNORE INTO splits (split_key_hex, fee_address, recipients_json, created_at) VALUES (?, ?, ?, ?)')
    .run(p.split.splitKeyHex, p.split.feeAddress, JSON.stringify(recipients.map((r) => ({ keyHex: r.keyHex, bps: r.bps }))), now())
  markLaunched(db, mint)
  db.prepare('DELETE FROM kv WHERE k = ?').run(`pending:${mint}`)
  return { ok: true }
}
