/**
 * Withdrawals. The creator never needs SOL: the relayer pays the fee, and the EARN signer co-signs
 * after the server has checked the sign-in (or, for fomo, the confirmed trading wallet).
 *
 * USDC: withdraw(mode Usdc, min_out) hands the lamports to the relayer → Jupiter swaps them into the
 * creator's USDC account → settle checks the account grew by at least min_out. One transaction; if
 * the swap comes up short, nothing moves.
 */
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from '@solana/web3.js'
import BN from 'bn.js'
import { accountAddress, configAddress } from '../lib/earn.mjs'
import { ata, WSOL } from '../lib/pump.mjs'

export const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const JUP = process.env.JUPITER_API ?? 'https://lite-api.jup.ag/swap/v1'
/** What a Jupiter swap may legitimately call. Anything else in its response is refused. */
const ALLOWED_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter aggregator v6
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', '11111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111',
])

/** Owed right now, straight from the chain: credited − paid on the creator's account. */
export async function owedLamports(earn, keyHex) {
  const acc = await earn.account.creatorAccount.fetchNullable(accountAddress(Buffer.from(keyHex, 'hex')))
  if (!acc) return { credited: 0n, paid: 0n, owed: 0n, claimed: 0n }
  const credited = BigInt(acc.credited.toString()), paid = BigInt(acc.paid.toString())
  return { credited, paid, owed: credited - paid, claimed: BigInt(acc.claimed.toString()) }
}

const toIx = (i) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(i.data, 'base64'),
})

async function jupiter(path, init) {
  const res = await fetch(`${JUP}${path}`, { ...init, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Jupiter ${path.split('?')[0]} answered ${res.status}`)
  return res.json()
}

/**
 * Returns { ixs, lookupTables, minOut, quote } for a USDC withdrawal of `lamports` to `owner`.
 * `slippageBps` bounds what the creator can lose to the swap; the program enforces `minOut`.
 */
export async function buildUsdcWithdraw({ conn, earn, keyHex, lamports, owner, signer, relayer, slippageBps = 100 }) {
  const quote = await jupiter(`/quote?inputMint=${WSOL}&outputMint=${USDC}&amount=${lamports}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`)
  const minOut = BigInt(quote.otherAmountThreshold)
  if (minOut <= 0n) throw new Error('Jupiter quoted nothing for this amount')
  // ⛔ Two hot keys sign what Jupiter returns, so it is checked, not trusted.
  if (String(quote.inAmount) !== String(lamports) || quote.swapMode !== 'ExactIn') throw new Error('Jupiter quote does not match the withdrawal')
  if (quote.inputMint !== WSOL.toBase58() || quote.outputMint !== USDC.toBase58()) throw new Error('Jupiter quote is for the wrong pair')
  const destination = ata(owner, USDC, TOKEN)
  const swap = await jupiter('/swap-instructions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: relayer.toBase58(), wrapAndUnwrapSol: true, destinationTokenAccount: destination.toBase58(), dynamicComputeUnitLimit: false }),
  })
  const jupIxs = [...(swap.setupInstructions ?? []), swap.swapInstruction, ...(swap.cleanupInstruction ? [swap.cleanupInstruction] : [])].map(toIx)
  for (const ix of jupIxs) {
    if (!ALLOWED_PROGRAMS.has(ix.programId.toBase58())) throw new Error(`Jupiter returned an instruction for an unexpected program ${ix.programId.toBase58()}`)
    if (ix.keys.some((k) => k.pubkey.equals(signer))) throw new Error('Jupiter returned an instruction touching the signer key')
  }
  const key = [...Buffer.from(keyHex, 'hex')]
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    createAssociatedTokenAccountIdempotentInstruction(relayer, destination, owner, USDC, TOKEN),
    await earn.methods.withdraw(key, new BN(lamports.toString()), { usdc: {} }, new BN(minOut.toString()))
      .accountsPartial({ config: configAddress(), account: accountAddress(Buffer.from(keyHex, 'hex')), signer, relayer, destination, instructions: SYSVAR_INSTRUCTIONS_PUBKEY })
      .instruction(),
    ...jupIxs,
    await earn.methods.settle().accountsPartial({ account: accountAddress(Buffer.from(keyHex, 'hex')), destination }).instruction(),
  ]
  const tables = await Promise.all((swap.addressLookupTableAddresses ?? []).map(async (a) => {
    const r = await conn.getAddressLookupTable(new PublicKey(a)); return r.value
  }))
  return { ixs, lookupTables: tables.filter(Boolean), minOut, quote, destination }
}

export async function buildSolWithdraw({ earn, keyHex, lamports, destination, signer, relayer }) {
  return {
    ixs: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      await earn.methods.withdraw([...Buffer.from(keyHex, 'hex')], new BN(lamports.toString()), { sol: {} }, new BN(0))
        .accountsPartial({ config: configAddress(), account: accountAddress(Buffer.from(keyHex, 'hex')), signer, relayer, destination, instructions: SYSVAR_INSTRUCTIONS_PUBKEY })
        .instruction(),
    ],
    lookupTables: [],
  }
}

/** Cashed's payout milestones: $5, $10, $20, $50, $100, $250, $500, $1,000, then every $1,000. */
const MILESTONES = [5, 10, 20, 50, 100, 250, 500, 1000]
export function crossedMilestone(paidUsd, owedUsd) {
  const total = paidUsd + owedUsd
  const next = (x) => MILESTONES.find((m) => m > x) ?? (Math.floor(x / 1000) + 1) * 1000
  return total >= next(paidUsd)
}
