// End to end against the REAL pump.fun program cloned onto a local validator (./validator.sh):
// launch a coin naming an EARN fee address → buy → collect → harvest (80/20) → withdraw.
//   ./validator.sh &   then   node --test tests/
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAccount, createMint } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js'
import BN from 'bn.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import { accountAddress, feeAddress, creatorKey, earnIdl, canonicalSplit, splitAddress } from '../lib/earn.mjs'
import { TOKEN_2022, ata, buyExactSolInIx, collectCreatorFeeIx, createV2Ix, loadGlobal, pumpProgram } from '../lib/pump.mjs'

const RPC = `http://127.0.0.1:${process.env.LOCAL_RPC_PORT ?? 8997}`
const conn = new Connection(RPC, 'confirmed')
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const usdcAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL('./fixtures/usdc-authority.json', import.meta.url)))))

const admin = Keypair.generate(), signer = Keypair.generate(), relayer = Keypair.generate()
const treasury = Keypair.generate().publicKey, launcher = Keypair.generate()
const key = creatorKey('x', '44196397')
const fee = feeAddress(key), account = accountAddress(key)
const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], new PublicKey(earnIdl.address))[0]
let earn, pump, global, floor

async function airdrop(to, sol) {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL)
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) })
}
async function send(ixs, signers, payer = signers[0]) {
  const { blockhash } = await conn.getLatestBlockhash()
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...ixs] }).compileToV0Message())
  tx.sign(signers)
  const sig = await conn.sendTransaction(tx, { skipPreflight: true })
  const res = await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) })
  if (res.value.err) {
    const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 })
    const e = new Error(`tx failed: ${JSON.stringify(res.value.err)}`); e.logs = t?.meta?.logMessages ?? []; throw e
  }
  return sig
}
async function rejects(promise, code) {
  await assert.rejects(promise, (e) => {
    const hit = (e.logs ?? []).some((l) => l.includes(`Error Code: ${code}`))
    if (!hit) console.log(e.message, (e.logs ?? []).slice(-6))
    return hit
  })
}
const cfg = (over = {}) => ({ signer: signer.publicKey, treasury, recipientBps: 10000, dailyCap: new BN(1000 * LAMPORTS_PER_SOL), paused: false, ...over })
const readAccount = () => earn.account.creatorAccount.fetch(account)
const withdrawIx = (lamports, mode, destination, minOut = 0, who = signer) => earn.methods
  .withdraw([...key], new BN(lamports), mode, new BN(minOut))
  .accountsPartial({ config: configPda, account, signer: who.publicKey, relayer: relayer.publicKey, destination, instructions: SYSVAR_INSTRUCTIONS_PUBKEY })
  .instruction()
const settleIx = (destination) => earn.methods.settle().accountsPartial({ account, destination }).instruction()

before(async () => {
  for (const k of [admin, relayer, launcher]) await airdrop(k.publicKey, 50)
  earn = new Program(earnIdl, new AnchorProvider(conn, new Wallet(admin), {}))
  pump = pumpProgram(conn)
  global = await loadGlobal(conn)
  floor = await conn.getMinimumBalanceForRentExemption(0)
})

const upgradeAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL('./fixtures/upgrade-authority.json', import.meta.url)))))
const programData = PublicKey.findProgramAddressSync([new PublicKey(earnIdl.address).toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0]
const initIx = (args, authority = upgradeAuthority) => earn.methods.initialize(admin.publicKey, args)
  .accountsPartial({ authority: authority.publicKey, program: new PublicKey(earnIdl.address), programData }).instruction()

test('only the upgrade authority initialises; the admin it names need not sign; any cut for EARN is refused', async () => {
  await airdrop(upgradeAuthority.publicKey, 5)
  const stranger = Keypair.generate(); await airdrop(stranger.publicKey, 2)
  await rejects(send([await initIx(cfg(), stranger)], [stranger]), 'NotUpgradeAuthority')
  await rejects(send([await initIx(cfg({ recipientBps: 9999 }))], [upgradeAuthority]), 'BadRecipientBps')
  await send([await initIx(cfg())], [upgradeAuthority])
  const c = await earn.account.config.fetch(configPda)
  assert.equal(c.recipientBps, 10000)
  assert.ok(c.admin.equals(admin.publicKey))
})

test('a coin launched for the creator pays its fees to the fee address, and harvest credits ALL of them to the creator', async () => {
  const mint = Keypair.generate()
  await send([
    await createV2Ix(pump, { mint: mint.publicKey, user: launcher.publicKey, name: 'Earn Test', symbol: 'ETEST', uri: 'https://example.invalid/m.json', creator: fee }),
    createAssociatedTokenAccountIdempotentInstruction(launcher.publicKey, ata(launcher.publicKey, mint.publicKey, TOKEN_2022), launcher.publicKey, mint.publicKey, TOKEN_2022),
    await buyExactSolInIx(pump, global, { mint: mint.publicKey, user: launcher.publicKey, creator: fee, lamports: 2n * BigInt(LAMPORTS_PER_SOL) }),
  ], [launcher, mint])
  // Anyone collects; the fee address never signs.
  const stranger = Keypair.generate(); await airdrop(stranger.publicKey, 1)
  await send([await collectCreatorFeeIx(pump, fee)], [stranger])
  const collected = await conn.getBalance(fee)
  assert.ok(collected > floor, `fees reached the fee address (${collected})`)

  const treasuryBefore = await conn.getBalance(treasury)
  await send([await earn.methods.harvest([...key]).accountsPartial({ config: configPda, treasury, payer: stranger.publicKey }).instruction()], [stranger])
  const gross = collected - floor
  const a = await readAccount()
  assert.equal(a.claimed.toNumber(), gross)
  assert.equal(a.credited.toNumber(), gross, 'the creator is credited 100%')
  assert.equal(await conn.getBalance(treasury) - treasuryBefore, 0, 'EARN takes nothing')
  assert.equal(await conn.getBalance(fee), floor, 'the fee address keeps exactly the rent floor')
})

test('harvest with nothing new is refused', async () => {
  await rejects(send([await earn.methods.harvest([...key]).accountsPartial({ config: configPda, treasury, payer: relayer.publicKey }).instruction()], [relayer]), 'NothingToHarvest')
})

test('withdraw needs the EARN signer and cannot exceed what is owed', async () => {
  const dest = Keypair.generate().publicKey
  const impostor = Keypair.generate()
  await rejects(send([await withdrawIx(1000, { sol: {} }, dest, 0, impostor)], [relayer, impostor]), 'WrongSigner')
  const owed = (await readAccount()).credited.toNumber()
  await rejects(send([await withdrawIx(owed + 1, { sol: {} }, dest)], [relayer, signer]), 'MoreThanOwed')
})

test('a withdrawal to the account itself, the config, or the fee address is refused (it would strand the balance)', async () => {
  for (const dest of [account, configPda, fee]) {
    await rejects(send([await withdrawIx(1000, { sol: {} }, dest)], [relayer, signer]), 'WrongDestination')
  }
})

test('withdraw in SOL pays the destination and books it', async () => {
  const dest = Keypair.generate().publicKey
  const half = Math.floor((await readAccount()).credited.toNumber() / 2)
  await send([await withdrawIx(half, { sol: {} }, dest)], [relayer, signer])
  assert.equal(await conn.getBalance(dest), half)
  const a = await readAccount()
  assert.equal(a.paid.toNumber(), half)
  assert.equal(a.nonce.toNumber(), 1)
})

test('a USDC withdrawal without settle, or with too little USDC delivered, reverts', async () => {
  const owner = Keypair.generate().publicKey
  const dest = ata(owner, USDC, TOKEN)
  await send([createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, dest, owner, USDC, TOKEN)], [relayer])
  await rejects(send([await withdrawIx(1000, { usdc: {} }, dest, 5_000)], [relayer, signer]), 'SettleMissing')
  await rejects(send([await withdrawIx(1000, { usdc: {} }, dest, 5_000), await settleIx(dest)], [relayer, signer]), 'SwapShort')
  await rejects(send([
    await withdrawIx(1000, { usdc: {} }, dest, 5_000),
    createMintToInstruction(USDC, dest, usdcAuthority.publicKey, 4_999), // stands in for the Jupiter swap
    await settleIx(dest),
  ], [relayer, signer, usdcAuthority]), 'SwapShort')
})

test('a USDC withdrawal into a token account of another mint is refused', async () => {
  const fake = await createMint(conn, relayer, relayer.publicKey, null, 6)
  const owner = Keypair.generate().publicKey
  const dest = ata(owner, fake, TOKEN)
  await send([createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, dest, owner, fake, TOKEN)], [relayer])
  await rejects(send([
    await withdrawIx(1000, { usdc: {} }, dest, 5_000),
    createMintToInstruction(fake, dest, relayer.publicKey, 1_000_000),
    await settleIx(dest),
  ], [relayer, signer]), 'WrongDestination')
})

test('a USDC withdrawal that delivers at least min_out lands, and the relayer receives the SOL it swapped', async () => {
  const owner = Keypair.generate().publicKey
  const dest = ata(owner, USDC, TOKEN)
  await send([createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, dest, owner, USDC, TOKEN)], [relayer])
  const relayerBefore = await conn.getBalance(relayer.publicKey)
  const paidBefore = (await readAccount()).paid.toNumber()
  await send([
    await withdrawIx(100_000, { usdc: {} }, dest, 5_000),
    createMintToInstruction(USDC, dest, usdcAuthority.publicKey, 5_000),
    await settleIx(dest),
  ], [relayer, signer, usdcAuthority])
  assert.equal((await getAccount(conn, dest)).amount, 5_000n)
  const a = await readAccount()
  assert.equal(a.paid.toNumber() - paidBefore, 100_000)
  assert.ok(a.pendingDestination.equals(PublicKey.default), 'settle cleared the pending withdrawal')
  const fees = 5000 * 3 // three signatures
  assert.equal(await conn.getBalance(relayer.publicKey) - relayerBefore, 100_000 - fees)
})

test('only the admin changes config; pause and the daily ceiling stop withdrawals', async () => {
  const dest = Keypair.generate().publicKey
  const stranger = Keypair.generate(); await airdrop(stranger.publicKey, 1)
  await assert.rejects(send([await earn.methods.setConfig(cfg({ paused: true })).accountsPartial({ admin: stranger.publicKey }).instruction()], [stranger]))
  for (const bps of [9999, 9000, 5000, 0]) await rejects(send([await earn.methods.setConfig(cfg({ recipientBps: bps })).accountsPartial({ admin: admin.publicKey }).instruction()], [admin]), 'BadRecipientBps')

  await send([await earn.methods.setConfig(cfg({ paused: true })).accountsPartial({ admin: admin.publicKey }).instruction()], [admin])
  await rejects(send([await withdrawIx(1000, { sol: {} }, dest)], [relayer, signer]), 'Paused')

  await send([await earn.methods.setConfig(cfg({ dailyCap: new BN(1) })).accountsPartial({ admin: admin.publicKey }).instruction()], [admin])
  await rejects(send([await withdrawIx(1000, { sol: {} }, dest)], [relayer, signer]), 'DailyCapReached')
  await send([await earn.methods.setConfig(cfg()).accountsPartial({ admin: admin.publicKey }).instruction()], [admin])
})

test('anything else reaching the fee address is credited to the creator in full too', async () => {
  await airdrop(fee, 1)
  const before = await readAccount(), treasuryBefore = await conn.getBalance(treasury)
  await send([await earn.methods.harvest([...key]).accountsPartial({ config: configPda, treasury, payer: relayer.publicKey }).instruction()], [relayer])
  const a = await readAccount()
  assert.equal(a.credited.toNumber() - before.credited.toNumber(), LAMPORTS_PER_SOL)
  assert.equal(await conn.getBalance(treasury), treasuryBefore)
})

// ── fee splits ────────────────────────────────────────────────────────────────────────────────
const sk = { a: creatorKey('x', '1001'), b: creatorKey('github', '1002'), c: creatorKey('twitch', '1003') }
const createSplitIx = (splitKey, recipients, payer = relayer) => earn.methods.createSplit([...splitKey], recipients.map((r) => ({ key: [...r.key], bps: r.bps })))
  .accountsPartial({ split: splitAddress(splitKey), payer: payer.publicKey }).instruction()
const initAccountIx = (k, payer = relayer) => earn.methods.initAccount([...k]).accountsPartial({ account: accountAddress(k), payer: payer.publicKey }).instruction()
const harvestSplitIx = (splitKey, keys) => earn.methods.harvestSplit([...splitKey])
  .accountsPartial({ feeAddress: feeAddress(splitKey), split: splitAddress(splitKey) })
  .remainingAccounts(keys.map((k) => ({ pubkey: accountAddress(k), isSigner: false, isWritable: true }))).instruction()

test('a split must have 2 to 8 distinct recipients in canonical order whose shares total exactly 100%', async () => {
  const good = canonicalSplit([{ key: sk.a, bps: 5000 }, { key: sk.b, bps: 3000 }, { key: sk.c, bps: 2000 }])
  // wrong total (the JS helper refuses too, so hand-build the argument the program sees)
  const short = good.recipients.map((r, i) => ({ ...r, bps: i === 0 ? 4000 : r.bps }))
  await rejects(send([await createSplitIx(good.splitKey, short)], [relayer]), 'SplitNotWhole')
  // shares summing to 100% but under the wrong key
  await rejects(send([await createSplitIx(Buffer.alloc(32, 7), good.recipients)], [relayer]), 'WrongSplitKey')
  // out of canonical order
  const reversed = [...good.recipients].reverse()
  await rejects(send([await createSplitIx(good.splitKey, reversed)], [relayer]), 'BadSplit')
  // a single recipient is not a split
  await rejects(send([await createSplitIx(Buffer.alloc(32, 1), [{ key: sk.a, bps: 10000 }])], [relayer]), 'BadSplit')
  // the right one lands, and only once
  await send([await createSplitIx(good.splitKey, good.recipients)], [relayer])
  const onChain = await earn.account.split.fetch(splitAddress(good.splitKey))
  assert.deepEqual(onChain.recipients.map((r) => r.bps), good.recipients.map((r) => r.bps))
  await assert.rejects(send([await createSplitIx(good.splitKey, good.recipients)], [relayer]), /tx failed/)
})

test('harvest_split divides the fees by the shares exactly, into each recipient account, and needs the right accounts', async () => {
  const { splitKey, recipients } = canonicalSplit([{ key: sk.a, bps: 5000 }, { key: sk.b, bps: 3000 }, { key: sk.c, bps: 2000 }])
  const keys = recipients.map((r) => r.key)
  const splitFee = feeAddress(splitKey)
  await airdrop(splitFee, 1) // 1 SOL of "creator fees" arrive at the split's fee address
  // accounts not initialised yet → refused
  await rejects(send([await harvestSplitIx(splitKey, keys)], [relayer]), 'WrongAccount')
  await send(await Promise.all(keys.map((k) => initAccountIx(k))), [relayer])
  // accounts in the wrong order → refused
  await rejects(send([await harvestSplitIx(splitKey, [...keys].reverse())], [relayer]), 'WrongAccount')
  const before = await conn.getBalance(splitFee)
  const gross = before - floor
  await send([await harvestSplitIx(splitKey, keys)], [relayer])
  assert.equal(await conn.getBalance(splitFee), floor, 'the split fee address keeps exactly the rent floor')
  const got = await Promise.all(keys.map((k) => earn.account.creatorAccount.fetch(accountAddress(k))))
  const shares = got.map((a) => a.credited.toNumber())
  // canonical order is by key, so read each expected share off the recipient's own bps; the last takes the remainder
  const expected = recipients.map((r) => Math.floor(gross * r.bps / 10000))
  expected[2] = gross - expected[0] - expected[1]
  assert.deepEqual(shares, expected)
  assert.equal(shares.reduce((x, y) => x + y, 0), gross, 'nothing is left unallocated')
  await rejects(send([await harvestSplitIx(splitKey, keys)], [relayer]), 'NothingToHarvest')

  // a recipient withdraws their own part like any creator
  const k = keys[1], dest = Keypair.generate().publicKey
  const ix = await earn.methods.withdraw([...k], new BN(shares[1]), { sol: {} }, new BN(0))
    .accountsPartial({ config: configPda, account: accountAddress(k), signer: signer.publicKey, relayer: relayer.publicKey, destination: dest, instructions: SYSVAR_INSTRUCTIONS_PUBKEY }).instruction()
  await send([ix], [relayer, signer])
  assert.equal(await conn.getBalance(dest), shares[1])
})
