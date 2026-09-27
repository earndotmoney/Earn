/**
 * A sanity check on the launch transaction the server built, before the wallet signs it.
 *
 * The wallet's own simulation is the real defence; this is the site refusing to even ask for a
 * signature on something that is not the launch it described. Hand-parsed v0 message so web3.js
 * stays out of the bundle.
 */
import { encode } from './base58'

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'
/** The only SystemProgram transfer EARN builds is the fee-address top-up, at most one rent floor (890,880). */
export const MAX_USER_TRANSFER_LAMPORTS = 2_000_000n

type Ix = { programIndex: number; accounts: number[]; data: Uint8Array }
export type ParsedTx = { feePayer: string; staticKeys: string[]; instructions: Ix[]; signatures: number }

function shortvec(bytes: Uint8Array, at: { i: number }): number {
  let len = 0, size = 0
  for (;;) {
    const b = bytes[at.i++]
    if (b === undefined) throw new Error('truncated')
    len |= (b & 0x7f) << (size * 7)
    size++
    if ((b & 0x80) === 0) return len
    if (size > 3) throw new Error('bad length')
  }
}

/** Parses a signed or unsigned v0 (or legacy) transaction's static part. Throws on anything unexpected. */
export function parseTransaction(bytes: Uint8Array): ParsedTx {
  const at = { i: 0 }
  const signatures = shortvec(bytes, at)
  at.i += signatures * 64
  const prefix = bytes[at.i]
  if (prefix === undefined) throw new Error('truncated')
  if ((prefix & 0x80) !== 0) {
    const version = prefix & 0x7f
    if (version !== 0) throw new Error(`unsupported transaction version ${version}`)
    at.i++
  }
  at.i += 3 // header: required signatures, readonly signed, readonly unsigned
  const nKeys = shortvec(bytes, at)
  const staticKeys: string[] = []
  for (let k = 0; k < nKeys; k++) { staticKeys.push(encode(bytes.subarray(at.i, at.i + 32))); at.i += 32 }
  at.i += 32 // blockhash
  const nIx = shortvec(bytes, at)
  const instructions: Ix[] = []
  for (let k = 0; k < nIx; k++) {
    const programIndex = bytes[at.i++]!
    const nAcc = shortvec(bytes, at)
    const accounts: number[] = []
    for (let a = 0; a < nAcc; a++) accounts.push(bytes[at.i++]!)
    const nData = shortvec(bytes, at)
    instructions.push({ programIndex, accounts, data: bytes.subarray(at.i, at.i + nData) })
    at.i += nData
  }
  if (!staticKeys[0]) throw new Error('no fee payer')
  return { feePayer: staticKeys[0], staticKeys, instructions, signatures }
}

const u64le = (d: Uint8Array, off: number) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[off + i] ?? 0); return v }

/**
 * Refuses a transaction that is not the launch the server described. Returns nothing on success.
 * Address lookup tables are not resolved: only static keys are inspected, and every account EARN's
 * launch needs to check (fee payer, mint, pump.fun, system program) is static.
 */
export function checkLaunchTransaction(bytes: Uint8Array, { wallet, mint }: { wallet: string; mint: string }): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !mint.endsWith('earn')) throw new Error('The server returned a mint address that does not end in earn')
  const tx = parseTransaction(bytes)
  if (tx.feePayer !== wallet) throw new Error('The transaction names a different wallet as payer')
  if (!tx.staticKeys.includes(mint)) throw new Error('The transaction does not create the mint it named')
  if (!tx.staticKeys.includes(PUMP_PROGRAM)) throw new Error('The transaction does not go through pump.fun')
  const sys = tx.staticKeys.indexOf(SYSTEM_PROGRAM)
  for (const ix of tx.instructions) {
    if (ix.programIndex !== sys) continue
    // SystemProgram transfer: u32 index 2, then u64 lamports; account 0 is the source.
    const kind = ix.data[0]! | (ix.data[1]! << 8) | (ix.data[2]! << 16) | (ix.data[3]! << 24)
    if (kind !== 2 || ix.data.length < 12) continue
    if (ix.accounts[0] !== 0) continue
    const lamports = u64le(ix.data, 4)
    if (lamports > MAX_USER_TRANSFER_LAMPORTS) throw new Error(`The transaction would move ${Number(lamports) / 1e9} SOL out of your wallet, which a launch never does`)
  }
}

/** A Solana signature is 64 bytes: 87 or 88 characters in base58. */
export const isSignature = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(s)
