// EARN feasibility probe — SIMULATION ONLY (simulateTransaction, sigVerify off). Nothing is sent.
// On current mainnet state: launch a coin whose `creator` is an off-curve program PDA, buy, then
// collect the creator fees into that PDA with nobody signing for it.
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { createHash } from 'node:crypto'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { ata, TOKEN_2022, buyExactSolInIx, collectCreatorFeeIx, createV2Ix, creatorVaultAddress, loadGlobal, pumpProgram } from '../lib/pump.mjs'

const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://solana-rpc.publicnode.com', 'confirmed')
const program = pumpProgram(conn)
const global = await loadGlobal(conn)
console.log('global: creator fee bps', global.creator_fee_basis_points.toString(), '| create_v2 enabled', global.create_v2_enabled,
  '| creator fee configurable', global.creator_fee_configurable, 'max', global.max_configurable_creator_fee_bps?.toString())

const PAYER = new PublicKey('62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV') // funded system account; simulation only
const standIn = Keypair.generate().publicKey // stands in for the EARN program id
const feeAddr = PublicKey.findProgramAddressSync([Buffer.from('fee'), createHash('sha256').update('x:44196397').digest()], standIn)[0]
console.log('fee address', feeAddr.toBase58(), 'on curve:', PublicKey.isOnCurve(feeAddr.toBytes()))

async function run(label, lamports, { prefund = false, creatorFeeBps = null } = {}) {
  const mint = Keypair.generate()
  const ixs = []
  if (prefund) ixs.push(SystemProgram.transfer({ fromPubkey: PAYER, toPubkey: feeAddr, lamports: 890_880 }))
  ixs.push(await createV2Ix(program, { mint: mint.publicKey, user: PAYER, name: 'Earn Probe', symbol: 'EPRB', uri: 'https://example.invalid/m.json', creator: feeAddr, creatorFeeBps }))
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(PAYER, ata(PAYER, mint.publicKey, TOKEN_2022), PAYER, mint.publicKey, TOKEN_2022))
  ixs.push(await buyExactSolInIx(program, global, { mint: mint.publicKey, user: PAYER, creator: feeAddr, lamports }))
  ixs.push(await collectCreatorFeeIx(program, feeAddr))
  const { blockhash } = await conn.getLatestBlockhash('confirmed')
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: PAYER, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message())
  tx.sign([mint])
  const vault = creatorVaultAddress(feeAddr)
  const sim = await conn.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [feeAddr.toBase58(), vault.toBase58()] } })
  const logs = sim.value.logs ?? []
  const [fa, va] = sim.value.accounts ?? []
  console.log(`\n${sim.value.err ? '✗' : '✓'} ${label}: ${sim.value.err ? JSON.stringify(sim.value.err) : 'OK'}  (${tx.serialize().length} bytes, CU ${sim.value.unitsConsumed})`)
  console.log(`   fee address: ${fa ? fa.lamports + ' lamports, owner ' + fa.owner : 'no account'} | creator vault: ${va ? va.lamports : 'no account'}`)
  if (sim.value.err) console.log(logs.filter((l) => /Error|error|failed|insufficient|rent/i.test(l)).slice(-6).map((l) => '     ' + l).join('\n'))
}

await run('0.5 SOL buy, no prefund', 500_000_000n)
await run('0.02 SOL buy, no prefund', 20_000_000n)
await run('0.02 SOL buy, fee address prefunded to the rent floor', 20_000_000n, { prefund: true })
await run('0.5 SOL buy, creator tax 100 bps', 500_000_000n, { creatorFeeBps: 100n })
