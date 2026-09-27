// The launch gate and the $EARN platform slot, against the real pump.fun program on the local
// validator (./run-tests.sh). pump.fun's web API cannot see a local coin, so its answer is stubbed;
// everything on chain is real.
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { before, test } from 'node:test'
import { openDb } from '../api/db.mjs'
import { clearPlatformToken, platformState, setPlatformToken, verifyPlatformToken } from '../api/platform.mjs'
import { TOKEN_2022, ata, buyExactSolInIx, createV2Ix, loadGlobal, pumpProgram } from '../lib/pump.mjs'

const conn = new Connection(`http://127.0.0.1:${process.env.LOCAL_RPC_PORT ?? 8997}`, 'confirmed')
const dir = new URL('./fixtures/earn-mints/', import.meta.url)
const [earnMint, otherEarnMint] = readdirSync(dir).map((f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL(f, dir))))))
const founder = Keypair.generate(), stranger = Keypair.generate()
const plainMint = Keypair.generate() // does not end in "earn"
const db = openDb(':memory:')
const pumpApi = (symbol) => async () => new Response(JSON.stringify({ symbol, name: 'Earn', image_uri: 'https://example.invalid/e.png', created_timestamp: Date.now(), usd_market_cap: 5000, complete: false }))
const display = { provider: 'x', id: '2104105688423145472', handle: 'earndotmoney', name: 'Earn', avatar: null }

async function launch(mint, creator, payer) {
  const pump = pumpProgram(conn), global = await loadGlobal(conn)
  const { blockhash } = await conn.getLatestBlockhash()
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [
    await createV2Ix(pump, { mint: mint.publicKey, user: payer.publicKey, name: 'Earn', symbol: 'EARN', uri: 'https://example.invalid/m.json', creator }),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(payer.publicKey, mint.publicKey, TOKEN_2022), payer.publicKey, mint.publicKey, TOKEN_2022),
    await buyExactSolInIx(pump, global, { mint: mint.publicKey, user: payer.publicKey, creator, lamports: BigInt(LAMPORTS_PER_SOL) }),
  ] }).compileToV0Message())
  tx.sign([payer, mint])
  await conn.confirmTransaction({ signature: await conn.sendTransaction(tx), ...(await conn.getLatestBlockhash()) })
}

before(async () => {
  for (const k of [founder, stranger]) {
    const s = await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL)
    await conn.confirmTransaction({ signature: s, ...(await conn.getLatestBlockhash()) })
  }
  await launch(earnMint, founder.publicKey, founder)          // the real one: founder is the fee recipient
  await launch(otherEarnMint, stranger.publicKey, stranger)   // ends in earn, but pays someone else
  await launch(plainMint, founder.publicKey, founder)         // pays the founder, wrong suffix
})

test('the gate starts closed', () => {
  assert.deepEqual(platformState(db), { launchesOpen: false, mint: null })
})

test('a CA that does not end in earn is refused', async () => {
  await assert.rejects(verifyPlatformToken({ conn, mint: plainMint.publicKey.toBase58(), founder: founder.publicKey.toBase58(), fetchImpl: pumpApi('EARN') }), /must end in "earn"/)
})

test('a coin with another ticker is refused', async () => {
  await assert.rejects(verifyPlatformToken({ conn, mint: earnMint.publicKey.toBase58(), founder: founder.publicKey.toBase58(), fetchImpl: pumpApi('FAKE') }), /Ticker is FAKE/)
})

test('an …earn coin whose fees go to someone else is refused', async () => {
  await assert.rejects(verifyPlatformToken({ conn, mint: otherEarnMint.publicKey.toBase58(), founder: founder.publicKey.toBase58(), fetchImpl: pumpApi('EARN') }), /fee recipient is/)
})

test('the real $EARN is accepted, listed as the platform token, and opens launching; clearing closes it', async () => {
  const mint = earnMint.publicKey.toBase58()
  const { coin, creator } = await verifyPlatformToken({ conn, mint, founder: founder.publicKey.toBase58(), fetchImpl: pumpApi('EARN') })
  assert.equal(creator, founder.publicKey.toBase58())
  setPlatformToken(db, { mint, coin, creator, displayIdentity: display })
  assert.deepEqual(platformState(db), { launchesOpen: true, mint })
  const row = db.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint)
  assert.equal(row.platform, 1)
  assert.equal(row.fee_recipient, founder.publicKey.toBase58())
  clearPlatformToken(db)
  assert.deepEqual(platformState(db), { launchesOpen: false, mint: null })
  assert.equal(db.prepare('SELECT count(*) n FROM tokens').get().n, 0)
})

test('an unreadable platform record keeps the gate closed', () => {
  db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('platform', 'not json')").run()
  assert.equal(platformState(db).launchesOpen, false)
})
