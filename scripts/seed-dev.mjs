// Drives the local stack THROUGH ITS HTTP API the way the site does (scripts/dev-stack.sh first):
// look up a creator → upload → prepare → sign as the wallet → send → confirm → trades → keeper →
// sign in (stub) → withdraw. Leaves real data on the local site.
import { Connection, Keypair, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { execFileSync } from 'node:child_process'
import { PublicKey } from '@solana/web3.js'
import { TOKEN_2022, ata, bondingCurveAddress, buyExactSolInIx, decodeBondingCurve, loadGlobal, pumpProgram } from '../lib/pump.mjs'

const API = 'http://127.0.0.1:8820'
const conn = new Connection('http://127.0.0.1:8997', 'confirmed')
const env = { ...process.env, ...Object.fromEntries(execFileSync('cat', ['data/dev/api.env']).toString().trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2))) }
let cookie = ''
async function call(path, init = {}) {
  const res = await fetch(API + path, { redirect: 'manual', ...init, headers: { ...(init.headers ?? {}), cookie } })
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
  if (res.status === 302) return { location: res.headers.get('location') }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`)
  return body
}
const airdrop = async (to, sol) => { const s = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL); await conn.confirmTransaction({ signature: s, ...(await conn.getLatestBlockhash()) }) }

// A tiny PNG so the upload path is exercised for real.
// A real picture when one is at hand (so the cards look like production), else a 1px PNG.
import { existsSync, readFileSync } from 'node:fs'
const logoFile = `${process.env.HOME}/earn/web/brand/earn-logo-source.png`
const png = existsSync(logoFile) ? readFileSync(logoFile) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const pump = pumpProgram(conn), global = await loadGlobal(conn)

const launches = [
  { provider: 'x', handle: 'vitalikbuterin', name: 'Vitalik Coin', symbol: 'VITA', dev: 2 },
  { provider: 'github', handle: 'torvalds', name: 'Penguin', symbol: 'TUX', dev: 1 },
  { provider: 'twitch', handle: 'kaicenat', name: 'Kai Coin', symbol: 'KAI', dev: 0.5 },
  // a split: three accounts on three platforms
  { provider: 'x', handle: 'elonmusk', name: 'Trio Coin', symbol: 'TRIO', dev: 1, extra: [{ provider: 'github', handle: 'torvalds', bps: 3000 }, { provider: 'twitch', handle: 'kaicenat', bps: 2000 }], bps: 5000 },
]
const mints = []
// SEED_ONLY=TRIO limits the run to one launch (e.g. after the pool ran dry).
for (const l of launches.filter((x) => !process.env.SEED_ONLY || x.symbol === process.env.SEED_ONLY)) {
  const { items } = await call(`/api/lookup/${l.provider}?q=${l.handle}`)
  const creator = items[0]
  const recipients = [{ provider: creator.provider, id: creator.id, bps: l.bps ?? 10000 }]
  for (const e of l.extra ?? []) { const f = await call(`/api/lookup/${e.provider}?q=${e.handle}`); recipients.push({ provider: f.items[0].provider, id: f.items[0].id, bps: e.bps }) }
  const fd = new FormData(); fd.append('image', new Blob([png], { type: 'image/png' }), 'logo.png')
  const { imageUrl } = await call('/api/upload', { method: 'POST', body: fd })
  const wallet = Keypair.generate(); await airdrop(wallet.publicKey, 20)
  const prep = await call('/api/launch/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    creator: { provider: creator.provider, id: creator.id }, recipients, name: l.name, symbol: l.symbol, description: `For ${l.handle}.`,
    imageUrl, website: '', twitter: '', telegram: '', devBuyLamports: String(Math.round(l.dev * LAMPORTS_PER_SOL)), launcher: wallet.publicKey.toBase58(),
  }) })
  if (!prep.mint.endsWith('earn')) throw new Error(`mint ${prep.mint} does not end in earn`)
  const tx = VersionedTransaction.deserialize(Buffer.from(prep.transaction, 'base64'))
  tx.sign([wallet])
  const sig = await conn.sendTransaction(tx)
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) })
  await call('/api/launch/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: prep.mint, signature: sig }) })
  console.log(`launched ${l.symbol} ${prep.mint} for ${l.provider}:${l.handle}`)
  // Like any trader: the coin's creator (its fee address, single or split) comes off the bonding curve.
  const curve = decodeBondingCurve((await conn.getAccountInfo(bondingCurveAddress(new PublicKey(prep.mint)))).data)
  mints.push({ ...l, mint: prep.mint, feeAddress: curve.creator.toBase58() })
}

// Trading, so there are fees to claim.
for (const m of mints) {
  const trader = Keypair.generate(); await airdrop(trader.publicKey, 40)
  const mint = new PublicKey(m.mint), fee = new PublicKey(m.feeAddress)
  for (const sol of [3, 5, 8]) {
    const { blockhash } = await conn.getLatestBlockhash()
    const t = new VersionedTransaction(new TransactionMessage({ payerKey: trader.publicKey, recentBlockhash: blockhash, instructions: [
      createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, ata(trader.publicKey, mint, TOKEN_2022), trader.publicKey, mint, TOKEN_2022),
      await buyExactSolInIx(pump, global, { mint, user: trader.publicKey, creator: fee, lamports: BigInt(sol * LAMPORTS_PER_SOL) }),
    ] }).compileToV0Message())
    t.sign([trader]); await conn.confirmTransaction({ signature: await conn.sendTransaction(t), ...(await conn.getLatestBlockhash()) })
  }
}
console.log('trades done')
console.log(execFileSync('node', ['api/keeper-run.mjs'], { env: { ...env, MIN_CLAIM_LAMPORTS: '1000000' } }).toString().trim())

// Sign in as the X creator (stub) and withdraw half in SOL.
const start = await call('/api/auth/x/start?return=/claim&as=vitalikbuterin')
await call(new URL(start.location).pathname + new URL(start.location).search)
const me = await call('/api/me')
console.log('signed in:', JSON.stringify(me.accounts.map((a) => [a.creator.handle, a.owedLamports])))
const dest = Keypair.generate().publicKey
const w = await call('/api/withdraw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'x', lamports: 'all', mode: 'sol', destination: dest.toBase58() }) })
console.log('withdrew', w.signature, 'destination now holds', await conn.getBalance(dest))
