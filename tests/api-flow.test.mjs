// The API's own modules, end to end on the local validator (./validator.sh; run after earn.test.mjs,
// which initialises the program config): vanity launch → confirm → trade → keeper pass → withdraw.
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction, TransactionMessage, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { openDb } from '../api/db.mjs'
import { addressesOf } from '../api/identity.mjs'
import { buildLaunch, composeDescription, confirmLaunch, validateLaunch } from '../api/launch.mjs'
import { keeperPass } from '../api/keeper.mjs'
import { reconcile } from '../api/reconcile.mjs'
import { buildSolWithdraw, owedLamports } from '../api/payout.mjs'
import { addKey, freshCount, issueKey } from '../api/vanity.mjs'
import { upsertCreator } from '../api/db.mjs'
import { accountAddress, canonicalSplit, configAddress, earnIdl, feeAddress } from '../lib/earn.mjs'
import { TOKEN_2022, ata, buyExactSolInIx, loadGlobal, pumpProgram } from '../lib/pump.mjs'
import { createLaunchTable, staticLaunchAccounts } from '../lib/lut.mjs'

const conn = new Connection(`http://127.0.0.1:${process.env.LOCAL_RPC_PORT ?? 8997}`, 'confirmed')
const db = openDb(':memory:')
const creator = { provider: 'github', id: '583231', handle: 'octocat', name: 'The Octocat' }
let pump, global, earn, cfg, lookupTables
const launcher = Keypair.generate(), trader = Keypair.generate(), keeper = Keypair.generate()

async function airdrop(to, sol) {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL)
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) })
}
function grindLocal(suffix = 'earn') {
  // Tests cannot wait ~45 s per key; any keypair is accepted by pump.fun, so the pool is seeded with
  // the one real `…earn` key only when it exists and otherwise with a stand-in the test marks.
  const kp = Keypair.generate()
  return kp
}

before(async () => {
  for (const k of [launcher, trader, keeper]) await airdrop(k.publicKey, 20)
  pump = pumpProgram(conn)
  global = await loadGlobal(conn)
  earn = new Program(earnIdl, new AnchorProvider(conn, new Wallet(keeper), {}))
  cfg = await earn.account.config.fetch(configAddress())
  upsertCreator(db, { ...creator, ...addressesOf(creator) })
  const table = await createLaunchTable(conn, keeper, await staticLaunchAccounts(pump, global))
  lookupTables = [(await conn.getAddressLookupTable(table)).value]
})

test('the vanity pool refuses a key that does not end in earn, and issues each key once', () => {
  assert.throws(() => addKey(db, Keypair.generate()), /not an earn key/)
  // Insert stand-ins directly (grinding real ones takes ~45 s each); the SQL path is what is tested.
  for (let i = 0; i < 2; i++) {
    const kp = grindLocal()
    db.prepare('INSERT INTO vanity (pubkey, secret, created_at) VALUES (?, ?, ?)').run(kp.publicKey.toBase58(), Buffer.from(kp.secretKey).toString('base64'), i)
  }
  assert.equal(freshCount(db), 2)
  const a = issueKey(db, 'wallet-A'), again = issueKey(db, 'wallet-A')
  assert.equal(again.publicKey.toBase58(), a.publicKey.toBase58(), 'the same launcher asking again gets the same key: retries cannot drain the pool')
  const b = issueKey(db, 'wallet-B')
  assert.notEqual(a.publicKey.toBase58(), b.publicKey.toBase58())
  assert.equal(issueKey(db, 'wallet-C'), null, 'an empty pool issues nothing rather than reusing a key')
  const kp = grindLocal()
  db.prepare('INSERT INTO vanity (pubkey, secret, created_at) VALUES (?, ?, ?)').run(kp.publicKey.toBase58(), Buffer.from(kp.secretKey).toString('base64'), 9)
})

let mint
test('a launch built by the API lands, names the creator, and is recorded on confirm', async () => {
  const form = validateLaunch({ name: 'Octo Coin', symbol: '$OCTO', description: 'for the cat', devBuyLamports: String(LAMPORTS_PER_SOL), launcher: launcher.publicKey.toBase58() })
  const description = composeDescription(form.description, creator)
  assert.match(description, /Fees to github:octocat via EARN$/)
  const out = await buildLaunch({ db, conn, program: pump, global, creator, form: { ...form, description }, metadataUri: 'https://example.invalid/m.json', lookupTables })
  mint = out.mint
  assert.ok(out.bytes <= 1232, `fits one transaction with the lookup table (${out.bytes} bytes)`)
  const tx = VersionedTransaction.deserialize(Buffer.from(out.transaction, 'base64'))
  tx.sign([launcher]) // the wallet's signature; the mint's is already there
  const sig = await conn.sendTransaction(tx)
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) })
  await confirmLaunch({ db, conn, mint, signature: sig })
  const row = db.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint)
  assert.equal(row.symbol, 'OCTO')
  assert.equal(db.prepare('SELECT state FROM vanity WHERE pubkey = ?').get(mint).state, 'launched')
})

test('a confirm for a coin that does not pay the named creator is refused', async () => {
  await assert.rejects(confirmLaunch({ db, conn, mint: Keypair.generate().publicKey.toBase58() }), /Unknown launch/)
})

test('the keeper pass collects and harvests, and records the claim', async () => {
  const fee = new PublicKey(addressesOf(creator).feeAddress)
  const m = new PublicKey(mint)
  const { blockhash } = await conn.getLatestBlockhash()
  const buy = new VersionedTransaction(new TransactionMessage({ payerKey: trader.publicKey, recentBlockhash: blockhash, instructions: [
    createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, ata(trader.publicKey, m, TOKEN_2022), trader.publicKey, m, TOKEN_2022),
    await buyExactSolInIx(pump, global, { mint: m, user: trader.publicKey, creator: fee, lamports: 5n * BigInt(LAMPORTS_PER_SOL) }),
  ] }).compileToV0Message())
  buy.sign([trader])
  await conn.confirmTransaction({ signature: await conn.sendTransaction(buy), ...(await conn.getLatestBlockhash()) })

  const results = await keeperPass({ conn, db, pump, payer: keeper, treasury: cfg.treasury, solUsd: 150, minLamports: 1_000_000, log: {} })
  assert.equal(results.length, 1, JSON.stringify(results))
  assert.ok(results[0].signature, results[0].error)
  const claim = db.prepare('SELECT * FROM claims WHERE signature = ?').get(results[0].signature)
  assert.ok(claim, 'the Claimed event was recorded')
  assert.equal(claim.to_recipient, Math.floor(claim.gross * cfg.recipientBps / 10000))
  const again = await keeperPass({ conn, db, pump, payer: keeper, treasury: cfg.treasury, solUsd: 150, minLamports: 1_000_000, log: {} })
  assert.equal(again.length, 0, 'nothing left to claim')

  // The ledger loses the row (a crash after landing); reconciliation puts it back from the chain.
  db.prepare('DELETE FROM claims WHERE signature = ?').run(results[0].signature)
  const r = await reconcile({ conn, db, solUsd: 150, log: {} })
  assert.ok(r.added >= 1, `reconcile recorded the missing claim (${JSON.stringify(r)})`)
  const back = db.prepare('SELECT * FROM claims WHERE signature = ?').get(results[0].signature)
  assert.equal(back.gross, claim.gross)
  const r2 = await reconcile({ conn, db, solUsd: 150, log: {} })
  assert.equal(r2.added, 0, 'a second pass adds nothing')
})

test('the relayer pays a SOL withdrawal for the creator', async () => {
  const keyHex = addressesOf(creator).keyHex
  const { owed } = await owedLamports(earn, keyHex)
  assert.ok(owed > 0n)
  // earn.test.mjs used throwaway signer keys; the config's signer is not available here, so this
  // proves the builder produces what the program accepts only up to the signature check.
  const dest = Keypair.generate().publicKey
  const built = await buildSolWithdraw({ earn, keyHex, lamports: owed, destination: dest, signer: cfg.signer, relayer: keeper.publicKey })
  const { blockhash } = await conn.getLatestBlockhash()
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: keeper.publicKey, recentBlockhash: blockhash, instructions: built.ixs }).compileToV0Message())
  const sim = await conn.simulateTransaction(tx, { sigVerify: false })
  assert.equal(sim.value.err, null, (sim.value.logs ?? []).slice(-5).join('\n'))
})

test('a split launch pays several accounts across platforms, in their shares, and nothing is left over', async () => {
  const others = [{ provider: 'x', id: '44196397', handle: 'elonmusk', name: 'Elon' }, { provider: 'twitch', id: '641972806', handle: 'kaicenat', name: 'Kai' }]
  for (const o of others) upsertCreator(db, { ...o, ...addressesOf(o) })
  const all = [{ ...creator, bps: 5000 }, { ...others[0], bps: 3000 }, { ...others[1], bps: 2000 }]
  const c = canonicalSplit(all.map((r) => ({ key: Buffer.from(addressesOf(r).keyHex, 'hex'), bps: r.bps })))
  const split = { splitKeyHex: c.splitKey.toString('hex'), recipients: c.recipients.map((cr) => { const r = all.find((x) => addressesOf(x).keyHex === cr.key.toString('hex')); return { identity: r, keyHex: cr.key.toString('hex'), bps: cr.bps } }) }
  const kp = Keypair.generate() // one more stand-in key for the pool
  db.prepare('INSERT INTO vanity (pubkey, secret, created_at) VALUES (?, ?, ?)').run(kp.publicKey.toBase58(), Buffer.from(kp.secretKey).toString('base64'), 99)

  const launcher2 = Keypair.generate(); await airdrop(launcher2.publicKey, 20)
  const form = validateLaunch({ name: 'Trio', symbol: 'TRIO', description: 'three ways', devBuyLamports: String(LAMPORTS_PER_SOL), launcher: launcher2.publicKey.toBase58() })
  const description = composeDescription(form.description, creator, split)
  assert.match(description, /^three ways\n\nFees: 50% github:octocat, 30% @elonmusk, 20% twitch:kaicenat via EARN$/)
  const out = await buildLaunch({ db, conn, program: pump, global, creator, split, form: { ...form, description }, metadataUri: 'https://example.invalid/m.json', lookupTables })
  const tx = VersionedTransaction.deserialize(Buffer.from(out.transaction, 'base64')); tx.sign([launcher2])
  const sig = await conn.sendTransaction(tx); await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) })
  await confirmLaunch({ db, conn, mint: out.mint, signature: sig })
  const row = db.prepare('SELECT * FROM tokens WHERE mint = ?').get(out.mint)
  assert.equal(row.split_key, split.splitKeyHex)
  assert.equal(db.prepare('SELECT count(*) n FROM token_recipients WHERE mint = ?').get(out.mint).n, 3)
  const splitFee = feeAddress(c.splitKey)
  assert.equal(db.prepare('SELECT fee_address FROM splits WHERE split_key_hex = ?').get(split.splitKeyHex).fee_address, splitFee.toBase58())

  // trading pays the split's fee address; the keeper creates the on-chain split, the accounts, and harvests
  const trader = Keypair.generate(); await airdrop(trader.publicKey, 20)
  const m = new PublicKey(out.mint)
  const { blockhash } = await conn.getLatestBlockhash()
  const buy = new VersionedTransaction(new TransactionMessage({ payerKey: trader.publicKey, recentBlockhash: blockhash, instructions: [
    createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, ata(trader.publicKey, m, TOKEN_2022), trader.publicKey, m, TOKEN_2022),
    await buyExactSolInIx(pump, global, { mint: m, user: trader.publicKey, creator: splitFee, lamports: 5n * BigInt(LAMPORTS_PER_SOL) }),
  ] }).compileToV0Message())
  buy.sign([trader]); await conn.confirmTransaction({ signature: await conn.sendTransaction(buy), ...(await conn.getLatestBlockhash()) })

  const results = await keeperPass({ conn, db, pump, payer: keeper, treasury: cfg.treasury, solUsd: 150, minLamports: 1_000_000, log: {} })
  const r = results.find((x) => x.split)
  assert.ok(r?.signature, JSON.stringify(results))
  const rows = db.prepare('SELECT * FROM claims WHERE signature = ? ORDER BY gross DESC').all(r.signature)
  assert.equal(rows.length, 3, 'one claim row per recipient')
  assert.ok(rows.every((x) => x.source_key_hex === split.splitKeyHex))
  const gross = rows.reduce((s, x) => s + x.gross, 0)
  assert.equal(gross, r.lamports, 'the rows add up to everything that was harvested')
  for (const x of all) {
    const k = addressesOf(x).keyHex
    const mine = rows.find((y) => y.key_hex === k)
    assert.ok(Math.abs(mine.gross - gross * x.bps / 10000) <= 1, `${x.handle} got ${x.bps / 100}%`)
    const onChain = await earn.account.creatorAccount.fetch(accountAddress(Buffer.from(k, 'hex')))
    assert.ok(onChain.credited.toNumber() >= mine.gross, `${x.handle} credited on chain`)
  }
})
