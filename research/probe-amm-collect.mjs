// SIMULATION ONLY. On a real graduated coin: can anyone move the coin creator's PumpSwap fees
// to the creator without the creator signing? Tests both routes PumpSwap offers.
import { AnchorProvider, BorshCoder, Program } from '@coral-xyz/anchor'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { PUMP, WSOL, ata, ammCreatorVaultAuthority, creatorVaultAddress, pumpAmmIdl } from '../lib/pump.mjs'
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const conn = new Connection('https://solana-rpc.publicnode.com', 'confirmed')
const fx = JSON.parse(readFileSync(process.env.HOME + '/pumpfamily/fixtures/pump-market-accounts.json'))
const poolAddr = new PublicKey(fx.accounts['pool-migrated'].address)
const pool = new BorshCoder(pumpAmmIdl).accounts.decode('Pool', (await conn.getAccountInfo(poolAddr)).data)
const creator = pool.coin_creator
const vaultAta = ata(ammCreatorVaultAuthority(creator), WSOL, TOKEN)
const bal = await conn.getTokenAccountBalance(vaultAta).catch(() => null)
console.log('pool', poolAddr.toBase58(), 'coin_creator', creator.toBase58(), 'on curve', PublicKey.isOnCurve(creator.toBytes()), '| creator WSOL vault', bal?.value.amount ?? 'none')
const PAYER = new PublicKey('62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV')
const program = new Program(pumpAmmIdl, new AnchorProvider(conn, { publicKey: PAYER }, {}))
async function sim(label, ixs) {
  const { blockhash } = await conn.getLatestBlockhash()
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: PAYER, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message())
  const s = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
  console.log(`${s.value.err ? '✗' : '✓'} ${label}: ${s.value.err ? JSON.stringify(s.value.err) : 'OK'}`)
  if (s.value.err) console.log((s.value.logs ?? []).filter((l) => /Error|failed/.test(l)).slice(-4).map((l) => '   ' + l).join('\n'))
  else console.log((s.value.logs ?? []).filter((l) => /Transfer|amount/i.test(l)).slice(0, 4).map((l) => '   ' + l).join('\n'))
}
const dest = ata(creator, WSOL, TOKEN)
await sim('collect_coin_creator_fee → creator WSOL account, creator NOT signing', [
  createAssociatedTokenAccountIdempotentInstruction(PAYER, dest, creator, WSOL, TOKEN),
  await program.methods.collectCoinCreatorFee().accountsPartial({ quoteMint: WSOL, quoteTokenProgram: TOKEN, coinCreator: creator, coinCreatorTokenAccount: dest }).instruction(),
])
await sim('transfer_creator_fees_to_pump → pump creator vault, creator NOT signing', [
  await program.methods.transferCreatorFeesToPump().accountsPartial({ wsolMint: WSOL, tokenProgram: TOKEN, coinCreator: creator, pumpCreatorVault: creatorVaultAddress(creator) }).instruction(),
])
